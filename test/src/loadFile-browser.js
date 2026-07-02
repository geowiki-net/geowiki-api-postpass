module.exports = function loadFile (file, callback) {
  fetch(file)
    .then(req => req.text())
    .then(body => callback(null, body))
}
