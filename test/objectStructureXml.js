const fs = require('fs')
const async = require('async')
const assert = require('assert')
const GeowikiAPI = require('@geowiki-net/geowiki-api')
const geowiki = require('./src/geowikiAPI')
const loadFile = require('./src/loadFile')

describe('get specific map item to check object structure (XML)', function () {
  const items = ['n378458', 'n647991', 'w4789279', 'w86282062', 'r167731', 'r3237099', 'r910886'] //, 'r1522329', 'r20313', 'w37337538']
  const checkProperties = [ 'ids', 'tags', 'skel', 'geom', 'meta geom' ]

  checkProperties.forEach(outOptions => {
    it('check with out options "' + outOptions + '"', function (done) {
      geowiki.clearCache()

      async.each(items, (id, done) => {
        const file = 'test/reference/' + id + '-' + outOptions.replace(/ /g, '_') + '.xml'

        async.parallel({
          expected: done => loadFile(file, (err, content) => done(null, content.toString() ?? '')),
          actual: done => geowiki.get(id, {
              out: 'xml',
              outOptions
            },
            (err, result) => {
              console.log(result)
              const element = result.split('\n').slice(2, -1).join('\n')

              if (err) { return done(err) }

              if (!element) {
                assert.fail('element ' + id + ' not found')
              }

              //fs.writeFileSync(file, element)
              done(null, element)
            }
          )
        }, (err, {expected, actual}) => {
          if (err) { return done(err) }
          assert.equal(expected, actual, 'Output of item ' + id + ' is wrong')
          done()
        })
      }, (err) => done(err))
    })
  }, (err) => done(err))
})
