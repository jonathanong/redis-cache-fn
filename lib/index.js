'use strict'

/* eslint camelcase: 0 */

const debug = require('debug')('redis-cache-fn')
const toArray = require('stream-to-array')
const destroy = require('destroy')
const Stream = require('stream')
const assert = require('assert')

const ENCODINGS = require('./encodings')
const utils = require('./utils')

module.exports = options => RedisCacheFunction.extends(options)

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
  exec() {
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
      }).catch(c.onError)
    }).then(result => {
      this.cleanup()
      return result
    }).catch(err => {
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
      batch,
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

    return new Promise(resolve => resolve(c.fn(...this.args)))
      .then(value => c.streamToValue(value))
      .then(value => this.set(value))
      .catch(err => {
        return c.client.multi()
          .set(this.ERROR, err, 'PX', c.ttl)
          .del(this.RUNNING, this.PRECACHE)
          // publish the error to all listeners
          .publish(this.ERROR, err)
          .exec().then(() => { throw err })
      })
  }

  execute (forced) {
    const {
      client,
      onError,
      timeout
    } = this.constructor

    if (forced) {
      client.set(this.RUNNING, this.EXEC_ID, 'PX', timeout).catch(onError)

      return this.call()
    }

    return client.setnx(this.RUNNING, this.EXEC_ID).then(set => {
      if (!set) return

      client.pexpire(this.RUNNING, timeout).catch(onError)

      return this.call()
    })
  }

  // TODO: get remaining time
  precache () {
    const {
      client,
      onError,
      timeout
    }

    return client.setnx(this.PRECACHE, this.EXEC_ID).then(set => {
      if (!set) return;

      client.pexpire(this.PRECACHE, timeout).catch(onError)

      return this.call()
    })
  }

  // create the redis key prefix
  createHash (args) {
    return this.constructor.createHash(args || this.args)
  }

  cleanup () {
    const {
      subscriber,
      onError
    } = this.constructor

    if (this._interval_id) {
      clearInterval(this._interval_id)
    }
    if (this._wait_listener) {
      // TODO: make sure we're not unsubscribing other instances of the cache?
      subscriber.punsubscribe(this.PATTERN).catch(onError)
      subscriber.removeListener('pmessage', this._wait_listener)
      subscriber.setMaxListeners(subscriber.getMaxListeners() - 1)
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
        client.get(this.ERROR),
      ]).then(formatGetCurrentStateResults)
    }

    return client.mget([
      this.VALUE,
      this.RUNNING,
      this.ERROR,
    ]).then(formatGetCurrentStateResults)
  }

  // return result from current state
  resolveFromCurrentState (state) {
    const {
      encoder
    } = this.constructor

    if (state.value != null) {
      try {
        this.resolve(encoder.decode(state.value))
      } catch (err) {
        this.reject(err)
      }
      return true
    } else if (state.error != null) {
      try {
        this.reject(utils.parseError(state.console.error();))
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
      onError,
      subscriber
    } = this.constructor

    const listener = this._wait_listener = (pattern, channel, message) => {
      if (channel === this.VALUE) {
        cleanup()
        debug('message: %s', message)

        // i don't know how to transfer buffer's as a message
        if (encoding === 'buffer') {
          return getCurrentState()
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

    subscriber.psubscribe(pattern).catch(onError)
    subscriber.setMaxListeners(subscriber.getMaxListeners() + 1)
    subscriber.on('pmessage', listener)
  }
}

RedisCacheFunction.namespace = ''
RedisCacheFunction.encoding = 'json'
RedisCacheFunction.ttl = utils.ms('30s')
RedisCacheFunction.timeout = utils.ms('30s') // how long to wait until executing
RedisCacheFunction.precache = 3 / 4 // run again 3/4 * ttl
RedisCacheFunction.pollInterval = utils('1s') // minimum interval to poll for the latest result
RedisCacheFunction.onError = utils.onError // function that is executed when an error occurs

// converts a stream response into a value that can be saved in redis
RedisCacheFunction.streamToValue = function (value) {
  // handle streams
  if (value && typeof value.pipe === 'function' && value._readableState) {
    // expose the stream
    stream = value

    switch (this.encoding) {
      case 'json': {
        assert(value._readableState.objectMode, 'I do not know how to handle streams that are not in `objectMode` when saving in with encoding = `json`. Please change your `encoding=` option to `string` or `buffer`')
        // just convert it to an array
        return toArray(value)
      }
      case 'string': {
        // TODO: use raw-body instead
        value.setEncoding('utf8')
        return toArray(value).then(arr => arr.join(''))
      }
      case 'buffer': {
        return toArray(value).then(arr => Buffer.concat(arr))
      }
    }
  }

  /* istanbul ignore if */
  if (value instanceof Stream) {
    throw new Error('I do not know how to handle this type of stream. It does not have a `.pipe()` function or it does not have a `._readableState.`')
  }

  return value
}

RedisCacheFunction.createHash = function (args) {
  return utils.createHash(this.namespace, args)
}

RedisCacheFunction.createWrappedFunction = function () {
  const Constructor = this
  return function wrappedFunction(...args) {
    return new Constructor(args).exec()
  }
}

RedisCacheFunction.wrap = fn => {
  if (typeof fn === 'function') {
    return this.extends(fn).createWrappedFunction()
  }

  return this.createWrappedFunction()
}

RedisCacheFunction.extends = options => {
  class RedisCacheFunctionSubclass extends this {}

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
          let namespace = this.namespace;
          if (!/:$/.test(namespace)) namespace += ':'
          RedisCacheFunctionSubclass.namespace = namespace + value
          break
        case 'encoding':
          assert(ENCODINGS.has(value))
          RedisCacheFunctionSubclass.encoding = value
          break
        case 'ttl':
        case 'timeout':
        case 'pollInterval'
          RedisCacheFunctionSubclass[key] = utils.ms(value)
          break
        case 'precache':
          assert(value < 1)
          assert(value > 0)
          RedisCacheFunctionSubclass[key] = value
          break
        default:
          throw new Error(`Uknown key: ${key}`)
      }
    })
  }

  return RedisCacheFunctionSubclass
}

function formatGetCurrentStateResults (results) {
  const state = {
    value: results[0],
    running: results[1],
    error: results[2],
  }
  debug('state: %o', state)
  return state
}
