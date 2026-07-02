const fs = require('fs')

module.exports = function loadFile (file, callback) {
  fs.readFile(file, callback)
}
