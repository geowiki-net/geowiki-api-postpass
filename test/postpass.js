const fs = require('fs')
const assert = require('assert')
const async = require('async')

const GeowikiAPI = require('@geowiki-net/geowiki-api')
const geowiki = require('./src/geowikiAPI')
const defines = GeowikiAPI
const config = require('./config.json')

const queryList = require('./queries.json')

describe('other', function () {
  describe('further tests', function () {
    it('Simultaneous requests', function (done) {
      geowiki.clearCache()
      async.parallel([
        done => geowiki.BBoxQuery(
          'node[amenity=restaurant]',
          { minlat: 48.19, maxlat: 48.20, minlon: 16.33, maxlon: 16.34 },
          {
            out: 'json',
            outOptions: 'tags'
          },
          (err, result) => {
            if (err) { return done(err) }
            assert.equal(result.elements.length, 7)
            done()
          }
        ),
        done => geowiki.BBoxQuery(
          'way[highway=residential]',
          { minlat: 48.19, maxlat: 48.20, minlon: 16.33, maxlon: 16.34 },
          {
            out: 'json',
            outOptions: 'tags'
          },
          (err, result) => {
            if (err) { return done(err) }
            assert.equal(result.elements.length, 22)
            done()
          }
        )
      ], (err) => done(err))
    })
  })
})
