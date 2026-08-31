const quote = require('./quote')

const compileFunctions = {
  bbox: (filter, options) => options.tableAlias + '.geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)',
  id: (filter) => 'osm_id=ANY(\'{' + filter.value.join(',') + '}\')',
  properties: (filter) => [null, {}],
  if: (filter, options) => {
    const result = compileEvaluator(filter.value, options)
    result[0] = toBoolean(result)
    return result
  }
}

const compileOperators = {
  '=': '=',
  '!=': '!=',
  '~': '~',
  '~i': '~*',
  '!~': '!~',
  '!~i': '!~*',
  has: (filter, options) => options.tableAlias + '.tags->>' + quote(filter.key) + '~' + quote('^(.*;|)' + filter.value + '(|;.*)$'),
  strsearch: (filter) => [null, { needFilter: true }], // TODO
  has_key: (filter, options) => options.tableAlias + '.tags?' + quote(filter.key),
  not_exists: (filter, options) => 'NOT ' + options.tableAlias + '.tags?' + quote(filter.key)
}

const compileEvalOperators = {
  '==': '=',
  '!=': '!=',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '&&': (left, right) => [toBoolean(left) + ' AND ' + toBoolean(right), { type: 'boolean' }],
  '||': (left, right) => [toBoolean(left) + ' OR ' + toBoolean(right), { type: 'boolean' }],
  '!': (left, right) => ['NOT ' + toBoolean(right), { type: 'boolean' }],
  '+': (left, right) => {
    if (left[1].type === 'string' || right[1].type === 'string') {
      return [['CONCAT(' + left[0] + ',' + right[0] + ')'], { type: 'string' }]
    } else {
      return [[toNumber(left) + '+' + toNumber(right)], { type: 'number' }]
    }
  },
  '*': (left, right) => [toNumber(left) + '*' + toNumber(right), { type: 'number' }],
  '/': (left, right) => [toNumber(left) + '/' + toNumber(right), { type: 'number' }],
  '-': (left, right) => [toNumber(left) + '-' + toNumber(right), { type: 'number' }],
  '?': (left, right, condition) => {
    return ['CASE WHEN ' + toBoolean(condition) + ' THEN ' + left[0] + ' ELSE ' + right[0] + ' END', {...left[1], ...right[1]}]
  }
}
const compileEvalFunctions = {
  '': (param) => ['(' + param[0][0] + ')', param[0][1]], // parantheses
  id: (param) => 'osm_id',
  type: (param) => "(SELECT v FROM (VALUES('N','node'),('W','way'),('R','relation'))t(t,v) where t=osm_type)",
  tag: (param, options) => options.tableAlias + '.tags->>' + toString(param[0]),
  is_tag: (param, options) => 'CASE WHEN ' + options.tableAlias + '.tags?' + toString(param[0]) + ' THEN 1 ELSE 0 END',
  count_tags: (param, options) => '(SELECT COUNT(*) FROM jsonb_object_keys(' + options.tableAlias + '.tags))',
  number: (param) => {
    if (param[0][1].type === 'string') {
      return ['SUBSTRING(' + param[0][0] + " FROM '^\\d+(?:\\.\\d+)?')", { type: 'number' }]
    } else {
      return toNumber(param[0])
    }
  },
  is_number: (param) => {
    if (param[0][1].type === 'string') {
      return [param[0][0] + "~'^\\d+(?:\\.\\d+)?'", { type: 'boolean' }]
    } else if (param[0][1].type === 'number') {
      return ['TRUE', { type: 'boolean' }]
    } else {
      return ['FALSE', { type: 'boolean' }]
    }
  },
  suffix: (param) => {
    if (param[0][1].type === 'string') {
      return ['SUBSTRING(' + param[0][0] + " FROM '^(?:\\d+(?:\\.\\d+)?)(.*)$')", { type: 'string' }]
    } else {
      return ['', { type: 'string' }]
    }
  },
  geom: (param) => 'geom',
  length: (param) => 'ST_Length(' + (param.length ? param[0] : 'geom') + '::geography)+ST_Perimeter(' + (param.length ? param[0] : 'geom') + '::geography)',
  lat: (param) => 'ST_Y(ST_Centroid(' + (param.length ? param[0] : 'geom') + '))',
  lon: (param) => 'ST_X(ST_Centroid(' + (param.length ? param[0] : 'geom') + '))',
  pt: (param) => 'ST_Point(' + param[1] + ',' + param[0] + ')'
}
const compileEvalFunctionTypes = {
  id: 'number',
  type: 'string',
  tag: 'string',
  is_tag: 'number',
  count_tags: 'number',
  geom: 'geometry',
  '': null,
  length: 'number',
  lat: 'number',
  lon: 'number',
  pt: 'geometry'
}

/**
 * @return [
 *   query OR null,    // "filter1='bar'"
 *   options           // {needFilter: true} <- do not return false values, to not overwrite other options
 * ]
 */
function compileFilter (filter, options) {
  if (filter.fun) {
    if (!(filter.fun in compileFunctions)) {
      console.error("Don't know how to compile filter function: " + JSON.stringify(filter))
      return [null, { needFilter: true }]
    }
    const result = compileFunctions[filter.fun](filter, options)
    return typeof result === 'string' ? [result, {}] : result
  } else if (filter.op) {
    return compileOperator(filter, options)
  }

  console.error("Don't know how to compile filter: " + JSON.stringify(filter))
  return [null, { needFilter: true }]
}

function compileOperator (filter, options) {
  if (filter.op in compileOperators) {
    if (filter.keyRegexp) {
      return [null, { needFilter: true }]
    } else if (typeof compileOperators[filter.op] === 'function') {
      const result = compileOperators[filter.op](filter, options)
      return typeof result === 'string' ? [result, {}] : result
    } else {
      const column = options.tableAlias + '.tags->>' + quote(filter.key)
      const value = filter.value ? quote(filter.value) : null
      return [column + compileOperators[filter.op] + value, {}]
    }
  }

  console.error("Can't compile operator '" + filter.op + "'")
  return [null, { needFilter: true }]
}

function compileEvaluator (filter, options) {
  if (filter.data) {
    filter = filter.data
  }

  if ('value' in filter) {
    if (typeof filter.value === 'number') {
      return [filter.value, { type: 'number' }]
    } else {
      return [quote(filter.value), { type: 'string' }]
    }
  }

  if (filter.op) {
    if (!(filter.op in compileEvalOperators)) {
      console.log('Don\'t know how to handle eval operator "' + filter.op + '"')
      return [null, { needFilter: true }]
    }

    const left = filter.left ? compileEvaluator(filter.left, options) : [null, {}]
    const right = filter.right ? compileEvaluator(filter.right, options) : [null, {}]
    const condition = filter.condition ? compileEvaluator(filter.condition, options) : [null, {}]
    let result = typeof compileEvalOperators[filter.op] === 'function' ? compileEvalOperators[filter.op](left, right, condition) : compileEvalOperators[filter.op]

    if (typeof result === 'string') {
      if (left[0] === null || right[0] === null) {
        console.log('eval operator ' + filter.op + ' can\'t build', filter)
        return [null, { needFilter: true }]
      }
      result = [left[0] + result + right[0], {}]
      result[1].type = 'boolean'
    } else {
      result[1] = { ...left[1], ...right[1], ...result[1] }
    }

    return typeof result === 'string' ? [result, {}] : result
  }

  if ('fun' in filter) {
    if (!(filter.fun in compileEvalFunctions)) {
      return [null, { needFilter: true }]
    }

    const params = filter.parameters.map(p => compileEvaluator(p))

    const result = compileEvalFunctions[filter.fun](params, options)
    return typeof result === 'string' ? [result, { type: compileEvalFunctionTypes[filter.fun] }] : result
  }
}

function toNumber (item) {
  switch (item[1].type) {
    case 'number':
      return item[0]
    case 'boolean':
      return 'CASE WHEN ' + item[0] + ' THEN 1 ELSE 0 END'
    case 'string':
      return 'CAST(' + item[0] + ' AS DECIMAL)'
  }
}

function toBoolean (item) {
  switch (item[1].type) {
    case 'number':
      return item[0] + '<>0'
    case 'string':
      return 'LOWER(' + item[0] + ") NOT IN ('false', '', '0')"
    case 'boolean':
      return item[0]
  }
}

function toString (item) {
  switch (item[1].type) {
    case 'number':
    case 'string':
      return item[0]
    case 'boolean':
      return item[0] ? '1' : '0'
  }
}

module.exports = compileFilter
