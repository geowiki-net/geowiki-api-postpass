const GeowikiAPI = require('@geowiki-net/geowiki-api')
const geojson2element = require('./geojson2element')

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

    this.separateSkelGeom = true
  }

  compile (query, options) {
    const stmt = query.getStatement()

    let result = this.compileStmt(stmt, options)

    if ('requestId' in options) {
      result.select += ', ' + options.requestId + ' as "rid"'
    }

    if (options.bounds) {
      result.where.push('geom && st_setsrid(st_makebox2d(st_makepoint(' + options.bounds.minlon + ',' + options.bounds.minlat + '), st_makepoint(' + options.bounds.maxlon + ',' + options.bounds.maxlat + ')), 4326)')
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
        result.where.push('NOT (osm_type=' + quote(typeOSMToPost[type]) + ' AND osm_id = ANY(ARRAY[' + ids.join(',') + ']))')
      })
    }

    if ('split' in options && options.split > 0) {
      result.limit = options.split
    } else if ('effortSplit' in options) {
      result.limit = options.effortSplit
    }

    return compileSelect(result)
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
          r.where = ['(' + r.where.map(w => '(' + w.join(' AND ') + ')').join(' OR ') + ')']
        })

        if (result.length > 1) {
          return {
            select: '*',
            table: '(' + result.map(r => compileSelect(r)).join(' UNION ') + ') t',
            where: []
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
    }).filter(r => r !== null)

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
    console.log(context.query)
    fetch(this.url + '/interpreter', {
      method: 'POST',
      body: new URLSearchParams({data: context.query})
    })
      .then(req => req.text())
      .then(result => {
        try {
          result = JSON.parse(result)
        }
        catch (err) {
          return global.setTimeout(() => callback(new Error('Unexpected result: ' + result)), 0)
        }

        try {
          result = convertToOSMJSON(result)
        }
        catch (err) {
          return global.setTimeout(() => callback(err), 0)
        }

        global.setTimeout(() => callback(null, result), 0)
      })
      .catch(err => {
        global.setTimeout(() => callback(err), 0)
      })
  }

  mergeQueries (queries) {
    return queries.join('\nUNION ALL\n')
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
  let statementId = 0

  data.features.forEach(feature => {
    for (; statementId < feature.properties.rid; statementId++) {
      result.elements.push({ type: 'count' })
    }

    const item = geojson2element(feature, {})

    item.type = typePostToOSM[feature.properties.osm_type]
    item.id = feature.properties.osm_id

    if ('tags' in feature.properties) {
      item.tags = feature.properties.tags
    } else {
      delete(item.tags)
    }

    if (item.type === 'way' && feature.properties.nodes) {
      item.nodes = feature.properties.nodes
    }
    if (item.type === 'relation' && feature.properties.members) {
      if (item.members) {
        item.geometry = item.members
      }
      item.members = feature.properties.members
    }

    result.elements.push(item)
  })

  return result
}

function compileSelect (def) {
  let result = 'SELECT ' + def.select + ' FROM ' + def.table
  if (def.where && def.where.length) {
    result += ' WHERE ' + def.where.join(' AND ')
  }

  if (def.limit) {
    result = '(' + result + ' LIMIT ' + def.limit + ')'
  }

  return result
}

GeowikiAPI.registerDBType('postpass', DBTypePostpass)
module.exports = DBTypePostpass
