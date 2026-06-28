const assert = require('assert')
const async = require('async')
const BoundingBox = require('boundingbox')

const Filter = require('@geowiki-net/geowiki-api/src/Filter')
const DBTypePostpass = require('../src/DBTypePostpass')
const GeowikiAPI = require('@geowiki-net/geowiki-api')
const defines = GeowikiAPI
const config = require('./config.json')

const queryList = {
  'nwr': {
    'bboxquery': false,
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_pointlinepolygon t",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM postpass_pointlinepolygon t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id"
  },
  'node': {
    'bboxquery': false,
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_point t",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, '{}'::bigint[] as \"nodes\", '{}'::jsonb as \"members\" FROM postpass_point t"
  },
  'way': {
    'bboxquery': false,
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id"
  },
  'relation': {
    'bboxquery': false,
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_pointlinepolygon WHERE osm_type='R') t",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_pointlinepolygon WHERE osm_type='R') t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id"
  },
  'nwr[amenity=restaurant]': {
    'bboxquery': {
      expectedElements: 9
    },
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_pointlinepolygon t WHERE t.tags->>'amenity'='restaurant'",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM postpass_pointlinepolygon t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE t.tags->>'amenity'='restaurant'"
  },
  'nwr[amenity=restaurant][cuisine]': {
    'bboxquery': {
      expectedElements: 2
    },
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_pointlinepolygon t WHERE t.tags->>'amenity'='restaurant' AND t.tags?'cuisine'",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM postpass_pointlinepolygon t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE t.tags->>'amenity'='restaurant' AND t.tags?'cuisine'"
  },
  'nwr[amenity=restaurant][cuisine~";"]': {
    'bboxquery': {
      expectedElements: 0
    },
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_pointlinepolygon t WHERE t.tags->>'amenity'='restaurant' AND t.tags->>'cuisine'~';'",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM postpass_pointlinepolygon t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE t.tags->>'amenity'='restaurant' AND t.tags->>'cuisine'~';'"
  },
  '(nwr[amenity=restaurant];nwr[bar];)': {
    'bboxquery': {
      expectedElements: 9
    },
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_pointlinepolygon t WHERE ((t.tags->>'amenity'='restaurant') OR (t.tags?'bar'))",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM postpass_pointlinepolygon t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE ((t.tags->>'amenity'='restaurant') OR (t.tags?'bar'))"
  },
  'way(id:4583259,38279772)': {
    'bboxquery': {
      expectedElements: 2
    },
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t WHERE osm_id = ANY('{4583259,38279772}')",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE osm_id = ANY('{4583259,38279772}')"
  },
  'way[highway](4583259)': {
    'bboxquery': {
      expectedElements: 1
    },
    'tags': "SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t WHERE t.tags?'highway' AND osm_id = ANY('{4583259}')",
    'tags-members': "SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE t.tags?'highway' AND osm_id = ANY('{4583259}')"
  },
  '(node[place=continent];way(4583259);)': {
    'tags': "SELECT * FROM (SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM postpass_point t WHERE ((t.tags->>'place'='continent')) UNION SELECT t.osm_id, t.osm_type, t.geom, t.tags FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t WHERE ((osm_id = ANY('{4583259}')))) t",
    'tags-members': "SELECT * FROM (SELECT t.osm_id, t.osm_type, t.geom, t.tags, '{}'::bigint[] as \"nodes\", '{}'::jsonb as \"members\" FROM postpass_point t WHERE ((t.tags->>'place'='continent')) UNION SELECT t.osm_id, t.osm_type, t.geom, t.tags, w.nodes, r.members FROM (SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W') t left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id WHERE ((osm_id = ANY('{4583259}')))) t"
  }
}

describe('DBTypePostpass', function () {
  let db
  let geowiki

  it('initialize', function () {
    db = new DBTypePostpass(config.url, {})
    geowiki = new GeowikiAPI(config.url, {
      dbType: 'postpass'
    })
  })

  describe('compile filter with tags, without bounds', function () {
    Object.entries(queryList).forEach(([query, def]) => {
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS
        })

        assert.equal(result, def.tags)
      })
    })
  })

  describe('compile filter with tags, with bounds', function () {
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
        assert.equal(result, expected)
      })
    })
  })

  describe('compile filter with tags and members, without bounds', function () {
    Object.entries(queryList).forEach(([query, def]) => {
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS|defines.MEMBERS
        })

        assert.equal(result, def['tags-members'])
      })
    })
  })

  describe('compile filter with tags and members, with bounds', function () {
    Object.entries(queryList).forEach(([query, def]) => {
      it(query, function () {
        const filter = new Filter(query)
        const result = db.compile(filter, {
          properties: defines.TAGS|defines.MEMBERS,
          bounds: new BoundingBox({ minlon: 1, minlat: 1, maxlon: 2, maxlat: 2 })
        })

        const expected = def['tags-members'] +
          (def['tags-members'].match(/ (r\.id|t)$/) ? ' WHERE' : ' AND') +
          ' geom && st_setsrid(st_makebox2d(st_makepoint(1,1), st_makepoint(2,2)), 4326)'
        assert.equal(result, expected)
      })
    })
  })

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
