const GeowikiAPI = require('@geowiki-net/geowiki-api')

const typePostToOSM = { N: 'node', W: 'way', R: 'relation' }
const typeOSMToPost = { node: 'N', way: 'W', relation: 'R' }

const tables = {
  nwr: 'postpass_pointlinepolygon',
  node: 'postpass_point',
  way: "(SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W')",
  relation: "(SELECT osm_id, osm_type, tags, geom FROM postpass_pointlinepolygon WHERE osm_type='R')"
}

const compileFunctions = {
  bbox: (filter) => 'geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)',
  id: (filter) => 'osm_id = ANY(\'{' + filter.value.join(',') + '}\')',
  properties: (filter) => null,
}
const compileOperators = {
  '=': '=',
  '~': '~',
  has_key: (filter) => 't.tags?' + quote(filter.key)
}

class DBTypePostpass {
  constructor (url, options) {
    this.url = url
    this.options = options
  }

  compile (query, options) {
    const stmt = query.getStatement()

    let result = compileSelect(this.compileStmt(stmt, options))
    if (options.bounds) {
      result = 'SELECT * FROM (' + result + ') WHERE geom && st_setsrid(st_makebox2d(st_makepoint(' + options.bounds.minlon + ',' + options.bounds.minlat + '), st_makepoint(' + options.bounds.maxlon + ',' + options.bounds.maxlat + ')), 4326)'
    }

    if (options.doneFeatures) {
      let done = ''
      const donePerType = {}
      Object.values(options.doneFeatures).forEach(item => {
        if (!(item.type in donePerType)) {
          donePerType[item.type] = []
        }
        donePerType[item.type].push(item.osm_id)
      })

      const where = []
      Object.entries(donePerType).forEach(([type, ids]) => {
        where.push('NOT (osm_type=' + quote(typeOSMToPost[type]) + ' AND osm_id = ANY(ARRAY[' + ids.join(',') + ']))')
      })

      if (where.length) {
        result = 'SELECT * FROM (' + result + ') WHERE ' + where.join(' AND ')
      }
    }

    return result
  }

  compileStmt (stmt, options) {
    if (stmt.constructor.name === 'FilterQuery' && stmt.inputSets && stmt.type === 'nwr' && stmt.filters.length === 0) {
      return this.compileStmt(Object.values(stmt.inputSets)[0].set, options)
    }

    switch (stmt.constructor.name) {
      case 'FilterQuery':
        return this.compileFilterQuery(stmt, options)
      case 'FilterOr':
        const parts = stmt.parts.map(part => this.compileStmt(part, options))

        let result = [parts.shift()]
        result[0].where = [result[0].where]
        parts.forEach(part => {
          if (!result.some(r => {
            if (r.table === part.table) {
              r.where.push(part.where)
              return true
            }
          })) {
            part.where = [part.where]
            result.push(part)
          }
        })

        result.forEach(r => {
          r.where = '(' + r.where.map(w => '(' + w + ')').join(' OR ') + ')'
        })

        if (result.length > 1) {
          return {
            select: '*',
            table: '(' + result.map(r => compileSelect(r)).join(' UNION ') + ')'
          }
        } else {
          return result[0]
        }
      default:
        throw new Error("Can't compile filter type '" + stmt.constructor.name + "'")
    }
  }

  compileFilterQuery (stmt, options) {
    // postpass queries always require geom
    const fields = ['t.osm_id', 't.osm_type', 't.geom']
    let table = tables[stmt.type] + ' t'

    if (options.properties & GeowikiAPI.TAGS) {
      fields.push('t.tags')
    }
    if (options.properties & GeowikiAPI.MEMBERS) {
      if (stmt.type === 'node') {
        fields.push('\'{}\'::bigint[] as "nodes"')
        fields.push('\'{}\'::jsonb as "members"')
      } else {
        fields.push('w.nodes')
        fields.push('r.members')
        table += " left join planet_osm_ways w on t.osm_type = 'W' and t.osm_id = w.id left join planet_osm_rels r on t.osm_type = 'R' and t.osm_id = r.id"
      }
    }

    const where = this.compileStmtQuery(stmt)

    return {
      select: fields.join(', '),
      table,
      where
    }
  }

  compileStmtQuery (stmt) {
    const filters = stmt.filters.map(filter => {
      if (filter.fun) {
        return compileFunctions[filter.fun](filter)
      } else if (filter.op) {
        return this.compileOperator(filter)
      } else {
        throw new Error("Don't know how to compile filter: " + JSON.stringify(filter))
      }
    }).filter(r => r !== null).join(' AND ')

    return filters
  }

  compileOperator (filter) {
    if (filter.op in compileOperators) {
      if (typeof compileOperators[filter.op] === 'function') {
        return compileOperators[filter.op](filter)
      } else {
        const column = 't.tags->>' + quote(filter.key)
        const value = filter.value ? quote(filter.value) : null
        return column + compileOperators[filter.op] + value
      }
    } else {
      throw new Error("Can't compile operator '" + filter.op + "'")
    }
  }

  execute (context, callback) {
    fetch(this.url + '/interpreter', {
      method: 'POST',
      body: new URLSearchParams({data: context.query})
    })
      .then(req => req.json())
      .then(result => {
        callback(null, convertToOSMJSON(result))
      })
  }
}

function quote (str) {
  return "'" + str.replace(/'/g, "\\'") + "'"
}

function convertToOSMJSON (data) {
  const result = {
    version: 0.6,
    generator: data.postpass_properties.generator,
    timestamp: data.postpass_properties.timestamp,
    elements: []
  }

  data.features.forEach(feature => {
    const item = {
      id: feature.properties.osm_id,
      type: typePostToOSM[feature.properties.osm_type]
    }

    if ('tags' in feature.properties) {
      item.tags = feature.properties.tags
    }

    if (item.type === 'node' && feature.geometry && feature.geometry.type === 'Point') {
      item.lat = feature.geometry.coordinates[1]
      item.lon = feature.geometry.coordinates[0]
    }

    result.elements.push(item)
  })

  return result
}

function compileSelect (def) {
  let result = 'SELECT ' + def.select + ' FROM ' + def.table
  if (def.where) {
    result += ' WHERE ' + def.where
  }

  return result
}

GeowikiAPI.registerDBType('postpass', DBTypePostpass)
module.exports = DBTypePostpass
