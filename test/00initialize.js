const assert = require('assert')

describe('DBTypePostpass', function () {
  let db
  let geowiki

  it('initialize', function () {
    db = require('./src/dbTypePostpass')
    geowiki = require('./src/geowikiAPI')
  })

  it('test server availability', function (done) {
    db.execute({subRequests:[{parts:[{query: 'SELECT 1'}]}]},
      (err, result) => {
        if (err) {
          assert.fail('Server problem: ' + err.cause)
          return done()
        }

        done()
      }
    )
  })
})
