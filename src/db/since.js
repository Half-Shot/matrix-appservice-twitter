const log = require('npmlog');

module.exports = {
  get_since: function (id) {
    log.silly("SQL", "get_since => %s", id);
    return this.db.getAsync(
      `
      SELECT since
      FROM twitter_since
      WHERE twitter_since.id = $id;
      `
    , {
      $id: id
    }).then(row => {
      return row !== undefined ? row.since : null;
    }).catch( err => {
      log.error("TwitDB", "Error getting since value: %s", err.Error);
      throw err;
    });
  },

  set_since: function (id, since) {
    log.silly("SQL", "set_since => %s", id);
    return this.db.runAsync(
      `
      REPLACE INTO twitter_since (id,since) VALUES ($id,$since);
      `
    , {
      $id: id,
      $since: since
    }).catch(err => {
      log.error("TwitDB", "Error storing twitter since value: %s", err);
      throw err;
    });
  }
}
