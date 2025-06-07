
const multer = require('multer')
const createError = require('http-errors')

const upload = multer({ dest: 'uploads/' })

module.exports = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (err) {
      const error = createError(422, 'Invalid Attribute', {
        message: `You need to have a single field (${fieldName}) with type as \`file\``,
      })
      return res.status(400).json({
        errors: [error],
      })
    }
    return next()
  })
}
