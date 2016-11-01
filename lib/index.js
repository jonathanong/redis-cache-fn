
module.exports = options => RedisCacheFunction.extends(options)

class RedisCacheFunction {
  constructor (args) {
    this.EXEC_ID = Date.now() + ':' + Math.random().toString(36)
    this.HASH = this.createHash(args)
    this.VALUE = `${this.HASH}:value`
    this.RUNNING = `${this.HASH}:running`
    this.ERROR = `${this.HASH}:error`
    this.PATTERN = `${this.HASH}:*`

    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    }).then(result => {
      this.cleanup()
      return result
    }).catch(err => {
      this.cleanup()
      throw err
    })
  }

  then (resolve, reject) {
    return this.promise.then(resolve, reject)
  }

  catch (reject) {
    return this.promise.catch(reject)
  }

  // set the value of the response
  set (value) {
    const { HASH } = this
    const c = this.constructor
    const encodedValue = c.encoder.encode(value) // story it as a string
    const batch = client.multi()
    // only cache if a TTL is set
    if (c.ttl) {
      if (c.encoding === 'buffer') {
        // NOTE: buffer over pipelines isn't working that great
        c.client.set(this.VALUE, encodedValue, 'PX', c.ttl).catch(c.onError)
      } else {
        c.batch.set(this.VALUE, encodedValue, 'PX', c.ttl)
      }
    }

    batch.del(this.RUNNING, this.ERROR)
    // NOTE: don't know how buffers transmit over pubsub
    // publish the result to all listeners
    batch.publish(this.VALUE, c.encoding === 'buffer' ? '1' : encodedValue)

    return batch.exec()
      .then(() => value)
  }

  execute () {

  }

  createHash = args => {
    return utils.createHash(this.constructor.namespace, args)
  }

  cleanup () {
    const c = this.constructor

    if (this._interval_id) clearInterval(this._interval_id)
    if (this._wait_listener) {
      c.subscriber.punsubscribe(this.PATTERN).catch(c.onError)
      c.subscriber.removeListener('pmessage', this._wait_listener)
      c.subscriber.setMaxListeners(c.subscriber.getMaxListeners() - 1)
    }
  }

  // check whether the query is currently running or is done
  getCurrentState () {
    const c = this.constructor

    if (c.encoding === 'buffer') {
      // TODO: should really be using `.multi()` here, but `getBuffer()` is broken in it
      return Promise.all([
        c.client.getBuffer(this.VALUE),
        c.client.get(this.RUNNING),
        c.client.get(this.ERROR),
      ]).then(formatGetCurrentStateResults)
    }

    return c.client.mget([
      this.VALUE,
      this.RUNNING,
      this.ERROR,
    ]).then(formatResults)
  }

  // return result from current state
  resolveFromCurrentState (state) {
    const c = this.constructor

    if (state.value != null) {
      try {
        this.resolve(c.encoder.decode(value))
      } catch (err) {
        this.reject(err)
      }
      return true
    } else if (state.error != null) {
      try {
        this.reject(utils.parseError(message))
      } catch (err) {
        this.reject(err)
      }
      return true
    }
    return false
  }

  // poll for updates to the state
  pollCurrentState () {
    const c = this.constructor

    this._interval_id = setInterval(() => {
      this.getCurrentState().then(({ value, running, error }) => {
        if (this.resolveFromCurrentState({ value, error })) return

        // no longer running and no result? something went wrong
        if (!running) this.reject(createTimeoutError())
      }).catch(c.onError)
    }, c.pollInterval)
  }

  // subscribe to events to see if the results are done
  waitForResult () {
    const c = this.constructor

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
      } else {
        return
      }
    }

    c.subscriber.psubscribe(pattern).catch(reject)
    c.subscriber.setMaxListeners(c.subscriber.getMaxListeners() + 1)
    c.subscriber.on('pmessage', listener)
  }
}

RedisCacheFunction.disabled = false
RedisCacheFunction.namespace = ''
RedisCacheFunction.encoding = 'json'
RedisCacheFunction.ttl = utils.ms('30s')
RedisCacheFunction.precache = 3 / 4 // run again 3/4 * ttl
RedisCacheFunction.pollInterval = 1000 // minimum interval to poll for the latest result
RedisCacheFunction.onError = utils._onError // function that is executed when an error occurs

RedisCacheFunction.wrap = fn => {
  const Constructor = this.extends(fn)

  wrappedFunction.Constructor = Constructor

  return wrappedFunction

  function wrappedFunction(...args) {
    return new Constructor(args).exec()
  }
}

RedisCacheFunction.extends = options => {
  class RedisCacheFunctionSubclass extends this {

  }

  if (typeof options === 'function') {
    RedisCacheFunctionSubclass.fn = options
  } else {

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
