const fs = require('fs')
const async = require('async')
const assert = require('assert')
const GeowikiAPI = require('@geowiki-net/geowiki-api')
const geowiki = require('./src/geowikiAPI')

describe('get specific map item to check object structure', function () {
  const items = ['n378458', 'n647991', 'w4789279', 'w37337538', 'w86282062']// 'r20313', 'r167731', 'r3237099'] //, 'r1522329']
  const checkProperties = [ 'ids', 'tags', 'skel', 'geom', 'meta geom' ]

  checkProperties.forEach(outOptions => {
    it('check with out options "' + outOptions + '"', function (done) {
      geowiki.clearCache()

      async.each(items, (id, done) => {
        geowiki.get(id, {
            //out: 'object',
            outOptions
          },
          (err, result) => {
            if (err) { return done(err) }

            const element = result.elements[0]
            if (!element) {
              assert.fail('element ' + id + ' not found')
            }

            //console.log('prop', element.properties, element.geometry)
            console.log(element)
            fs.writeFileSync('test/reference/' + id + '-' + outOptions.replace(/ /g, '_') + '.json', JSON.stringify(element, null, '  '))
            done()
          }
        )
      }, (err) => done(err))
    })
  }, (err) => done(err))
})
