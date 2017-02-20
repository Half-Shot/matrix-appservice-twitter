const SQLite3 = require('sqlite3').verbose();
const log = require('./logging.js');
const Promise = require('bluebird');

const CURRENT_SCHEMA = 5;
/**
 * Stores data for specific users and data not specific to rooms.
 */
class TwitterDB {
  /**
   * @param  {string} filepath Location of the SQLite database file.
   */
  constructor (filepath) {
    this.db = new SQLite3.Database(filepath, (err) => {
      if(err) {
        log.error("Error opening database, %s");
        throw new Error("Couldn't open database. The appservice won't be able to continue.");
      }
    });
    this._target_schema = CURRENT_SCHEMA;
    this.db = Promise.promisifyAll(this.db);
    this.version = null;
    const handlers = {};
    handlers.profile = require("./db/profile.js");
    handlers.event = require("./db/event.js");
    handlers.dm = require("./db/dm.js");
    handlers.since = require("./db/since.js");
    handlers.timeline_room = require("./db/timeline_room.js");
    handlers.twitter_account = require("./db/twitter_account.js");

    for(var handler of Object.keys(handlers)) {
      for(var func of Object.keys(handlers[handler])) {
        this[func] = handlers[handler][func];
      }
    }

  }

  /**
   * Checks the database has all the tables needed.
   */
  init () {
    log.info("Starting DB Init");
    var old_version;
    var version;
    return this._get_schema_version().then(o =>{
      old_version = o;
      version = o;
      while(version < this._target_schema) {
        version++;
        var schema = require(`./database_schema/v${version}.js`);
        schema.run(this);
        log.info("Updated database v%s", version);
        this.version = version;
      }
    }).then(() => {
      return this._set_schema_version(old_version, version).then( () => {
        log.info("Updated database to the latest schema");
      });
    }).catch(err => {
      log.error("Couldn't update database to the latest version! Bailing");
      throw err;
    })

  }

  _create (statement, tablename) {
    log.info("_create %s", tablename);
    return this.db.run(statement, (err) => {
      if(err) {
        throw `Error creating '${tablename}': ${err}`;
      }
    });
  }

  close () {
    this.db.close();
  }

  _get_schema_version ( ) {
    log.silly("_get_schema_version");
    return this.db.getAsync(
      `
      SELECT version
      FROM schema
      `
    ).then((row) =>{
      return row === undefined ? 0 : row.version;
    }).catch( ()  => {
      return 0;
    });
  }

  _set_schema_version (old_ver, ver ) {
    log.silly("_set_schema_version => %s", ver);
    return this.db.getAsync(
      `
      UPDATE schema
      SET version = $ver
      WHERE version = $old_ver
      `, {$ver: ver, $old_ver: old_ver}
    );
  }
}

module.exports = TwitterDB;
