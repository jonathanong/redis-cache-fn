'use strict'

/* eslint-env mocha */
/* eslint max-nested-callbacks: 0 */
/* eslint promise/param-names: 0 */

const assert = require('assert')
const Redis = require('ioredis')

require('bluebird').config({
  warnings: false
})

const client = Redis.createClient()
const subscriber = Redis.createClient()

const Cache = require('..')({
  client,
  subscriber
})

before(() => {
  return client.flushall()
})

describe('Concurrency', () => {
  describe('encoding=`json`', () => {
    it('should not allow concurrent execution of an asynchronous function', () => {
      let called = 0
      const fn = Cache.extend({
        namespace: createNamespace()
      }).wrap(val => {
        return wait(10).then(() => {
          called++
          return val + 1
        })
      })

      return Promise.all([
        fn(1),
        fn(1)
      ]).then(results => {
        // equal results
        assert.deepEqual(results, [2, 2])
        // only called once
        assert.equal(called, 1)
      })
    })

    it('should not allow concurrent execution of a synchronous function', () => {
      let called = 0
      const rand = Math.random()
      const fn = Cache.extend({
        namespace: createNamespace()
      }).wrap(val => {
        called++
        return val + rand
      })

      return Promise.all([
        fn(1),
        fn(1)
      ]).then(results => {
        // equal results
        assert.deepEqual(results, [1 + rand, 1 + rand])
        // only called once
        assert.equal(called, 1)
      })
    })
  })

  describe('encoding=`buffer`', () => {
    it('should not allow concurreny execution of an asynchronous function', () => {
      let called = 0
      const fn = Cache.extend({
        namespace: createNamespace(),
        encoding: 'buffer',
        pollInterval: 10000
      }).wrap(val => {
        called++
        return wait(100).then(() => {
          return new Buffer(val, 'hex')
        })
      })

      const hex = '00ff44'

      return Promise.all([
        fn(hex),
        fn(hex)
      ]).then(results => {
        for (const result of results) {
          assert.equal(result.toString('hex'), hex)
        }
        assert.equal(called, 1)
      })
    })
  })
})

describe('Caching', () => {
  describe('encoding=`json`', () => {
    it('should cache results', () => {
      let called = 0

      const fn = Cache.extend({
        namespace: createNamespace()
      }).wrap(val => {
        return wait(10).then(() => {
          called++
          return val + 1
        })
      })

      const promise = fn(1)
      assert.equal('string', typeof promise.cache.HASH)

      return promise.then(val => {
        assert.equal(val, 2)
        return fn(1).then(val => {
          assert.equal(val, 2)
          assert.equal(called, 1)
        })
      })
    })
  })

  describe('encoding=`buffer`', () => {
    it('should cache results', () => {
      let called = 0
      const fn = Cache.extend({
        namespace: createNamespace(),
        encoding: 'buffer',
        fn (val) {
          called++
          return new Buffer(val, 'hex')
        }
      }).createWrappedFunction()

      const hex = '00ff44'

      return fn(hex).then(val => {
        assert(Buffer.isBuffer(val))
        assert.equal(val.toString('hex'), hex)
        return fn(hex)
      }).then(val => {
        assert(Buffer.isBuffer(val))
        assert.equal(val.toString('hex'), hex)
        assert.equal(called, 1)
      })
    })
  })

  describe('encoding=`string`', () => {
    it('should cache results', () => {
      let called = 0
      const fn = Cache.extend({
        namespace: createNamespace(),
        encoding: 'string'
      }).wrap(val => {
        called++
        return String(val) + String(val)
      })

      const string = 'asdf'

      return fn(string).then(val => {
        assert.equal(val, string + string)
        return fn(string)
      }).then(val => {
        assert.equal(val, string + string)
        assert.equal(called, 1)
      })
    })
  })

  describe('ttl=0', () => {
    it('should not cache w/ ttl=0', () => {
      let called = 0
      const fn = Cache.extend({
        namespace: createNamespace(),
        ttl: 0
      }).wrap(val => {
        called++
        return val
      })

      return fn(1).then(val => {
        assert.equal(val, 1)
        return fn(1)
      }).then(val => {
        assert.equal(val, 1)
        assert.equal(called, 2)
      })
    })
  })
})

describe('Error Handling', () => {
  it('should return the same error w/ asynchronous functions', () => {
    let called = 0

    const fn = Cache.extend({
      namespace: createNamespace()
    }).wrap(val => {
      return wait(100).then(() => {
        called++
        throw new Error('boom')
      })
    })

    return Promise.all([
      fn(1).then(() => {
        throw new Error('nope')
      }).catch(err => {
        assert.equal(err.message, 'boom')
      }),
      fn(1).then(() => {
        throw new Error('nope')
      }).catch(err => {
        assert.equal(err.message, 'boom')
      })
    ]).then(() => {
      assert.equal(called, 1)
    })
  })

  it('should return the same error w/ synchronous functions', () => {
      // difference is that we don't care if the function is called multiple times
      // when the function does not take a lot of time
    const fn = Cache.extend({
      namespace: createNamespace()
    }).wrap(val => {
      throw new Error('boom')
    })

    return Promise.all([
      fn(1).then(() => {
        throw new Error('nope')
      }).catch(err => {
        assert.equal(err.message, 'boom')
      }),
      fn(1).then(() => {
        throw new Error('nope')
      }).catch(err => {
        assert.equal(err.message, 'boom')
      })
    ])
  })
})

describe('Timeout', () => {
  it('should run the function again when the timeout passes', () => {
    let resolve
    let counter = 0

    const promise = new Promise(_resolve => {
      resolve = _resolve
    })

    const fn = Cache.extend({
      namespace: createNamespace(),
      timeout: 1,
      pollInterval: 10
    }).wrap(val => {
      return wait(100).then(() => {
        if (++counter === 2) resolve()
        return counter
      })
    })

    fn()

    return promise
  })
})

describe('Pre Cache', () => {
  it('should precache the values', () => {
    let resolve
    let counter = 0

    const promise = new Promise(_resolve => {
      resolve = _resolve
    })

    const fn = Cache.extend({
      namespace: createNamespace(),
      ttl: 1000,
      precache: 1 / 100
    }).wrap(val => {
      if (++counter === 2) resolve()
      return counter
    })

    fn()

    setTimeout(fn, 200)

    return promise
  })
})

describe('Wrapped Function', () => {
  it('should have .Cache', () => {
    const fn = Cache.extend({
      namespace: createNamespace(),
      ttl: 1000,
      precache: 1 / 100,
      fn (val) {
        return true
      }
    }).wrap()

    assert(fn.Cache)
  })
})

function wait (ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function createNamespace () {
  return Math.random().toString()
}
