const GeowikiAPI = require('@geowiki-net/geowiki-api')

const postOp = {
  '=': '=',
  '~': '~',
}

const typePostToOSM = { N: 'node', W: 'way', R: 'relation' }
const typeOSMToPost = { node: 'N', way: 'W', relation: 'R' }

const tables = {
  nwr: 'postpass_pointlinepolygon',
  node: 'postpass_point',
  way: "(SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W')",
  relation: "(SELECT osm_id, osm_type, tags, geom FROM postpass_pointlinepolygon WHERE osm_type='R')"
}

class DBTypePostpass {
  constructor (url, options) {
    this.url = url
    this.options = options
  }

  compile (query, options) {
    const stmt = query.getStatement()

    let result = this.compileStmt(stmt, options)
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
        return '(' + stmt.parts.map(part => this.compileStmt(part, options)).join(') UNION (') + ')'
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

    return 'SELECT ' + fields.join(', ') + ' FROM ' + table + (where ? ' WHERE ' + where : '')
  }

  compileStmtQuery (stmt) {
    const filters = stmt.filters.map(filter => {
      if (filter.fun === 'id') {
        return 'osm_id = ANY(\'{' + filter.value.join(',') + '}\')'
      } else if (filter.fun === 'properties') {
        return null
      } else if (filter.fun === 'bbox') {
        return 'geom && st_setsrid(st_makebox2d(st_makepoint(' + filter.value.minlon + ',' + filter.value.minlat + '), st_makepoint(' + filter.value.maxlon + ',' + filter.value.maxlat + ')), 4326)'
      } else if (filter.op) {
        return this.compileOp(filter)
      } else {
        throw new Error("Don't know how to compile filter: " + JSON.stringify(filter))
      }
    }).filter(r => r !== null).join(' AND ')

    return filters
  }

  compileOp (filter) {
    const column = 't.tags->>' + quote(filter.key)
    const value = filter.value ? quote(filter.value) : null

    switch (filter.op) {
      case 'has_key':
        return 't.tags?' + quote(filter.key)
      default:
        if (!(filter.op in postOp)) {
          throw new Error("Can't compile operator '" + filter.op + "'")
        }
        return column + postOp[filter.op] + value
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

GeowikiAPI.registerDBType('postpass', DBTypePostpass)
module.exports = DBTypePostpass
