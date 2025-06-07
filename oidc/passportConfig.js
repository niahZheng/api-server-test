

const JwtStrategy = require('passport-jwt').Strategy
const ExtractJwt = require('passport-jwt').ExtractJwt
const jwksClient = require('jwks-rsa')
const debug = require('debug')('passportConfig')

/**
 * Returns a configured Passport with JWT/OIDC strategy
 * @param {any} passport Passport Library
 * @param {boolean} oidcEnabled if true the authentication middleware will run passport.authenticate 
 * @param {string} oidcIssuer location of the OIDC issuer
 * @param {string} oidcJwksUri location of the OIDC JWK public key set
 * @returns {configuredPassport, authenticateRequests} configuredPassport object and authenticateRequests express middleware
 **/
exports.configurePassportJwt = function(passport, oidcEnabled, oidcIssuer, oidcJwksUri) {

  const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKeyProvider: jwksClient.passportJwtSecret({
      jwksUri: `${oidcJwksUri}`,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    }),
    issuer: `${oidcIssuer}`,
    //algorithms: ['RS256'],
  };
  passport.use(new JwtStrategy(jwtOptions, (payload, done) => {
    debug(`inside jwt strategy`)
    debug(payload)
    const user = {
      id: payload.sub,
      //username: payload.preferred_username,
      email: payload.email,
    };
    // Pass the user object to the next middleware
    return done(null, user);
  }));

  /**
   * Express Middleware for calling passport.authenticate using JWT
   * @param {any} req
   * @param {any} res
   * @param {any} next
   * @returns {any}
   */
  function authenticateRequests(req, res, next) {
    if (oidcEnabled) {
      debug(`checking auth for request`);
      passport.authenticate('jwt', { session: false }, (err, user, info) => {
        debug(`passport trying to auth`)
        if (err) {
          debug(err)
          // Handle authentication error
          return next(err);
        }
        if (!user) {
          // Authentication failed
          debug(`passport auth unsuccessful`)
          return res.status(401).send('Unauthorized');
        }
        // Authentication successful
        debug(`passport auth successful`)
        req.user = user; // Attach user to request object
        return next();
      })(req, res, next);
    } else {
      next();
    }
  }

  /**
   * Express Middleware for calling passport.authenticate using JWT to be used by socketio
   * @param {any} req
   * @param {any} res
   * @param {any} next
   * @returns {any}
   */
  function authenticateRequestsSocketIo(req, res, next) {
    if (oidcEnabled) {
      debug(`checking auth for io request`);
      debug(req.headers)
      passport.authenticate('jwt', { session: false }, (err, user, info) => {
        debug(`passport trying to io auth`)
        if (err) {
          debug(err)
          // Handle authentication error
          return next(err);
        }
        if (!user) {
          // Authentication failed
          debug(`passport io auth unsuccessful`)
          return next(new Error('Failed to authenticate token'));
        }
        // Authentication successful
        debug(`passport io auth successful`)
        req.user = user; // Attach user to request object
        return next();
      })(req, res, next);
    } else {
      next();
    }
  }

  return { configuredPassport:passport, authenticateRequests , authenticateRequestsSocketIo}
}


// Use the JwtStrategy with additional validation



// app.use(passport.initialize())


