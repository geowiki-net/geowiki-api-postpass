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
  constructor (url, geowiki, options) {
    this.url = url
    this.geowiki = geowiki
    this.options = options

    this.geowiki.separateSkelGeom = true
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

    return [compileSelect(result), { needFilter: result.needFilter }]
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
        let needFilter = false

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

          if (part.needFilter) {
            needFilter = true
          }
        })

        result.forEach(r => {
          r.where = ['(' + r.where.map(w => '(' + w.join(' AND ') + ')').join(' OR ') + ')']
        })

        if (result.length > 1) {
          return {
            select: '*',
            table: '(' + result.map(r => compileSelect(r)).join(' UNION ') + ') t',
            where: [],
            needFilter
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
    const fields = ['t.osm_id', 't.osm_type']
    let table = tables[stmt.type] + ' t'

    if (options.properties & GeowikiAPI.GEOM) {
      fields.push('t.geom')
    } else if (options.properties & (GeowikiAPI.BBOX|GeowikiAPI.CENTER)) {
      // split multipolygons in west/east parts, so that we can catch geometries spanning lon180
      fields.push('cast(Box2D(ST_Collect(ARRAY(SELECT g.geom FROM ST_Dump(geom) g WHERE ST_XMin(g.geom) < 0))) as text) bbox_west, cast(Box2D(ST_Collect(ARRAY(SELECT geom FROM ST_Dump(geom) g WHERE ST_XMin(g.geom) >= 0))) as text) bbox_east')
    }

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

    const [where, needFilter] = this.compileStmtQuery(stmt)

    return {
      select: fields.join(', '),
      table,
      where,
      needFilter
    }
  }

  compileStmtQuery (stmt) {
    let needFilter = false

    const filters = stmt.filters.map(filter => {
      if (filter.fun) {
        if (!(filter.fun in compileFunctions)) {
          console.error("Don't know how to compile filter function: " + JSON.stringify(filter))
          needFilter = true
        }
        return compileFunctions[filter.fun](filter)
      } else if (filter.op) {
        return this.compileOperator(filter)
      } else {
        console.error("Don't know how to compile filter: " + JSON.stringify(filter))
        needFilter = true
      }
    }).filter(r => {
      if (r === false) {
        needFilter = true
      }
      return true
    }).filter(r => r !== null && r !== false)

    return [filters, needFilter]
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
      console.error("Can't compile operator '" + filter.op + "'")
      return false
    }
  }

  execute (context, callback) {
    const query =
      context.subRequests.map(c => c.query).join('\nUNION ALL\n')

    fetch(this.url + '/interpreter', {
      method: 'POST',
      body: new URLSearchParams({data: query, 'options[geojson]': false })
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

  data.result.forEach(feature => {
    for (; statementId < feature.rid; statementId++) {
      result.elements.push({ type: 'count' })
    }

    if (feature.geom) {
      delete feature.geom.crs
    }
    const item = geojson2element({ type: 'Feature', properties: { osm_id: feature.osm_id, osm_type: feature.osm_type }, geometry: feature.geom }, {})

    item.type = typePostToOSM[feature.osm_type]
    item.id = feature.osm_id

    if ('tags' in feature) {
      item.tags = feature.tags
    } else {
      delete(item.tags)
    }

    if (feature.bbox_west || feature.bbox_east) {
      const bounds = {
        east: box2bounds(feature.bbox_east),
        west: box2bounds(feature.bbox_west)
      }

      if (bounds.east && bounds.west) {
        item.bounds = {
          minlat: Math.min(bounds.east.minlat, bounds.west.minlat),
          maxlat: Math.max(bounds.east.maxlat, bounds.west.maxlat)
        }

        if (bounds.east.maxlon - bounds.west.minlon < 360 - bounds.west.maxlon - bounds.east.minlon) {
          item.bounds.minlon = bounds.east.maxlon
          item.bounds.maxlon = bounds.west.minlon
        } else {
          item.bounds.maxlon = bounds.west.maxlon
          item.bounds.minlon = bounds.east.minlon
        }
      } else {
        item.bounds = bounds.east || bounds.west
      }
    }

    if (item.type === 'node') {
      if (item.bounds) {
        item.lat = item.bounds.minlat
        item.lon = item.bounds.minlon
        delete item.bounds
      }
    }
    if (item.type === 'way' && feature.nodes) {
      item.nodes = feature.nodes
    }
    if (item.type === 'relation') {
      if (feature.members) {
        item.members = feature.members
      }

      if (feature.geom && item.tags && feature.geom.type === 'MultiPolygon') {
        item.tags.type = 'multipolygon'
      }

      if (feature.geom && feature.geom.type === 'MultiPolygon' && feature.geom.coordinates.length === 1) {
        feature.geom.type = 'Polygon'
        feature.geom.coordinates = feature.geom.coordinates[0]
      } else if (feature.geom && feature.geom.type === 'MultiLineString' && feature.geom.coordinates.length === 1) {
        feature.geom.type = 'LineString'
        feature.geom.coordinates = feature.geom.coordinates[0]
      }

      if (feature.geom) {
        item.databaseGeometry = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: feature.geom
          }]
        }
      }
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

function box2bounds (str) {
  if (!str) {
    return null
  }

  const coords = str.match(/^BOX\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/)
  return {
    minlon: parseFloat(coords[1]),
    minlat: parseFloat(coords[2]),
    maxlon: parseFloat(coords[3]),
    maxlat: parseFloat(coords[4])
  }
}

GeowikiAPI.registerDBType('postpass', DBTypePostpass)
module.exports = DBTypePostpass
