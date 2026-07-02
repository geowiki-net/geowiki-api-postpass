const assert = require('assert')
const geowiki = require('./src/geowikiAPI')
const queryList = require('./queries.json')

describe('Requests', function () {
  describe('BBoxQuery', function () {
    Object.entries(queryList).forEach(([query, def]) => {
      if (def.bboxquery === false) {
        return
      }

      it(query, function (done) {
        geowiki.clearCache()
        geowiki.BBoxQuery(
          query,
          { minlat: 48.19, maxlat: 48.20, minlon: 16.33, maxlon: 16.34 },
          {
            out: 'json',
            outOptions: 'tags',
            each: (ob) => {
              console.log('each', ob.id)
            }

          },
          (err, result) => {
            if (err) { return done(err) }

            if (def.bboxquery) {
              if ('expectedElements' in def.bboxquery) {
                assert.equal(result.elements.length, def.bboxquery.expectedElements)
              }
            } else {
              console.log(JSON.stringify(result, null, '  '))
            }

            done()
          }
        )
      })
    })
  })
})
