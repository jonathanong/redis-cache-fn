
# redis-cache-fn

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![Dependency Status][david-image]][david-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

Caches your functions via Redis.
Features:

- Uses Redis caching, expiration, and pub/sub.
- Concurrency locking - if the function is being run elsewhere with the same arguments, it will wait for the result of that function instead of executing again.
- Caching - caches results for as long as you want. If you set `ttl=0`, then you're just this library for concurrency locking, which is completely fine. However, please keep in mind that locking mechanism in this module is not robust - it is more suited towards caching.
- Only tested with [ioredis](https://github.com/luin/ioredis)

Use Cases:

- Race conditions
- API calls with rate limits
- Expensive database calls
- Expensive function calls

Differences from [redis-cache-decorator](https://github.com/jonathanong/redis-cache-decorator):

- Uses a class system so that it's more maintainable
- A slightly different API
- Doesn't bother throwing when functions timeout. Use another library instead.
- Removes stream support

## API

### const Cache = require('redis-cache-fn')(options)

- `client <required>` - a `ioredis` client for GET/SET/PUBLISH, etc.
- `subscriber <required>` - a `ioredis` client for `PSUBSCRIBE`
- `namespace = ''` - a prefix for all the events
- `encoding = 'json'` - how data is encoded between redis and node.js.
  Supported values are:
  - `json` - the default
  - `string`
  - `buffer`
- `ttl = '30s'` - the TTL expiration in seconds.
- `timeout = 0` - how long to wait for the function to execute before executing the function again. By default, there is no timeout.
  - Ex. if it the current function has waited 30s for the function to complete elsewhere, it will say "F IT" and run the function itself.
- `pollInterval = '1s'` - how often to poll for new values.
- `precache = 3/4` - when the age hits this threshold, execute the function again to so that the cache remains fresh.
- `onError = err => console.error(err.stack)` - an error handler for redis network errors.

### Cache = Cache.extend(options<Object>)

Subclasses the cache, extending its options.
All options are overwritten except:

- `namespace` - the namespace is simply concatenated with `:`s.

### fn = Cache.extend(function<Function>)

Decorates the function so that it hits the cache first.

### { Cache } = fn

The function's Cache constructor.

### promise = fn()

Returns a promise.

### promise.cache

The cache instance of this function call.

### const hash = Cache.createHash(args)

### const cache = new Cache(args)

### value = await cache.set(value)

[npm-image]: https://img.shields.io/npm/v/redis-cache-fn.svg?style=flat-square
[npm-url]: https://npmjs.org/package/redis-cache-fn
[travis-image]: https://img.shields.io/travis/jonathanong/redis-cache-fn.svg?style=flat-square
[travis-url]: https://travis-ci.org/jonathanong/redis-cache-fn
[codecov-image]: https://img.shields.io/codecov/c/github/jonathanong/redis-cache-fn/master.svg?style=flat-square
[codecov-url]: https://codecov.io/github/jonathanong/redis-cache-fn
[david-image]: http://img.shields.io/david/jonathanong/redis-cache-fn.svg?style=flat-square
[david-url]: https://david-dm.org/jonathanong/redis-cache-fn
[license-image]: http://img.shields.io/npm/l/redis-cache-fn.svg?style=flat-square
[license-url]: LICENSE
[downloads-image]: http://img.shields.io/npm/dm/redis-cache-fn.svg?style=flat-square
[downloads-url]: https://npmjs.org/package/redis-cache-fn
