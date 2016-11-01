
const debug = require('debug')('redis-cache-fn:pubsub-events')
const Events = require('events')

const { onError } = require('./utils')

module.exports = class PubSubEvents {
  constructor (subscriber) {
    this.subscriber = subscriber
    const events = this.events = new Events()

    subscriber.on('pmessage', (...args) => {
      debug('emitting: %o', args)
      events.emit(...args)
    })
  }

  on (event, fn) {
    const { events } = this
    if (!events.listenerCount(event)) {
      debug('subscribing to %s', event)
      this.subscriber.psubscribe(event).catch(onError)
    }
    events.setMaxListeners(events.getMaxListeners() + 1)
    events.on(event, fn)
  }

  off (event, fn) {
    const { events } = this
    events.setMaxListeners(events.getMaxListeners() - 1)
    events.removeListener(event, fn)
    if (!events.listenerCount(event)) {
      debug('unsubscribing from %s', event)
      this.subscriber.punsubscribe(event).catch(onError)
    }
  }
}
