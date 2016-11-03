'use strict'

/* eslint camelcase: 0 */

const debug = require('debug')('redis-cache-fn')
const assert = require('assert')

const PubSubEvents = require('./pubsub-events')
const ENCODINGS = require('./encodings')
const utils = require('./utils')

module.exports = options => RedisCacheFunction.extend(options)

class RedisCacheFunction {
  constructor (args) {
    this.args = args
    this.EXEC_ID = Date.now() + ':' + Math.random().toString(36)
    const HASH = this.HASH = this.createHash(args)
    this.VALUE = `${HASH}:value`
    this.RUNNING = `${HASH}:running`
    this.ERROR = `${HASH}:error`
    this.PATTERN = `${HASH}:*`
    this.PRECACHE = `${HASH}:precaching`
  }

  // execute the logic
  exec () {
    const {
      onError
    } = this.constructor

    const promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject

      this.getCurrentState().then(state => {
        if (this.resolveFromCurrentState(state)) return

        this.pollCurrentState()
        this.waitForResult()

        // start executing the function if there's no cached value
        // and it's not running anywhere else
        if (!state.running) return this.execute()
      }).catch(onError)
    }).then(result => {
      this.cleanup()
      this.precache()
      return result
    }).catch(err => {
      debug('rethrowing error: %s', err.message)
      this.cleanup()
      throw err
    })

    promise.cache = this

    return promise
  }

  // set the value of the response
  set (value) {
    const {
      encoding,
      ttl,
      client,
      onError
    } = this.constructor

    const encodedValue = ENCODINGS.get(encoding).encode(value) // story it as a string
    const batch = client.multi()

    // only cache if a TTL is set
    if (ttl) {
      if (encoding === 'buffer') {
        // NOTE: buffer over pipelines isn't working that great
        client.set(this.VALUE, encodedValue, 'PX', ttl).catch(onError)
      } else {
        batch.set(this.VALUE, encodedValue, 'PX', ttl)
      }
    }

    batch.del(this.RUNNING, this.PRECACHE, this.ERROR)
    // NOTE: don't know how buffers transmit over pubsub
    // publish the result to all listeners
    batch.publish(this.VALUE, encoding === 'buffer' ? '1' : encodedValue)

    return batch.exec().then(() => value)
  }

  // actually call the function
  call () {
    const c = this.constructor

    new Promise(resolve => resolve(c.fn(...this.args)))
      .then(value => this.set(value))
      .catch(err => {
        debug('fn error: %s', err.message)
        const errString = utils.stringifyError(err)
        return c.client.multi()
          .set(this.ERROR, errString, 'PX', c.ttl)
          .del(this.RUNNING, this.PRECACHE)
          // publish the error to all listeners
          .publish(this.ERROR, errString)
          .exec()
      })
      .catch(c.onError)
  }

  execute (forced) {
    const {
      client,
      onError,
      timeout
    } = this.constructor

    if (forced) {
      client.set(this.RUNNING, this.EXEC_ID, 'PX', timeout).catch(onError)

      this.call()

      return
    }

    return client.setnx(this.RUNNING, this.EXEC_ID).then(set => {
      if (!set) return

      client.pexpire(this.RUNNING, timeout).catch(onError)

      this.call()
    }).catch(onError)
  }

  // TODO: get remaining time
  precache () {
    const {
      client,
      onError,
      timeout,
      ttl,
      precache
    } = this.constructor

    return client.pttl(this.VALUE).then(val => {
      if (val < 0) return
      if (val >= (1 - precache) * ttl) return

      return client.setnx(this.PRECACHE, this.EXEC_ID).then(set => {
        if (!set) return

        client.pexpire(this.PRECACHE, timeout).catch(onError)

        this.call()
      })
    }).catch(onError)
  }

  // create the redis key prefix
  createHash (args) {
    return this.constructor.createHash(args || this.args)
  }

  cleanup () {
    const {
      pubsub
    } = this.constructor

    if (this._interval_id) {
      clearInterval(this._interval_id)
    }
    if (this._wait_listener) {
      pubsub.off(this.PATTERN, this._wait_listener)
    }
  }

  // check whether the query is currently running or is done
  getCurrentState () {
    const {
      client,
      encoding
    } = this.constructor

    if (encoding === 'buffer') {
      // TODO: should really be using `.multi()` here, but `getBuffer()` is broken in it
      return Promise.all([
        client.getBuffer(this.VALUE),
        client.get(this.RUNNING),
        client.get(this.ERROR)
      ]).then(formatGetCurrentStateResults)
    }

    return client.mget([
      this.VALUE,
      this.RUNNING,
      this.ERROR
    ]).then(formatGetCurrentStateResults)
  }

  // return result from current state
  resolveFromCurrentState (state) {
    const {
      encoding
    } = this.constructor
    const encoder = ENCODINGS.get(encoding)

    if (state.value != null) {
      try {
        this.resolve(encoder.decode(state.value))
      } catch (err) {
        this.reject(err)
      }
      return true
    } else if (state.error != null) {
      try {
        this.reject(utils.parseError(state.error))
      } catch (err) {
        this.reject(err)
      }
      return true
    }
    return false
  }

  // poll for updates to the state
  // i.e. if another execute() solves it
  pollCurrentState () {
    const {
      onError,
      pollInterval
    } = this.constructor

    this._interval_id = setInterval(() => {
      this.getCurrentState().then(({ value, running, error }) => {
        if (this.resolveFromCurrentState({ value, error })) return

        // no longer running and no result? run again
        if (!running) this.execute(true)
      }).catch(onError)
    }, pollInterval)
  }

  // subscribe to events to see if the results are done
  waitForResult () {
    const {
      encoding,
      pubsub
    } = this.constructor

    const listener = this._wait_listener = (channel, message) => {
      debug('message: %s', message)
      if (channel === this.VALUE) {
        // i don't know how to transfer buffer's as a message
        if (encoding === 'buffer') {
          return this.getCurrentState()
            .then(state => this.resolveFromCurrentState(state))
        }

        this.resolveFromCurrentState({
          value: message
        })
      } else if (channel === this.ERROR) {
        this.resolveFromCurrentState({
          error: message
        })
      }
    }

    pubsub.on(this.PATTERN, listener)
  }
}

RedisCacheFunction.namespace = ''
RedisCacheFunction.encoding = 'json'
RedisCacheFunction.ttl = utils.ms('30s')
RedisCacheFunction.timeout = utils.ms('30s') // how long to wait until executing
RedisCacheFunction.precache = 3 / 4 // run again 3/4 * ttl
RedisCacheFunction.pollInterval = utils.ms('1s') // minimum interval to poll for the latest result
RedisCacheFunction.onError = utils.onError // function that is executed when an error occurs

RedisCacheFunction.createHash = function (args) {
  return utils.createHash(this.namespace, args)
}

RedisCacheFunction.createWrappedFunction = function () {
  const Constructor = this
  wrappedFunction.Cache = Constructor;
  return wrappedFunction

  function wrappedFunction (...args) {
    return new Constructor(args).exec()
  }
}

RedisCacheFunction.wrap = function (fn) {
  if (typeof fn === 'function') {
    return this.extend(fn).createWrappedFunction()
  }

  return this.createWrappedFunction()
}

RedisCacheFunction.extend = function (options) {
  const RedisCacheFunctionSuper = this
  class RedisCacheFunctionSubclass extends RedisCacheFunctionSuper {}

  if (typeof options === 'function') {
    RedisCacheFunctionSubclass.fn = options
  } else {
    Object.keys(options).forEach(key => {
      const value = options[key]
      switch (key) {
        case 'fn':
          assert.equal('function', typeof value)
          RedisCacheFunctionSubclass[key] = value
          break
        case 'namespace':
          let namespace = this.namespace
          if (!/:$/.test(namespace)) namespace += ':'
          RedisCacheFunctionSubclass.namespace = namespace + value
          break
        case 'encoding':
          assert(ENCODINGS.has(value))
          RedisCacheFunctionSubclass.encoding = value
          break
        case 'ttl':
        case 'timeout':
        case 'pollInterval':
          RedisCacheFunctionSubclass[key] = utils.ms(value)
          break
        case 'precache':
          assert(value < 1)
          assert(value > 0)
          RedisCacheFunctionSubclass[key] = value
          break
        case 'client':
        case 'subscriber':
          assert(value)
          RedisCacheFunctionSubclass[key] = value
          if (key === 'subscriber') {
            this.pubsub = new PubSubEvents(value)
          }
          break
        default:
          throw new Error(`Unknown key: ${key}`)
      }
    })
  }

  return RedisCacheFunctionSubclass
}

function formatGetCurrentStateResults (results) {
  const state = {
    value: results[0],
    running: results[1],
    error: results[2]
  }
  debug('state: %o', state)
  return state
}
