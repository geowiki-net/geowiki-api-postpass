const DBTypePostpass = require('../../src/DBTypePostpass')
const config = require('../config.json')
module.exports = new DBTypePostpass(config.url, {})
