const assert = require('assert')
const Filter = require('@geowiki-net/geowiki-api/src/Filter')
const db = require('./src/dbTypePostpass')
const defines = require('@geowiki-net/geowiki-api')
const BoundingBox = require('boundingbox')
const queryList = require('./queries.json')

describe('Test compiling filters', function () {
  describe('compile filter with tags, without bounds', function () {
    Object.entries(queryList).forEach(([query, def]) => {
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS
        })

        assert.equal(result[0], def.tags)
      })
    })
  })

  describe('compile filter with tags, with bounds', function () {
    return
    Object.entries(queryList).forEach(([query, def]) => {
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS,
          bounds: new BoundingBox({ minlon: 1, minlat: 1, maxlon: 2, maxlat: 2 })
        })

        const expected = def.tags +
          (def.tags.match(/ (r\.id|t)$/) ? ' WHERE' : ' AND') +
          ' geom && st_setsrid(st_makebox2d(st_makepoint(1,1), st_makepoint(2,2)), 4326)'
        assert.equal(result[0], expected)
      })
    })
  })

  describe('compile filter with tags and members, without bounds', function () {
    return
    Object.entries(queryList).forEach(([query, def]) => {
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS|defines.MEMBERS
        })

        assert.equal(result[0], def['tags-members'])
      })
    })
  })

  describe('compile filter with tags and members, with bounds', function () {
    Object.entries(queryList).forEach(([query, def]) => {
      return
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS|defines.MEMBERS,
          bounds: new BoundingBox({ minlon: 1, minlat: 1, maxlon: 2, maxlat: 2 })
        })

        const expected = def['tags-members'] +
          (def['tags-members'].match(/ (r\.id|t)$/) ? ' WHERE' : ' AND') +
          ' geom && st_setsrid(st_makebox2d(st_makepoint(1,1), st_makepoint(2,2)), 4326)'
        assert.equal(result[0], expected)
      })
    })
  })
})
