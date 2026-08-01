const geojson2elements = require('@geowiki-net/geowiki-api/src/geojson2elements')

function geojson2element (data, options) {
  const elements = []
  let element

  if (data.type !== 'Feature') {
    throw new Error('Unknown type ' + data.type)
  }

  const osmType = data.properties.osm_type

  if (!data.geometry) {
    return {}
  }

  switch (data.geometry.type) {
    case 'Point':
      element = {
        type: 'node',
        lon: data.geometry.coordinates[0],
        lat: data.geometry.coordinates[1]
      }
      break
    case 'LineString':
      element = {
        type: 'way',
        geometry: data.geometry.coordinates.map(c => {
          return { lon: c[0], lat: c[1] }
        })
      }
      break
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon':
    case 'Polygon':
    case 'GeometryCollection':
      geojson2elements(data, elements, options)

      if (osmType === 'W') {
        element = elements[0]
      } else {
        element = {
          type: 'relation',
          geometryMembers: elements.map(member => {
            if (member.type === 'relation') {
              if (member.members) {
                member.members.forEach(memberMember => {
                  delete memberMember.ref
                })
              }

              return member.members
            } else {
              return {
                type: 'way',
                role: 'outer',
                geometry: member.geometry
              }
            }
          }).flat()
        }
      }

      break
    default:
      console.log('Unknown geometry type ' + data.geometry.type)
      return
  }

  return element
}

module.exports = geojson2element
