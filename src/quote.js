module.exports = function quote (str) {
  if (typeof str === 'number') {
    return str
  }

  return "'" + str.replace(/'/g, "\\'") + "'"
}
