const assert = require('assert')
const geowiki = require('./src/geowikiAPI')
const queryList = require('./queries.json')
const getRequests = require('./get.json')

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

  describe('Get', function () {
    Object.entries(getRequests).forEach(([query, def]) => {
      it(query, function (done) {
        geowiki.clearCache()
        const options = {
          out: 'json',
          outOptions: 'tags',
          each: (ob) => {
            // console.log('each', ob.id, ob.tags)
          }
        }

        if (def.bounds) {
          options.bounds = def.bounds
        }

        geowiki.get(
          query.split(/,/),
          options,
          (err, result) => {
            if (err) { return done(err) }

            if (def.expectedIds) {
              assert.equal(result.elements.length, def.expectedIds.length, 'Wrong count of returned elements')

              const unexpected = []
              result.elements.forEach(el => {
                const id = el.type.substr(0, 1) + el.id
                if (!def.expectedIds.includes(id)) {
                  unexpected.push(id)
                }
              })

              if (unexpected.length) {
                assert.fail('Returning unexpected elements: ' + unexpected.join(', '))
              }
            }

            done()
          }
        )
      })
    })
  })
})
