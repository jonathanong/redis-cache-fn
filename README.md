
# redis-cache-fn

[![Node.js CI](https://github.com/jonathanong/redis-cache-fn/actions/workflows/node.js.yml/badge.svg?branch=master&event=push)](https://github.com/jonathanong/redis-cache-fn/actions/workflows/node.js.yml)
[![codecov](https://codecov.io/gh/jonathanong/redis-cache-fn/branch/master/graph/badge.svg?token=Xd4tvpcLGe)](https://codecov.io/gh/jonathanong/redis-cache-fn)

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

### Cache = Cache.extend(options\<Object\>)

Subclasses the cache, extending its options.
All options are overwritten except:

- `namespace` - the namespace is simply concatenated with `:`s.

### fn = Cache.wrap(function\<Function\>)

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
