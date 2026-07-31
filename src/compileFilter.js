const quote = require('./quote')

const compileFunctions = {
  bbox: (filter) => 'geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)',
  id: (filter) => 'osm_id=ANY(\'{' + filter.value.join(',') + '}\')',
  properties: (filter) => [[], {needFilter: true}],
}

const compileOperators = {
  '=': '=',
  '~': '~',
  has_key: (filter) => 't.tags?' + quote(filter.key),
  not_exists: (filter) => 'NOT t.tags?' + quote(filter.key),
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
    if (typeof compileOperators[filter.op] === 'function') {
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

module.exports = compileFilter
