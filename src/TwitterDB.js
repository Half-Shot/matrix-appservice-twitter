const SQLite3 = require('sqlite3').verbose();
const log = require('npmlog');

const TWITTER_PROFILE_INTERVAL_MS   = 300000;
const RATELIMIT_PROFILE_CACHE   = 10000;

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
        throw "Couldn't open database. The appservice won't be able to continue.";
      }
    });
    this.db = Promise.promisifyAll(this.db);
    this._profile_cache_ts = new Map();
    this._profile_cache = new Map();
  }

  /**
   * Checks the database has all the tables needed.
   */
  init () {
    log.info("TwitDB", "Starting DB Init");
    return Promise.all([this._create(`
      CREATE TABLE IF NOT EXISTS user_cache (
        id	INTEGER UNIQUE NOT NULL,
        screenname TEXT NOT NULL,
        profile	TEXT NOT NULL,
        timestamp	INTEGER NOT NULL,
        PRIMARY KEY(id)
      )
      `, "user_cache"),
    this._create(`
      CREATE TABLE IF NOT EXISTS twitter_account (
        user_id	TEXT UNIQUE NOT NULL,
        oauth_token TEXT,
        oauth_secret	TEXT,
        access_token TEXT,
        access_token_secret	TEXT,
        twitter_id	INTEGER,
        access_type STRING,
        PRIMARY KEY(user_id)
      )
      `, "twitter_account"),
    this._create(`
      CREATE TABLE IF NOT EXISTS timeline_room (
        user_id	TEXT UNIQUE NOT NULL,
        room_id	TEXT NOT NULL,
        PRIMARY KEY(user_id)
      )
      `, "timeline_room"),
    this._create(`
      CREATE TABLE IF NOT EXISTS dm_room (
      	room_id	TEXT NOT NULL,
      	users	TEXT NOT NULL,
      	PRIMARY KEY(room_id)
      );
      `, "dm_room"),
    this._create(`
      CREATE TABLE IF NOT EXISTS twitter_since (
      	id TEXT NOT NULL,
      	since	INTEGER,
      	PRIMARY KEY(id)
      );
      `, "twitter_since")]);
  }

  _create (statement, tablename) {
    log.silly("SQL", "_create %s", tablename);
    return this.db.runAsync(statement).catch( err => {
      if(err) {
        throw `Error creating '${tablename}': ${err}`;
      }
    });
  }

  close () {
    this.db.close();
  }

  /**
   * Get a twitter profile by a twitter id
   * @param {integer} id A twitter id
   * @returns {Promise<object>} A Twitter profile
   */
  get_profile_by_id (id) {
    log.silly("SQL", "get_profile_by_id => %s", id);
    return this.db.getAsync(
      `
      SELECT profile, timestamp
      FROM user_cache
      WHERE user_cache.id = $id;
      `
    , {
      $id: id
    }).then((profile) =>{
      if(profile !== undefined) {
        var ts = new Date().getTime();
        if(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS) {
          return null;
        }
        return JSON.parse(profile.profile);
      }
      else {
        return null;
      }
    }).catch( err  => {
      log.error("TwitDB", "Error retrieving profile: %s", err.Error);
      throw err;
    });
  }

  /**
   * Get a Twitter profile by the screenname of a user.
   * @param {string} name A twitter screen name.
   * @returns {Promise<object>} A Twitter profile
   */
  get_profile_by_name (name) {
    log.silly("SQL", "get_profile_by_name => %s", name);
    return this.db.getAsync(
      `
      SELECT profile, timestamp
      FROM user_cache
      WHERE user_cache.screenname = $name;
      `
    , {
      $name: name
    }).then((profile) =>{
      if(profile !== undefined) {
        var ts = new Date().getTime();
        if(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS) {
          return null;
        }
        return JSON.parse(profile.profile);
      }
      else {
        return null;
      }
    }).catch( err => {
      log.error("TwitDB", "Error retrieving profile: %s", err.Error);
      throw err;
    });
  }

  /**
   * Insert/Update a Twitter profile into the database.
   * @param  {type} id          Twitter ID of the profile.
   * @param  {string} name      screenname of the profile.
   * @param  {object} data      The profile data.
   * @param  {number} timestamp The time when this data was *fetched*.
   */
  cache_user_profile (id, name, data, timestamp) {
    log.silly("SQL", "cache_user_profile => %s", id);

    if (this._profile_cache_ts.has(id)) {
      let nextCache = this._profile_cache_ts.get(id) + RATELIMIT_PROFILE_CACHE;
      if(nextCache > Date.now()) {
        log.verbose("TwitDB", "Didn't cache profile because it was too soon. %s", id);
        return Promise.resolve();
      }
    }

    return this.db.runAsync(
      `
      REPLACE INTO user_cache (id,screenname,profile,timestamp) VALUES ($id,$name,$data,$timestamp);
      `
    , {
      $id: id,
      $name: name,
      $data: JSON.stringify(data),
      $timestamp: timestamp
    }).then(() => {
      this._profile_cache_ts.set(id, Date.now());
    }).catch( err => {
      log.error("TwitDB", "Error storing profile: %s", err);
      throw err;
    });
  }

  get_twitter_account (user_id) {
    log.silly("SQL", "get_twitter_account => %s", user_id);
    return this.db.getAsync(
      `
      SELECT *
      FROM twitter_account
      WHERE twitter_account.user_id = $id;
      `
    , {
      $id: user_id
    }).then( row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error retrieving client data: %s", err.Error);
      throw err;
    });
  }

  get_matrixid_from_twitterid (twitter_id) {
    log.silly("SQL", "get_matrixid_from_twitterid => %s", twitter_id);
    return this.db.getAsync(
      `
      SELECT user_id
      FROM twitter_account
      WHERE twitter_id = $id
      `
      , {
        $id: twitter_id
      }).then( row =>{
        return row !== undefined ? row.user_id : null;
      }).catch( err => {
        log.error("TwitDB", "Error retrieving linked userid: %s", err.Error);
        throw err;
      });
  }

  get_linked_user_ids () {
    log.silly("SQL", "get_linked_user_ids");
    return this.db.allAsync(
      `
      SELECT user_id
      FROM twitter_account
      WHERE access_token IS NOT NULL
      `
    ).then(rows => {
      if(rows !== undefined) {
        rows.forEach(function (val, i, arr) { arr[i] = val.user_id; });
        return rows;
      }
      else {
        return [];
      }
    }).catch(err => {
      log.error("TwitDB", "Error retrieving linked ids: %s", err.Error);
      throw err;
    });
  }

  set_twitter_account (user_id, twitter_id, data) {
    log.silly("SQL", "set_twitter_account => %s", twitter_id);
    return this.db.runAsync(
      `
      REPLACE INTO twitter_account (
        user_id,
        oauth_token,
        oauth_secret,
        access_token,
        access_token_secret,
        access_type,
        twitter_id
      ) VALUES (
        $user_id,
        $oauth_token,
        $oauth_secret,
        $access_token,
        $access_token_secret,
        $access_type,
        $twitter_id
      );
      `
    , {
      $user_id: user_id,
      $twitter_id: twitter_id,
      $oauth_token: data.oauth_token,
      $oauth_secret: data.oauth_secret,
      $access_token: data.access_token,
      $access_token_secret: data.access_token_secret,
      $access_type: data.access_type
    }).then(() => {
      log.info("TwitDB", "Stored client data for %s", user_id);
    }).catch(err => {
      log.error("TwitDB", "Error storing client data: %s", err);
      throw err;
    });
  }

  get_timeline_room (user_id) {
    log.silly("SQL", "get_timeline_room => %s", user_id);
    return this.db.getAsync(
        `
        SELECT room_id
        FROM timeline_room
        WHERE user_id = $user_id;
        `
      , {
        $user_id: user_id
      }).then(row => {
        return row !== undefined ? row.room_id : null;
      }).catch(err => {
        log.error("TwitDB", "Error retrieving timeline room: %s", err.Error);
        throw err;
      });
  }

  set_timeline_room (user_id, room_id) {
    log.silly("SQL", "set_timeline_room => %s", room_id);
    return this.db.runAsync(
      `
      REPLACE INTO timeline_room (user_id,room_id)
      VALUES ($user_id,$room_id)
      `
    , {
      $user_id: user_id,
      $room_id: room_id
    }).catch( err => {
      log.error("TwitDB", "Error storing timeline room for user: %s", err);
      throw err;
    });
  }

  remove_timeline_room (user_id) {
    log.silly("SQL", "remove_timeline_room => %s", user_id);
    return this.db.runAsync(
      `
      DELETE FROM timeline_room
      WHERE timeline_room.user_id = $user_id;
      `
    , {
      $user_id: user_id
    }).catch(err => {
      log.error("TwitDB", "Error deleting timeline room for user: %s", err);
      throw err;
    });
  }

  remove_client_data (user_id) {
    log.silly("SQL", "remove_client_data => %s", user_id);
    return this.db.runAsync(
      `
      DELETE FROM twitter_account
      WHERE twitter_account.user_id = $user_id;
      `
    , {
      $user_id: user_id
    }).catch(err =>{
      log.error("TwitDB", "Error deleting client data for user: %s", err);
      throw err;
    });
  }

  get_dm_room (users) {
    log.silly("SQL", "get_dm_room => %s", users);
    return this.db.getAsync(
      `
      SELECT room_id
      FROM dm_room
      WHERE dm_room.users = $users;
      `
    , {
      $users: users
    }).then(row =>{
      return row !== undefined ? row.room_id : null;
    }).catch(err => {
      log.error("TwitDB", "Error retrieving dm room: %s", err.Error);
      throw err;
    });
  }

  get_users_from_dm_room (room_id) {
    log.silly("SQL", "get_users_from_dm_room => %s", room_id);
    return this.db.getAsync(
      `
      SELECT users
      FROM dm_room
      WHERE dm_room.room_id = $room_id;
      `
    , {
      $room_id: room_id
    }).then( row => {
      return row !== undefined ? row.users : null;
    }).catch( err =>{
      log.error("TwitDB", "Error retrieving dm room: %s", err.Error);
      throw err;
    });
  }

  add_dm_room (room_id, users) {
    log.silly("SQL", "add_dm_room => %s", room_id);
    return this.db.runAsync(
      `
      INSERT INTO dm_room (room_id,users) VALUES ($room_id,$users);
      `
    , {
      $room_id: room_id,
      $users: users
    }).then(() => {
      log.info("TwitDB", "Stored dm room %s", room_id);
    }).catch(err =>{
      log.error("TwitDB", "Error storing dm room: %s", err);
      throw err;
    });
  }

  get_since (id) {
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
  }

  set_since (id, since) {
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



module.exports = TwitterDB;
