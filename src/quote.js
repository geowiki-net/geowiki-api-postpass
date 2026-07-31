module.exports = function quote (str) {
  return "'" + str.replace(/'/g, "\\'") + "'"
}
