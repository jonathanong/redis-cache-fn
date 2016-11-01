'use strict'

const stringify = require('json-stringify-safe')
const assert = require('assert')

const ENCODINGS = module.exports = new Map()

ENCODINGS.set('json', {
  encode: val => {
    assert(!Buffer.isBuffer(val), 'Cannot return a `Buffer` when `encoding != `buffer`')
    return stringify(val)
  },
  decode: val => JSON.parse(val)
})

ENCODINGS.set('string', {
  encode: val => {
    assert(!Buffer.isBuffer(val), 'Cannot return a `Buffer` when `encoding != `buffer`')
    return String(val)
  },
  decode: val => String(val)
})

ENCODINGS.set('buffer', {
  encode: val => {
    assert(Buffer.isBuffer(val))
    return val
  },
  decode: val => {
    assert(Buffer.isBuffer(val))
    return val
  }
})
