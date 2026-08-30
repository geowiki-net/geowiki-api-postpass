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
  '(properties:63)': [null,{}],
  '(if: t["name"]=="foo")': ["t.tags->>'name'='foo'",{"type": "boolean"}],
  '(if: t["name"]==t["eman"])': ["t.tags->>'name'=t.tags->>'eman'",{"type": "boolean"}],
  '(if: !1)': ["NOT 1<>0",{"type":"boolean"}],
  '(if: !"")': ["NOT LOWER('') NOT IN ('false', '', '0')",{"type":"boolean"}],
  '(if: type() == "way" && id() == 12)': ["(SELECT v FROM (VALUES('N','node'),('W','way'),('R','relation'))t(t,v) where t=osm_type)='way' AND osm_id=12",{"type":"boolean"}],
  '(if: id() == 5)': ["osm_id=5",{"type": "boolean"}],
  '(if: is_tag("name"))': ["CASE WHEN t.tags?'name' THEN 1 ELSE 0 END<>0",{"type": "number"}],
  '(if: 2+3+1)': ["2+3+1<>0", {"type": "number"}],
  '(if: 2+(3+1))': ["2+(3+1)<>0", {"type": "number"}],
  '(if: 2+3*4)': ["2+3*4<>0", {"type": "number"}],
  '(if: (2+3)*4)': ["(2+3)*4<>0", {"type": "number"}],
  '(if: "2"+3+1)': ["LOWER(CONCAT(CONCAT('2',3),1)) NOT IN ('false', '', '0')",{"type":"string"}],
  '(if: 3+1+"2")': ["LOWER(CONCAT(3+1,'2')) NOT IN ('false', '', '0')",{"type":"string"}],
  '(if: length() > 5)': ["ST_Length(geom::geography)+ST_Perimeter(geom::geography)>5",{"type":"boolean"}],
  '(if: type()=="way"?is_tag("amenity"):is_tag("highway"))': ["CASE WHEN (SELECT v FROM (VALUES('N','node'),('W','way'),('R','relation'))t(t,v) where t=osm_type)='way' THEN CASE WHEN t.tags?'amenity' THEN 1 ELSE 0 END ELSE CASE WHEN t.tags?'highway' THEN 1 ELSE 0 END END<>0",{"type":"number"}],
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
