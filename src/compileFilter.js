const quote = require('./quote')

const compileFunctions = {
  bbox: (filter) => 'geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)',
  id: (filter) => 'osm_id=ANY(\'{' + filter.value.join(',') + '}\')',
  properties: (filter) => [null, {needFilter: true}],
  if: (filter) => {
    const result =  compileEvaluator(filter.value)
    result[0] = to_boolean(result)
    return result
  },
}

const compileOperators = {
  '=': '=',
  '!=': '!=',
  '~': '~',
  '~i': '~*',
  '!~': '!~',
  '!~i': '!~*',
  has: (filter) => 't.tags->>' + quote(filter.key) + "~" + quote('^(.*;|)' + filter.value + '(|;.*)$'),
  strsearch: (filter) => [null, {needFilter: true}], // TODO
  has_key: (filter) => 't.tags?' + quote(filter.key),
  not_exists: (filter) => 'NOT t.tags?' + quote(filter.key),
}

compileEvalOperators = {
  '==': '=',
  '!=': '!=',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '&&': ' AND ',
  '||': ' OR ',
  '!': (left, right) => ['NOT ' + to_boolean(right), {type: 'boolean'}],
  '+': (left, right) => {
    if (left[1].type === 'string' || right[1].type === 'string') {
      return [['CONCAT(' + left[0] + ',' + right[0] + ')'], {type: 'string'}]
    } else {
      return [[to_number(left) + '+' + to_number(right)], {type: 'number'}]
    }
  }
}
compileEvalFunctions = {
  'id': (param) => 'osm_id',
  'type': (param) => "(SELECT v FROM (VALUES('N','node'),('W','way'),('R','relation'))t(t,v) where t=osm_type)",
  'tag': (param) => 't.tags->>' + to_string(param[0]),
  'is_tag': (param) => 'CASE WHEN t.tags?' + to_string(param[0]) + ' THEN 1 ELSE 0 END',
  'count_tags': (param) => '(SELECT COUNT(*) FROM jsonb_object_keys(tags))',
  'length': (param) => 'ST_Length(geom::geography)+ST_Perimeter(geom::geography)',
}
compileEvalFunctionTypes = {
  'id': 'number',
  'type': 'string',
  'tag': 'string',
  'is_tag': 'number',
  'count_tags': 'number',
  'length': 'number',
}

/**
 * @return [
 *   query OR null,    // "filter1='bar'"
 *   options           // {needFilter: true} <- do not return false values, to not overwrite other options
 * ]
 */
function compileFilter (filter) {
  if (filter.fun) {
    if (!(filter.fun in compileFunctions)) {
      console.error("Don't know how to compile filter function: " + JSON.stringify(filter))
      return [null, {needFilter: true}]
    }
    const result = compileFunctions[filter.fun](filter)
    return typeof result === 'string' ? [result, {}] : result
  } else if (filter.op) {
    return compileOperator(filter)
  }

  console.error("Don't know how to compile filter: " + JSON.stringify(filter))
  return [null, {needFilter: true}]
}

function compileOperator (filter) {
  if (filter.op in compileOperators) {
    if (filter.keyRegexp) {
      return [null, {needFilter: true}]
    } else if (typeof compileOperators[filter.op] === 'function') {
      const result = compileOperators[filter.op](filter)
      return typeof result === 'string' ? [result, {}] : result
    } else {
      const column = 't.tags->>' + quote(filter.key)
      const value = filter.value ? quote(filter.value) : null
      return [column + compileOperators[filter.op] + value, {}]
    }
  }

  console.error("Can't compile operator '" + filter.op + "'")
  return [null, {needFilter: true}]
}

function compileEvaluator (filter) {
  if (filter.data) {
    filter = filter.data
  }

  if ('value' in filter) {
    if (typeof filter.value === 'number') {
      return [filter.value, {type:'number'}]
    } else {
      return [quote(filter.value), {type:'string'}]
    }
  }

  if (filter.op) {
    if (!(filter.op in compileEvalOperators)) {
      console.log('Don\'t know how to handle eval operator "' + filter.op + '"')
      return [null, {needFilter: true}]
    }

    const left = filter.left ? compileEvaluator(filter.left) : [null, {}]
    const right = filter.right ? compileEvaluator(filter.right) : [null, {}]
    let result = typeof compileEvalOperators[filter.op] === 'function' ? compileEvalOperators[filter.op](left, right) : compileEvalOperators[filter.op]

    if (typeof result === 'string') {
      if (left[0] === null || right[0] === null) {
        console.log('eval operator ' + filter.op + ' can\'t build', filter)
        return [null, {needFilter: true}]
      }
      result = [left[0] + result + right[0], {}]
      result[1].type = 'boolean'
    } else {
      result[1] = { ...left[1], ...right[1], ...result[1] }
    }

    return typeof result === 'string' ? [result, {}] : result
  }

  if (filter.fun) {
    if (!(filter.fun in compileEvalFunctions)) {
      return [null, {needFilter: true}]
    }

    const params = filter.parameters.map(p => compileEvaluator(p))

    const result = compileEvalFunctions[filter.fun](params)
    return typeof result === 'string' ? [result, {type: compileEvalFunctionTypes[filter.fun]}] : result
  }
}

function to_number (item) {
  switch (item[1].type) {
    case 'number':
      return item[0]
    case 'boolean':
      return 'CASE WHEN ' + item[0] + ' THEN 1 ELSE 0 END'
    case 'string':
      return 'CAST(' + item[0] + ' AS DECIMAL)'
  }
}

function to_boolean (item) {
  switch (item[1].type) {
    case 'number':
      return item[0] + '<>0'
    case 'string':
      return 'LOWER(' + item[0] + ") NOT IN ('false', '', '0')"
    case 'boolean':
      return item[0]
  }
}

function to_string (item) {
  switch (item[1].type) {
    case 'number':
    case 'string':
      return item[0]
    case 'boolean':
      return item[0] ? '1' : '0'
  }
}

module.exports = compileFilter
