
// import env
require('dotenv-expand')(require('dotenv').config())

const express = require('express')
const path = require('path')
const http = require('http')
const compression = require('compression')
const hpp = require('hpp')
const morgan = require('morgan')
const cors = require('cors')
const passport = require('passport')

const { notFound, errorHandler } = require('./middlewares')
const config = require('./utils/config')
const { configurePassportJwt } = require('./oidc/passportConfig')

const forceSSL = config.FORCE_SSL === 'true'
const PORT = config.PORT || 8000

// express app
const app = express()

// Don't expose any software information to hackers.
app.disable('x-powered-by')

// Response compression.
app.use(compression({ level: 9 }))

// Use CORS middleware with options
//app.use(cors(corsOptions));
app.use(cors())

// Prevent HTTP Parameter pollution.
app.use(hpp())

// Enable logging
app.use(morgan('dev'))

if (forceSSL) {
  // Enable reverse proxy support in Express. This causes the
  // the "X-Forwarded-Proto" header field to be trusted so its
  // value can be used to determine the protocol.
  app.enable('trust proxy')

  app.use((req, res, next) => {
    if (req.secure) {
      // request was via https, so do no special handling
      next()
    } else {
      // request was via http, so redirect to https
      res.redirect(`https://${req.headers.host}${req.url}`)
    }
  })
}

// this is used to set up a JWT verifier to use when OIDC is enabled
const { configuredPassport, authenticateRequests, authenticateRequestsSocketIo } = configurePassportJwt(
  passport,
  !!config.OIDC_ISSUER,
  config.OIDC_ISSUER,
  config.OIDC_ISSUER_JWKS_URI || `${config.OIDC_ISSUER}/publickeys`
)

// turn on OIDC workflow if used
if (config.OIDC_ISSUER) {
  app.use(configuredPassport.initialize())
}


const staticFilesPath = path.join(__dirname, 'public') // from client/build (copied via dockerfile)
app.use(express.static(staticFilesPath))

// all other requests, serve index.html
// app.get('/*', (req, res) => {
//   res.sendFile(path.join(staticFilesPath, 'index.html'))
// })

// 404 Handler for api routes
app.use(notFound)

// Error Handler
app.use(errorHandler)

let pool, io

const server = http.createServer(app)

const { configureSocketIo } = require('./socketio/configureSocketio')
if (config.SOCKETIO_DB_URI) {
  // disable pool for now
  // pool = require('./socketio/configurePool')
//  io = configureSocketIo(server, pool, authenticateRequestsSocketIo)
}
io = configureSocketIo(server, pool, authenticateRequestsSocketIo)

// TODO add more socketio code for verifying authentication

if (!module.parent) {
  // Start the server
  server.listen(PORT, (err) => {
    if (err) {
      console.log(err)
      return
    }
    console.log(`===> 🌎 Express Server started on port: ${PORT}!`)
  })
}

module.exports = app
