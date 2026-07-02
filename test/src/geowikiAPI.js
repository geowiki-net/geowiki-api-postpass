const GeowikiAPI = require('@geowiki-net/geowiki-api')
require('../../src/DBTypePostpass')
const config = require('../config.json')

module.exports = new GeowikiAPI(config.url, {
  dbType: 'postpass'
})
