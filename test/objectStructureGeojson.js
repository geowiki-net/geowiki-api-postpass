const fs = require('fs')
const async = require('async')
const assert = require('assert')
const GeowikiAPI = require('@geowiki-net/geowiki-api')
const geowiki = require('./src/geowikiAPI')
const loadFile = require('./src/loadFile')

describe('get specific map item to check object structure (GeoJSON)', function () {
  const items = ['n378458', 'n647991', 'w4789279', 'w86282062', 'r167731', 'r3237099'] //, 'r1522329', 'r20313', 'w37337538']
  const checkProperties = [ 'ids', 'tags', 'skel', 'geom', 'meta geom' ]

  checkProperties.forEach(outOptions => {
    it('check with out options "' + outOptions + '"', function (done) {
      geowiki.clearCache()

      async.each(items, (id, done) => {
        const file = 'test/reference/' + id + '-' + outOptions.replace(/ /g, '_') + '.geojson'

        async.parallel({
          expected: done => loadFile(file, (err, content) => done(null, JSON.parse(content ?? '{}'))),
          actual: done => geowiki.get(id, {
              out: 'geojson',
              outOptions
            },
            (err, result) => {
              if (err) { return done(err) }

              console.log(result)
              const element = result.features[0]
              if (!element) {
                assert.fail('element ' + id + ' not found')
              }

              //fs.writeFileSync(file, JSON.stringify(element, null, '  '))
              done(null, element)
            }
          )
        }, (err, {expected, actual}) => {
          if (err) { return done(err) }
          assert.deepEqual(expected, actual, 'Output of item ' + id + ' is wrong')
          done()
        })
      }, (err) => done(err))
    })
  }, (err) => done(err))
})
