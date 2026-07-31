const compileFilter = require('../src/compileFilter')
const assert = require('assert')
const Filter = require('@geowiki-net/geowiki-api/src/Filter')

const tests = {
  '[name=foo]': [["t.tags->>'name'='foo'"], {}],
  '[name!=foo]': [["t.tags->>'name'!='foo'"], {}],
  '[name~foo]': [["t.tags->>'name'~'foo'"], {}],
  '[name~foo,i]': [["t.tags->>'name'~*'foo'"], {}],
  '[name!~foo]': [["t.tags->>'name'!~'foo'"], {}],
  '[name!~foo,i]': [["t.tags->>'name'!~*'foo'"], {}],
  '[~name~foo]': [[],{"needFilter":true}],
  '[~name~foo,i]': [[],{"needFilter":true}],
  '[name]': [["t.tags?'name'"], {}],
  '[!name]': [["NOT t.tags?'name'"], {}],
  '[name^foo]': [["t.tags->>'name'~'^(.*;|)foo(|;.*)$'"], {}],
  '[name%foo]': [[],{"needFilter":true}],
  '(1,1,2,2)': [["geom && st_setsrid(st_makebox2d(st_makepoint(1,1), st_makepoint(2,2)), 4326)"],{}],
  '(1234)': [["osm_id=ANY('{1234}')"],{}],
  '(id:1,2,3)': [["osm_id=ANY('{1,2,3}')"],{}],
  '(properties:63)': [[],{"needFilter":true}],
}

describe('compileFilter', function () {
  Object.entries(tests).forEach(([query, expected]) => {
    it(query, function () {
      const filter = new Filter('nwr' + query)
      const actual = compileFilter(filter.script[0].filters[0])

      assert.deepEqual(actual, expected)
    })
  })
})
