const compileFilter = require('../src/compileFilter')
const assert = require('assert')
const Filter = require('@geowiki-net/geowiki-api/src/Filter')

const tests = {
  '[name=foo]': ["t.tags->>'name'='foo'", {}],
  '[name!=foo]': ["t.tags->>'name'!='foo'", {}],
  '[name~foo]': ["t.tags->>'name'~'foo'", {}],
  '[name~foo,i]': ["t.tags->>'name'~*'foo'", {}],
  '[name!~foo]': ["t.tags->>'name'!~'foo'", {}],
  '[name!~foo,i]': ["t.tags->>'name'!~*'foo'", {}],
  '[~name~foo]': [null,{"needFilter":true}],
  '[~name~foo,i]': [null,{"needFilter":true}],
  '[name]': ["t.tags?'name'", {}],
  '[!name]': ["NOT t.tags?'name'", {}],
  '[name^foo]': ["t.tags->>'name'~'^(.*;|)foo(|;.*)$'", {}],
  '[name%foo]': [null,{"needFilter":true}],
  '(1,1,2,2)': ["geom && st_setsrid(st_makebox2d(st_makepoint(1,1), st_makepoint(2,2)), 4326)",{}],
  '(1234)': ["osm_id=ANY('{1234}')",{}],
  '(id:1,2,3)': ["osm_id=ANY('{1,2,3}')",{}],
  '(properties:63)': [null,{"needFilter":true}],
  '(if: t["name"]=="foo")': ["t.tags->>'name'='foo'",{"type": "boolean"}],
  '(if: t["name"]==t["eman"])': ["t.tags->>'name'=t.tags->>'eman'",{"type": "boolean"}],
  '(if: id() == 5)': ["osm_id=5",{"type": "boolean"}],
  '(if: is_tag("name"))': ["CASE WHEN t.tags?'name' THEN 1 ELSE 0 END<>0",{"type": "number"}]
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
