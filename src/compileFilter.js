const quote = require('./quote')

const compileFunctions = {
  bbox: (filter) => 'geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)',
  id: (filter) => 'osm_id=ANY(\'{' + filter.value.join(',') + '}\')',
  properties: (filter) => null,
}

const compileOperators = {
  '=': '=',
  '~': '~',
  has_key: (filter) => 't.tags?' + quote(filter.key),
  not_exists: (filter) => 'NOT t.tags?' + quote(filter.key),
}

function compileFilter (filter) {
  if (filter.fun) {
    if (!(filter.fun in compileFunctions)) {
      console.error("Don't know how to compile filter function: " + JSON.stringify(filter))
      needFilter = true
    }
    return compileFunctions[filter.fun](filter)
  } else if (filter.op) {
    return compileOperator(filter)
  } else {
    console.error("Don't know how to compile filter: " + JSON.stringify(filter))
    needFilter = true
  }
}

function compileOperator (filter) {
  if (filter.op in compileOperators) {
    if (typeof compileOperators[filter.op] === 'function') {
      return compileOperators[filter.op](filter)
    } else {
      const column = 't.tags->>' + quote(filter.key)
      const value = filter.value ? quote(filter.value) : null
      return column + compileOperators[filter.op] + value
    }
  } else {
    console.error("Can't compile operator '" + filter.op + "'")
    return false
  }
}

module.exports = compileFilter
