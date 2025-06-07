/**
 * Configured Pool for SocketIo Server
 *  this pool only listens to messages from postgres pg notify
 *  keep in mind that when clients send messages to server, it doesn't use the pg adapter, but rather directly on the socket.on events
 *  the "notification" event is special, used by socket.io and the database is simulating a cross-server communication to deliver messages
 * @returns {any} pg pool
 */

const { Pool } = require('pg')
const debug = require('debug')('configurePool')
const config = require('../utils/config')

const rejectUnauthorized = config.SOCKETIO_TRUST_SELF_SIGNED === 'false'

const pool = new Pool({
  connectionString: config.SOCKETIO_DB_URI,
  max: 4,
  ssl: {
    rejectUnauthorized: rejectUnauthorized,
  },
})

debug('Enabling Notification Service')
// Add a listener for the 'error' event
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err)
})

// Optionally, add a listener for the 'connect' event
pool.on('connect', (client) => {
  // client.on('notification', (msg) => {
  //     debug(msg.channel) // foo
  //     debug(msg.payload) // bar!
  //     debug(msg)
  // })
  debug('New client connected to the pool')
})

// // Optionally, add a listener for the 'acquire' event
// pool.on('acquire', (client) => {
//     debug('Client acquired from the pool');
// });

// // Optionally, add a listener for the 'remove' event
// pool.on('remove', (client) => {
//     debug('Client removed from the pool');
// });

module.exports = pool
