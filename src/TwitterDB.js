const SQLite3 = require('sqlite3').verbose();
const log = require('npmlog');

const TWITTER_PROFILE_INTERVAL_MS   = 300000;
const RATELIMIT_PROFILE_CACHE   = 10000;
const CURRENT_SCHEMA = 2;
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
      while(version < CURRENT_SCHEMA) {
        version++;
        var schema = require(`./database_schema/v${version}.js`);
        schema.run(this);
        log.info("TwitDB", "Updated database v%s", version);
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
      return row == undefined ? 0 : row.version;
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
        var pro = JSON.parse(profile.profile);
        pro._outofdate =(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS);
        return pro;
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
        var pro = JSON.parse(profile.profile);
        pro._outofdate =(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS);
        return pro;
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

    return this.db.runAsync(
      `
      REPLACE INTO user_cache (id,screenname,profile,timestamp) VALUES ($id,$name,$data,$timestamp);
      `
    , {
      $id: id,
      $name: name,
      $data: JSON.stringify(data),
      $timestamp: timestamp
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
        SELECT *
        FROM timeline_room
        WHERE user_id = $user_id;
        `
      , {
        $user_id: user_id
      }).then(row => {
        return row !== undefined ? row : null;
      }).catch(err => {
        log.error("TwitDB", "Error retrieving timeline room: %s", err.Error);
        throw err;
      });
  }

  set_timeline_with_option (room_id, _with) {
    log.silly("SQL", "set_timeline_with_option => %s", room_id);
    return this.db.runAsync(
      `
        UPDATE timeline_room
        SET with = $with
        WHERE room_id = $room_id;
      `, {
        $room_id: room_id,
        $with: _with
      }).catch(err => {
        log.error("TwitDB", "Error setting 'with' filter: %s", err.Error);
        throw err;
      });
  }

  set_timeline_replies_option (room_id, replies) {
    log.silly("SQL", "set_timeline_replies_option => %s", room_id);
    return this.db.runAsync(
      `
        UPDATE timeline_room
        SET replies = $replies
        WHERE room_id = $room_id;
      `, {
        $room_id: room_id,
        $replies: replies
      }).catch(err => {
        log.error("TwitDB", "Error setting 'replies' filter: %s", err.Error);
        throw err;
      });
  }

  set_timeline_room (user_id, room_id, _with, replies) {
    log.silly("SQL", "set_timeline_room => %s", room_id);
    return this.db.runAsync(
      `
      REPLACE INTO timeline_room (user_id,room_id,with,replies)
      VALUES ($user_id,$room_id,$with,$replies)
      `
    , {
      $user_id: user_id,
      $room_id: room_id,
      $with: _with,
      $replies: replies
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
