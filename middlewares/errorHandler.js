
// Error Handler

module.exports = (err, req, res, next) => {
  res.status(err.status || err.statusCode || 500)
  return res.send({
    errors: [err],
  })
}
