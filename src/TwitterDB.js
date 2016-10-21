const SQLite3 = require('sqlite3').verbose();
const log = require('npmlog');

const TWITTER_PROFILE_INTERVAL_MS   = 300000;

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
  }

  /**
   * Checks the database has all the tables needed.
   */
  init () {
    log.info("TwitDB", "Starting DB Init");
    this._create(`
      CREATE TABLE IF NOT EXISTS user_cache (
        id	INTEGER UNIQUE NOT NULL,
        screenname TEXT NOT NULL,
        profile	TEXT NOT NULL,
        timestamp	INTEGER NOT NULL,
        PRIMARY KEY(id)
      )
      `, "user_cache");
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
      `, "twitter_account");
    this._create(`
      CREATE TABLE IF NOT EXISTS timeline_room (
        user_id	TEXT UNIQUE NOT NULL,
        room_id	TEXT NOT NULL,
        PRIMARY KEY(user_id)
      )
      `, "timeline_room");
    this._create(`
      CREATE TABLE IF NOT EXISTS dm_room (
      	room_id	TEXT NOT NULL,
      	users	TEXT NOT NULL,
      	PRIMARY KEY(room_id)
      );
      `, "dm_room");
    this._create(`
      CREATE TABLE IF NOT EXISTS twitter_since (
      	id TEXT NOT NULL,
      	since	INTEGER,
      	PRIMARY KEY(id)
      );
      `, "twitter_since");
  }

  _create (statement, tablename) {
    this.db.run(statement, (err) => {
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
    log.info("TwitDB", "Retrieving profile: %s", id);
    return new Promise((resolve, reject) =>{
      this.db.get(
        `
        SELECT profile, timestamp
        FROM user_cache
        WHERE user_cache.id = $id;
        `
      , {
        $id: id
      }
      , (err, profile) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving profile: %s", err.Error);
          reject(err);
        }
        if(profile !== undefined) {
          var ts = new Date().getTime();
          if(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS) {
            return null;
          }
          resolve(JSON.parse(profile.profile));
        }
        else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Get a Twitter profile by the screenname of a user.
   * @param {string} name A twitter screen name.
   * @returns {Promise<object>} A Twitter profile
   */
  get_profile_by_name (name) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `
        SELECT profile, timestamp
        FROM user_cache
        WHERE user_cache.screenname = $name;
        `
      , {
        $name: name
      }
      , (err, profile) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving profile: %s", err.Error);
          reject(err);
          return;
        }
        if(profile !== undefined) {
          var ts = new Date().getTime();
          if(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS) {
            return null;
          }
          resolve(JSON.parse(profile.profile));
        }
        else {
          resolve(null);
        }
      });
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
    this.db.run(
      `
      REPLACE INTO user_cache (id,screenname,profile,timestamp) VALUES ($id,$name,$data,$timestamp);
      `
    , {
      $id: id,
      $name: name,
      $data: JSON.stringify(data),
      $timestamp: timestamp
    },
    function (err) {
      if(err) {
        log.error("TwitDB", "Error storing profile: %s", err);
        return;
      }
    });
  }

  get_twitter_account (user_id) {
    return new Promise((resolve, reject) =>{
      this.db.get(
        `
        SELECT *
        FROM twitter_account
        WHERE twitter_account.user_id = $id;
        `
      , {
        $id: user_id
      }
      , (err, row) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving client data: %s", err.Error);
          reject(err);
        }
        if(row !== undefined) {
          resolve(row);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  get_matrixid_from_twitterid (twitter_id) {
    return new Promise((resolve, reject) =>{
      this.db.get(
      `
      SELECT user_id
      FROM twitter_account
      WHERE twitter_id = $id
      `
      , {
        $id: twitter_id
      }, (err, row) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving linked userid: %s", err.Error);
          reject(err);
        }
        if(row !== undefined) {
          resolve(row.user_id);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  get_linked_user_ids () {
    return new Promise((resolve, reject) =>{
      this.db.all(
        `
        SELECT user_id
        FROM twitter_account
        `
      , (err, rows) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving linked ids: %s", err.Error);
          reject(err);
        }
        if(rows !== undefined) {
          rows.forEach(function (val, i, arr) {
            arr[i] = val.user_id;
          });
          resolve(rows);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  set_twitter_account (user_id, twitter_id, data) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        REPLACE INTO twitter_account (
          user_id,
          oauth_token,
          oauth_secret,
          access_token,
          access_token_secret,
          twitter_id
        ) VALUES (
          $user_id,
          $oauth_token,
          $oauth_secret,
          $access_token,
          $access_token_secret,
          $twitter_id
        );
        `
      , {
        $user_id: user_id,
        $twitter_id: twitter_id,
        $oauth_token: data.oauth_token,
        $oauth_secret: data.oauth_secret,
        $access_token: data.access_token,
        $access_token_secret: data.access_token_secret
      },
      (err) => {
        if(err) {
          log.error("TwitDB", "Error storing client data: %s", err);
          reject(err);
          return;
        }
        log.info("TwitDB", "Stored client data for %s", user_id);
        resolve();
      });
    });
  }

  get_timeline_room (user_id) {
    return new Promise((resolve, reject) =>{
      this.db.get(
        `
        SELECT room_id
        FROM timeline_room
        WHERE user_id = $user_id;
        `
      , {
        $user_id: user_id
      }, (err, row) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving timeline room: %s", err.Error);
          reject(err);
        }
        if(row !== undefined) {
          resolve(row.room_id);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  set_timeline_room (user_id, room_id) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        REPLACE INTO timeline_room (user_id,room_id)
        VALUES ($user_id,$room_id)
        `
      , {
        $user_id: user_id,
        $room_id: room_id
      }, (err) =>{
        if(err != null) {
          log.error("TwitDB", "Error storing timeline room for user: %s", err);
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  remove_timeline_room (user_id) {
    this.db.run(
      `
      DELETE FROM  timeline_room
      WHERE timeline_room.user_id = $user_id;
      `
    , {
      $user_id: user_id
    }, (err) =>{
      if(err != null) {
        log.error("TwitDB", "Error deleting timeline room for user: %s", err);
      }
    });
  }

  remove_client_data (user_id) {
    this.db.run(
      `
      DELETE FROM twitter_account
      WHERE twitter_account.user_id = $user_id;
      `
    , {
      $user_id: user_id
    }, (err) =>{
      if(err != null) {
        log.error("TwitDB", "Error deleting client data for user: %s", err);
      }
    });
  }

  get_dm_room (users) {
    return new Promise((resolve, reject) =>{
      this.db.get(
        `
        SELECT room_id
        FROM dm_room
        WHERE dm_room.users = $users;
        `
      , {
        $users: users
      }
      , (err, row) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving dm room: %s", err.Error);
          reject(err);
        }
        if(row !== undefined) {
          resolve(row.room_id);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  get_users_from_dm_room (room_id) {
    return new Promise((resolve, reject) =>{
      this.db.get(
        `
        SELECT users
        FROM dm_room
        WHERE dm_room.room_id = $room_id;
        `
      , {
        $room_id: room_id
      }
      , (err, row) =>{
        if(err != null) {
          log.error("TwitDB", "Error retrieving dm room: %s", err.Error);
          reject(err);
        }
        if(row !== undefined) {
          resolve(row.users);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  add_dm_room (room_id, users) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        INSERT INTO dm_room (room_id,users) VALUES ($room_id,$users);
        `
      , {
        $room_id: room_id,
        $users: users
      },
      (err) => {
        if(err) {
          log.error("TwitDB", "Error storing dm room: %s", err);
          reject(err);
          return;
        }
        log.info("TwitDB", "Stored dm room %s", room_id);
        resolve();
      });
    });
  }

  get_since (id) {
    return new Promise((resolve, reject) =>{
      this.db.get(
        `
        SELECT since
        FROM twitter_since
        WHERE twitter_since.id = $id;
        `
      , {
        $id: id
      }
      , (err, row) =>{
        if(err != null) {
          log.error("TwitDB", "Error getting since value: %s", err.Error);
          reject(err);
        }
        if(row !== undefined) {
          resolve(row.since);
        }
        else {
          resolve(null);
        }
      });
    });
  }

  set_since (id, since) {
    this.db.run(
      `
      REPLACE INTO twitter_since (id,since) VALUES ($id,$since);
      `
    , {
      $id: id,
      $since: since
    },
    function (err) {
      if(err) {
        log.error("TwitDB", "Error storing twitter since value: %s", err);
        return;
      }
    });
  }
}



module.exports = TwitterDB;
