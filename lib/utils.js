'use strict'

const stringify = require('json-stable-stringify')
const crypto = require('crypto')
const _ms = require('ms')

// these errors would only happen on network errors
/* istanbul ignore next */
exports.onError = function onError (err) {
  /* eslint no-console: 0 */
  if (err) console.error(err.stack)
}

/* istanbul ignore next */
exports.noop = function noop () {}

exports.ms = function ms (value) {
  switch (typeof value) {
    case 'string': return _ms(value)
    case 'number': return Math.round(value)
  }
  /* istanbul ignore next */
  throw new TypeError('Only strings and functions are supported.')
}

exports.stringifyError = function stringifyError (_err) {
  return JSON.stringify(_err, [
    'message',
    'arguments',
    'type',
    'name',
    'stack'
  ])
}

exports.parseError = function parseError (message) {
  const _err = JSON.parse(message)
  const err = new Error(_err.message)
  for (const key of Object.keys(_err)) {
    if (key === 'message') continue // already set
    Object.defineProperty(err, key, {
      value: _err[key],
      configurable: true,
      writable: true,
      enumerable: true
    })
  }
  return err
}

exports.isNumberOrString = function isNumberOrString (val) {
  const type = typeof val
  return type === 'string' || type === 'number'
}

// create a caching hash for this function w/ the specified arguments
exports.createHash = function createHash (namespace, args) {
  return [
    namespace,
    crypto.createHash('sha256')
      .update(stringify(args))
      .digest('hex')
  ].join(':')
}
