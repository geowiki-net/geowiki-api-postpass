const GeowikiAPI = require('@geowiki-net/geowiki-api')
const geojson2element = require('./geojson2element')
const BoundingBox = require('boundingbox')
const compileFilter = require('./compileFilter')
const quote = require('./quote')

const typePostToOSM = { N: 'node', W: 'way', R: 'relation' }
const typeOSMToPost = { node: 'N', way: 'W', relation: 'R' }

const tables = {
  nwr: 'postpass_pointlinepolygon',
  node: 'postpass_point',
  way: "(SELECT osm_id, osm_type, tags, geom FROM postpass_line WHERE osm_type='W' UNION ALL SELECT osm_id, osm_type, tags, geom FROM postpass_polygon WHERE osm_type='W')",
  relation: "(SELECT osm_id, osm_type, tags, geom FROM postpass_pointlinepolygon WHERE osm_type='R')"
}

const allFields = ['osm_id', 'osm_type', 'tags', 'nodes', 'members', 'geom', 'bboxes']

class DBTypePostpass {
  constructor (url, geowiki, options) {
    this.url = url
    this.geowiki = geowiki
    this.options = options
  }

  compile (query, options) {
    const stmt = query.getStatement()
    const compileSelectOptions = {}

    const result = this.compileStmt(stmt, options)

    if ('requestId' in options) {
      result.select.rid = options.requestId + ' as "rid"'
      compileSelectOptions.fields = allFields.concat(['rid'])
    }

    if (options.bounds) {
      result.where.push('geom && st_setsrid(st_makebox2d(st_makepoint(' + options.bounds.minlon + ',' + options.bounds.minlat + '), st_makepoint(' + options.bounds.maxlon + ',' + options.bounds.maxlat + ')), 4326)')
    }

    if (options.doneFeatures) {
      const donePerType = {}
      Object.values(options.doneFeatures).forEach(item => {
        if (!(item.type in donePerType)) {
          donePerType[item.type] = []
        }
        donePerType[item.type].push(item.osm_id)
      })

      Object.entries(donePerType).forEach(([type, ids]) => {
        result.where.push('NOT (osm_type=' + quote(typeOSMToPost[type]) + ' AND osm_id=ANY(ARRAY[' + ids.join(',') + ']))')
      })
    }

    if ('split' in options && options.split > 0) {
      result.limit = options.split
    } else if ('effortSplit' in options) {
      result.limit = options.effortSplit
    }

    return [compileSelect(result, compileSelectOptions), { needFilter: result.needFilter }]
  }

  compileStmt (stmt, options) {
    let parts
    let result
    let needFilter = false

    switch (stmt.constructor.name) {
      case 'FilterQuery':
        return this.compileFilterQuery(stmt, options)
      case 'FilterOr':
        parts = stmt.parts.map(part => this.compileStmt(part, options))

        result = [parts.shift()]
        result[0].where = [result[0].where]
        parts.forEach((part, i) => {
          if (!result.some(r => {
            if (r.table === part.table) {
              r.where.push(part.where)
              return true
            }
            return false
          })) {
            // recompile with different tableAlias
            const o = {...options, tableAlias: options.tableAlias + i}
            part = this.compileStmt(stmt.parts[i], o)

            part.where = [part.where]
            result.push(part)
          }

          if (part.needFilter) {
            needFilter = true
          }
        })

        result.forEach(r => {
          const operands = r.where.map(w => '(' + w.join(' AND ') + ')')

          // if any of the operands (to OR) are TRUE, we don't need the other operands
          if (operands.filter(o => o === '()').length > 0) {
            r.where = ['TRUE']
          } else {
            r.where = ['(' + operands.join(' OR ') + ')']
          }
        })

        if (result.length > 1) {
          return {
            select: Object.fromEntries(allFields.map(f => {
              return [f, f]
            })),
            table: '(' + result.map(r => compileSelect(r)).join(' UNION ALL ') + ') t',
            where: [],
            needFilter
          }
        } else {
          return result[0]
        }
      case 'FilterDiff':
        parts = stmt.parts.map(part => this.compileStmt(part, options))
        result = parts[0]

        if (parts[0].table === parts[1].table) {
          result.where.push('NOT (' + parts[1].where.join(' AND ') + ')')
        } else {
          parts[1] = this.compileStmt(stmt.parts[1], {...options, tableAlias: 'p'})
          result.table = parts[0].table + ' LEFT JOIN ' + parts[1].table + ' ON t.osm_type=p.osm_type AND t.osm_id=p.osm_id'
          result.where.push('(p.osm_id IS NULL OR NOT (' + parts[1].where.join(' AND ') + '))')
        }

        return result
      default:
        throw new Error("Can't compile filter type '" + stmt.constructor.name + "'")
    }
  }

  /**
   * @param [options.tableAlias=t] which name to be used as alias
   */
  compileFilterQuery (stmt, options) {
    let distinct = false
    let recurseTables = ''
    let requireMemberTables = false

    if (!options.tableAlias) {
      options.tableAlias = 't'
    }

    const tableAlias = options.tableAlias
    // postpass queries always require geom
    let select = {
      osm_id: `${tableAlias}.osm_id`,
      osm_type: `${tableAlias}.osm_type`
    }
    let table = tables[stmt.type] + ' ' + tableAlias

    if (options.properties & GeowikiAPI.GEOM) {
      select.geom = `${tableAlias}.geom`
    } else if (options.properties & (GeowikiAPI.BBOX | GeowikiAPI.CENTER)) {
      // split multipolygons in west/east parts, so that we can catch geometries spanning lon180
      select.bboxes = `ARRAY(SELECT CAST(Box2D(geom) AS text) from ST_Dump(${tableAlias}.geom)) bboxes`
    }

    if (options.properties & GeowikiAPI.TAGS) {
      select.tags = `${tableAlias}.tags`
    }
    if (options.properties & GeowikiAPI.MEMBERS) {
      if (stmt.type === 'node') {
        select.nodes = '\'{}\'::bigint[] AS "nodes"'
        select.members = '\'{}\'::jsonb AS "members"'
      } else {
        select.nodes = `${tableAlias}w.nodes`
        select.members = `${tableAlias}r.members`
        requireMemberTables = true
      }
    }

    let [where, filterOptions] = this.compileStmtQuery(stmt, options)
    let needFilter = filterOptions.needFilter

    if (stmt.inputSets) {
      const recursingInputSets = Object.entries(stmt.inputSets)
        .filter(s => s[1].recurse)
      const normalInputSets = Object.entries(stmt.inputSets)
        .filter(s => !s[1].recurse)

      if (recursingInputSets.length) {
        recursingInputSets.forEach((set, i) => {
          const revOptions = {...options, tableAlias: 't' + i}
          if (['w', 'r'].includes(set[1].recurse)) {
            revOptions.properties |= GeowikiAPI.MEMBERS

            if (set[1].recurse === 'r') {
              revOptions.requireMemberUnnest = true
            }
          }

          const r = this.compileStmt(set[1].set, revOptions)
          switch (set[1].recurse) {
            case 'w':
              r.select = {
                osm_id: `UNNEST(${revOptions.tableAlias}w.nodes) osm_id`,
                osm_type: "'N' osm_type",
              }
              if (options.properties & (GeowikiAPI.GEOM|GeowikiAPI.CENTER|GeowikiAPI.BBOX)) {
                r.select.geom = `(ST_DumpPoints(${tableAlias}.geom)).geom geom`
              }
              break
            case 'r':
              r.select = {
                osm_id: `${revOptions.tableAlias}.osm_id`,
                osm_type: `${revOptions.tableAlias}.osm_type`,
                ref: `${revOptions.tableAlias}m.ref`,
                type: `${revOptions.tableAlias}m.type`,
                role: `${revOptions.tableAlias}m.role`
              }
              break
            case 'bn':
              r.select = {
                osm_id: `${revOptions.tableAlias}.osm_id`,
                osm_type: "'N' osm_type",
              }
              break
            case 'bw':
            case 'br':
              r.select = {
                osm_id: `${revOptions.tableAlias}.osm_id`,
                osm_type: `${revOptions.tableAlias}.osm_type`
              }
              break
            default:
              throw new Error('unsupported recursing type "' + set[1].recurse + '"')
          }

          if (set[1].recurse === 'w') {
            r.distinct = true
            const rtable = compileSelect(r, { fields: Object.keys(r.select) })
            recurseTables += ' JOIN (' + rtable + ') r' + i + ' ON ' + tableAlias + '.osm_id=r' + i + '.osm_id AND ' + tableAlias + '.osm_type=r' + i + '.osm_type'

            select.osm_id = `r${i}.osm_id`
            select.osm_type = `r${i}.osm_type`
            if (options.properties & GeowikiAPI.GEOM) {
              select.geom = `r${i}.geom`
            }
          }
          else if (set[1].recurse === 'r') {
            r.distinct = true
            let rtable = compileSelect(r, { fields: Object.keys(r.select) })
            recurseTables += ' JOIN (' + rtable + ') r' + i + ' ON ' + tableAlias + '.osm_id=r' + i + '.ref AND ' + tableAlias + '.osm_type=r' + i + '.type'
          }
          else if (set[1].recurse === 'bn') {
            distinct = true
            const rtable = compileSelect(r, { fields: Object.keys(r.select) })
            requireMemberTables = true
            if (stmt.type !== 'relation') {
              recurseTables += ` LEFT JOIN LATERAL UNNEST(${tableAlias}w.nodes) AS n${i}(ref) ON TRUE`
            }
            if (stmt.type !== 'way') {
              recurseTables += ` LEFT JOIN LATERAL jsonb_to_recordset(${tableAlias}r.members) AS m${i}(ref BIGINT, role TEXT, type TEXT) ON TRUE`
            }

            recurseTables += ' JOIN (' + rtable + ') r' + i + ' ON '

            const on = []
            if (stmt.type !== 'relation' && !set[1].role) {
              on.push('r' + i + '.osm_id=n' + i + '.ref AND r' + i + ".osm_type='N'")
            }
            if (stmt.type !== 'way') {
              on.push('r' + i + '.osm_id=m' + i + '.ref AND r' + i + '.osm_type=m' + i + '.type' + ('role' in set[1] ? ' AND m' + i + '.role=' + quote(set[1].role) : ''))
            }

            if (on.length > 1) {
              recurseTables += on.map(v => '(' + v + ')').join(' OR ')
            } else {
              recurseTables += on[0]
            }
          }
          else if (['bw', 'br'].includes(set[1].recurse)) {
            distinct = true
            const rtable = compileSelect(r, { fields: Object.keys(r.select) })
            requireMemberTables = true
            recurseTables += ` LEFT JOIN LATERAL jsonb_to_recordset(${tableAlias}r.members) AS m${i}(ref BIGINT, role TEXT, type TEXT) ON TRUE`

            recurseTables += ' JOIN (' + rtable + ') r' + i + ' ON ' + 'r' + i + '.osm_id=m' + i + '.ref AND r' + i + '.osm_type=m' + i + '.type' + ('role' in set[1] ? ' AND m' + i + '.role=' + quote(set[1].role) : '')
          }
        })
      }

      normalInputSets.forEach((set, i) => {
        const r = this.compileStmt(set[1].set, options)

        if (table !== r.table) {
          if (stmt.type === 'nwr') {
            table = r.table
            select = r.select
            requireMemberTables = r.requireMemberTables
          } else if (set[1].set.type !== 'nwr') {
            const setOptions = {...options}
            if (stmt.type !== 'nwr') {
              setOptions.tableAlias = 't' + i
            }

            // re-compile again with different table name
            const r = this.compileStmt(set[1].set, setOptions)

            recurseTables += ` JOIN ${r.table} ON ${tableAlias}.osm_id=${options.tableAlias}.osm_id AND ${tableAlias}.osm_type=${options.tableAlias}.osm_type`
          }
        }

        where = r.where.concat(where)
        if (r.needFilter) {
          needFilter = true
        }
      })
    }

    if (requireMemberTables || options.requireMemberUnnest) {
      table += ` LEFT JOIN planet_osm_ways ${tableAlias}w ON ${tableAlias}.osm_type='W' AND ${tableAlias}.osm_id=${tableAlias}w.id LEFT JOIN planet_osm_rels ${tableAlias}r ON ${tableAlias}.osm_type='R' AND ${tableAlias}.osm_id=${tableAlias}r.id`
      requireMemberTables = false

      if (options.requireMemberUnnest) {
        table += ` LEFT JOIN LATERAL jsonb_to_recordset(${tableAlias}r.members) AS ${tableAlias}m(ref BIGINT, role TEXT, type TEXT) ON TRUE`
      }
    }

    table += recurseTables

    return {
      select,
      distinct,
      requireMemberTables,
      table,
      where,
      needFilter
    }
  }

  compileStmtQuery (stmt, options) {
    let stmtOptions = {}
    const filters = []

    stmt.filters.forEach(filter => {
      const result = compileFilter(filter, options)

      if (result[0] !== null) {
        filters.push(result[0])
      }
      stmtOptions = { ...stmtOptions, ...result[1] }
    })

    return [filters, stmtOptions]
  }

  execute (context, callback) {
    const query =
      context.subRequests.map(c => c.parts.map(p => p.query).join('\nUNION ALL\n')).join('\nUNION ALL\n')

    fetch(this.url + '/interpreter', {
      method: 'POST',
      body: new URLSearchParams({ data: query, 'options[geojson]': false })
    })
      .then(req => req.text())
      .then(result => {
        try {
          result = JSON.parse(result)
        } catch (err) {
          return global.setTimeout(() => callback(new Error('Unexpected result: ' + result)), 0)
        }

        try {
          result = convertToOSMJSON(result)
        } catch (err) {
          return global.setTimeout(() => callback(err), 0)
        }

        global.setTimeout(() => callback(null, result), 0)
      })
      .catch(err => {
        global.setTimeout(() => callback(err), 0)
      })
  }
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
      delete (item.tags)
    }

    if (feature.bboxes) {
      item.bounds = new BoundingBox(box2bounds(feature.bboxes[0]))
      feature.bboxes.slice(1).forEach(b => item.bounds.extend(box2bounds(b)))
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
        item.geometry = {
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

function compileSelect (def, options = {}) {
  const select = (options.fields || allFields)
    .map(f => f in def.select ? def.select[f] : 'NULL AS "' + f + '"')
    .join(', ')

  let result = 'SELECT ' + (def.distinct ? 'DISTINCT ' : '') + select + ' FROM ' + def.table
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
