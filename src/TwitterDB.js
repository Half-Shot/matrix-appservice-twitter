const SQLite3 = require('sqlite3').verbose();
const log = require('npmlog');
const Promise = require('bluebird');

const CURRENT_SCHEMA = 3;
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
        log.error("TwitDB", "Error opening database, %s");
        throw new Error("Couldn't open database. The appservice won't be able to continue.");
      }
    });
    this._target_schema = CURRENT_SCHEMA;
    this.db = Promise.promisifyAll(this.db);
    this.version = null;
    this.handlers = {};
    this.handlers.profile = require("./db/profile.js");
    this.handlers.event = require("./db/event.js");
    this.handlers.dm = require("./db/dm.js");
    this.handlers.since = require("./db/since.js");
    this.handlers.timeline_room = require("./db/timeline_room.js");
    this.handlers.twitter_account = require("./db/twitter_account.js");

    this.get_profile_by_id = this.handlers.profile.get_profile_by_id;
    this.get_profile_by_name = this.handlers.profile.get_profile_by_name;
    this.cache_user_profile = this.handlers.profile.cache_user_profile;

    this.get_twitter_account = this.handlers.twitter_account.get_twitter_account;
    this.get_matrixid_from_twitterid = this.handlers.twitter_account.get_matrixid_from_twitterid;
    this.get_linked_user_ids = this.handlers.twitter_account.get_linked_user_ids;
    this.set_twitter_account = this.handlers.twitter_account.set_twitter_account;
    this.remove_twitter_account = this.handlers.twitter_account.remove_twitter_account;

    this.get_timeline_room = this.handlers.timeline_room.get_timeline_room;
    this.set_timeline_with_option = this.handlers.timeline_room.set_timeline_with_option;
    this.set_timeline_replies_option = this.handlers.timeline_room.set_timeline_replies_option;
    this.set_timeline_room = this.handlers.timeline_room.set_timeline_room;
    this.remove_timeline_room = this.handlers.timeline_room.remove_timeline_room;

    this.get_dm_room = this.handlers.dm.get_dm_room;
    this.get_users_from_dm_room = this.handlers.dm.get_users_from_dm_room;
    this.add_dm_room = this.handlers.dm.add_dm_room;

    this.get_since = this.handlers.since.get_since;
    this.set_since = this.handlers.since.set_since;

    this.add_event = this.handlers.event.add_event;
    this.get_event_by_event_id = this.handlers.event.get_event_by_event_id;
    this.get_event_by_twitter_id = this.handlers.event.get_event_by_twitter_id;

  }

  /**
   * Checks the database has all the tables needed.
   */
  init () {
    log.info("TwitDB", "Starting DB Init");
    var old_version;
    var version;
    return this._get_schema_version().then(o =>{
      old_version = o;
      version = o;
      while(version < this._target_schema) {
        version++;
        var schema = require(`./database_schema/v${version}.js`);
        schema.run(this);
        log.info("TwitDB", "Updated database v%s", version);
        this.version = version;
      }
    }).then(() => {
      return this._set_schema_version(old_version, version).then( () => {
        log.info("TwitDB", "Updated database to the latest schema");
      });
    }).catch(err => {
      log.error("TwitDB", "Couldn't update database to the latest version! Bailing");
      throw err;
    })

  }

  _create (statement, tablename) {
    log.info("SQL", "_create %s", tablename);
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
    log.silly("SQL", "_get_schema_version");
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
    log.silly("SQL", "_set_schema_version => %s", ver);
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
