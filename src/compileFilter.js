const quote = require('./quote')

const compileFunctions = {
  bbox: (filter) => 'geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)',
  id: (filter) => 'osm_id=ANY(\'{' + filter.value.join(',') + '}\')',
  properties: (filter) => [[], {needFilter: true}],
  if: (filter) => compileEvaluator(filter.value),
}

const compileOperators = {
  '=': '=',
  '!=': '!=',
  '~': '~',
  '~i': '~*',
  '!~': '!~',
  '!~i': '!~*',
  has: (filter) => 't.tags->>' + quote(filter.key) + "~" + quote('^(.*;|)' + filter.value + '(|;.*)$'),
  strsearch: (filter) => [[], {needFilter: true}], // TODO
  has_key: (filter) => 't.tags?' + quote(filter.key),
  not_exists: (filter) => 'NOT t.tags?' + quote(filter.key),
}

compileEvalOperators = {
  '==': '=',
}
compileEvalFunctions = {
  'tag': (param) => 't.tags->>' + param[0],
  'id': (param) => 'osm_id',
  'type': (param) => "(SELECT v FROM (VALUES('N','node'),('W','way'),('R','relation'))t(t,v) where t=osm_type)",
}

/**
 * @return [
 *   list of queries,  // ["filter1='bar'", ...]
 *   options           // {needFilter: true} <- do not return false values, to not overwrite other options
 * ]
 */
function compileFilter (filter) {
  if (filter.fun) {
    if (!(filter.fun in compileFunctions)) {
      console.error("Don't know how to compile filter function: " + JSON.stringify(filter))
      return [[], {needFilter: true}]
    }
    const result = compileFunctions[filter.fun](filter)
    return typeof result === 'string' ? [[result], {}] : result
  } else if (filter.op) {
    return compileOperator(filter)
  }

  console.error("Don't know how to compile filter: " + JSON.stringify(filter))
  return [[], {needFilter: true}]
}

function compileOperator (filter) {
  if (filter.op in compileOperators) {
    if (filter.keyRegexp) {
      return [[], {needFilter: true}]
    } else if (typeof compileOperators[filter.op] === 'function') {
      const result = compileOperators[filter.op](filter)
      return typeof result === 'string' ? [[result], {}] : result
    } else {
      const column = 't.tags->>' + quote(filter.key)
      const value = filter.value ? quote(filter.value) : null
      return [[column + compileOperators[filter.op] + value], {}]
    }
  }

  console.error("Can't compile operator '" + filter.op + "'")
  return [[], {needFilter: true}]
}

function compileEvaluator (filter) {
  if (filter.data) {
    filter = filter.data
  }

  if (filter.value) {
    return [[quote(filter.value)], {}]
  }

  if (filter.op) {
    if (!(filter.op in compileEvalOperators)) {
      return [[], {needFilter: true}]
    }

    const left = compileEvaluator(filter.left)
    const right = compileEvaluator(filter.right)
    let result = typeof compileEvalOperators[filter.op] === 'function' ? compileEvalOperators[filter.op](left, right) : compileEvalOperators[filter.op]

    if (typeof result === 'string') {
      if (left[0].length !== 1 && left[1].length !== 1) {
        console.log('eval operator ' + filter.op + ' can\'t build', filter)
        return [[], {needFilter: true}]
      }
      result = [left[0][0] + result + right[0][0], {}]
    }

    result[1] = { ...left[1], ...right[1], ...result[1] }

    return typeof result === 'string' ? [[result], {}] : result
  }

  if (filter.fun) {
    if (!(filter.fun in compileEvalFunctions)) {
      return [[], {needFilter: true}]
    }

    let options = {}
    const params = filter.parameters.map(p => {
      const r = compileEvaluator(p)
      options = {...options, ...r[1]}
      return r[0][0]
    })

    const result = compileEvalFunctions[filter.fun](params)
    return typeof result === 'string' ? [[result], {}] : result
  }
}

module.exports = compileFilter
