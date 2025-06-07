
const createError = require('http-errors')

// catch 404 and forward it to error handler
module.exports = (req, res, next) => {
  const err = new createError.NotFound()
  return next(err)
}
