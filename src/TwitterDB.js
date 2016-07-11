var SQLite3 = require('sqlite3').verbose();
var log = require('npmlog');


/**
 * TwitterDB - Stores data for specific users and data not specific to rooms.
 * @class
 * @param  {string} filepath Location of the SQLite database file.
 */
var TwitterDB = function (filepath) {
  this.db = new SQLite3.Database(filepath, (err) => {
    if(err) {
      log.error("TwitDB", "Error opening database, %s");
    }
  });
}


/**
 * TwitterDB.prototype.init - Checks the database has all the tables needed.
 * @function
 */
TwitterDB.prototype.init = function () {
  log.info("TwitDB", "Starting DB Init");
  this._create_profile_cache();
  this._create_twitter_table();
  this._create_dm_room_table();
  this._create_timeline_table();
}

TwitterDB.prototype.get_profile_by_id = function (id) {
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
    , (err, row) =>{
      if(err != null) {
        log.error("TwitDB", "Error retrieving profile: %s", err.Error);
        reject(err);
      }
      if(row !== undefined) {
        row.profile = JSON.parse(row.profile);
        resolve(row);
      }
      else {
        resolve(null);
      }
    });
  });
}

/**
 @typedef TwitterDBProfile
 @type {Object}
 @property {object} profile   A complete record of a twitter users profile.
 @property {number} timestamp The last time the record was updated.
 */

/**
 * TwitterDB.prototype.get_profile_by_name - Get a Twitter profile by the
 * screenname of a user.
 * @function
 * @returns {Promise<TwitterDBProfile>}
 */
TwitterDB.prototype.get_profile_by_name = function (name) {
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
    , (err, row) =>{
      if(err != null) {
        log.error("TwitDB", "Error retrieving profile: %s", err.Error);
        reject(err);
        return;
      }
      if(row !== undefined) {
        row.profile = JSON.parse(row.profile);
        resolve(row);
      }
      else {
        resolve(null);
      }
    });
  });
}

/**
 * TwitterDB.prototype.set_twitter_profile - Insert/Update a Twitter profile
 * into the database.
 * @function
 * @param  {type} id          Twitter ID of the profile.
 * @param  {string} name      screenname of the profile.
 * @param  {object} data      The profile data.
 * @param  {number} timestamp The time when this data was *fetched*.
 */
TwitterDB.prototype.set_twitter_profile = function (id, name, data, timestamp) {
  this.db.run(
    `
    REPLACE INTO user_cache VALUES ($id,$name,$data,$timestamp);
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

TwitterDB.prototype.get_client_data = function (user_id) {
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

TwitterDB.prototype.get_matrixid_from_twitterid = function (twitter_id) {
return new Promise((resolve, reject) =>{
  this.db.get(
    `
    SELECT user_id
    FROM twitter_account
    WHERE twitter_id = $id
    `
    , {
      $id:twitter_id
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

TwitterDB.prototype.get_linked_user_ids = function () {
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

TwitterDB.prototype.set_client_data = function (user_id, twitter_id, data) {
  this.db.run(
    `
    REPLACE INTO twitter_account VALUES (
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
  function (err) {
    if(err) {
      log.error("TwitDB", "Error storing client data: %s", err);
      return;
    }
    log.info("TwitDB", "Stored client data for %s", user_id);
  });
}

TwitterDB.prototype.get_timeline_room = function (user_id) {
  return new Promise((resolve, reject) =>{
    this.db.get(
      `
      SELECT room_id
      FROM timeline_room
      WHERE user_id = $user_id;
      `
    , {
      $user_id:user_id
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

TwitterDB.prototype.set_timeline_room = function (user_id, room_id) {
  this.db.run(
    `
    REPLACE INTO timeline_room
    VALUES ($user_id,$room_id)
    `
  , {
    $user_id:user_id,
    $room_id:room_id
  }, (err) =>{
    if(err != null) {
      log.error("TwitDB", "Error storing timeline room for user: %s", err);
    }
  });
}

TwitterDB.prototype.remove_timeline_room = function (user_id) {
  this.db.run(
    `
    DELETE FROM  timeline_room
    WHERE timeline_room.user_id = $user_id;
    `
  , {
    $user_id:user_id
  }, (err) =>{
    if(err != null) {
      log.error("TwitDB", "Error deleting timeline room for user: %s", err);
    }
  });
}

TwitterDB.prototype.remove_client_data = function (user_id) {
  this.db.run(
    `
    DELETE FROM twitter_account
    WHERE twitter_account.user_id = $user_id;
    `
  , {
    $user_id:user_id
  }, (err) =>{
    if(err != null) {
      log.error("TwitDB", "Error deleting client data for user: %s", err);
    }
  });
}

TwitterDB.prototype.get_dm_room = function (users) {
  log.info("TwitDB", "Retrieving dm room: %s", users);
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

TwitterDB.prototype.get_users_from_dm_room = function (room_id) {
  log.info("TwitDB", "Retrieving dm room: %s", room_id);
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

TwitterDB.prototype.add_dm_room = function (room_id, users) {
  log.info("TwitDB", "Storing dm room %s", room_id);
  this.db.run(
    `
    INSERT INTO dm_room VALUES ($room_id,$users);
    `
  , {
    $room_id: room_id,
    $users: users
  },
  function (err) {
    if(err) {
      log.error("TwitDB", "Error storing dm room: %s", err);
      return;
    }
    log.info("TwitDB", "Stored dm room %s", room_id);
  });
}

//Caches every user profile we grab from Twitter so as to not go over our limits.
TwitterDB.prototype._create_profile_cache = function () {
  this.db.run(
    `
    CREATE TABLE IF NOT EXISTS user_cache (
    	id	INTEGER UNIQUE NOT NULL,
      screenname TEXT NOT NULL,
    	profile	TEXT NOT NULL,
    	timestamp	INTEGER NOT NULL,
    	PRIMARY KEY(id)
    )
    `,
    function (err) {
      if(err) {
        throw "Error creating 'user_cache': "+err;
      }
    }
  );
}

//Keeps track of links between matrix users and their accounts
TwitterDB.prototype._create_twitter_table = function () {
  this.db.run(
    `
    CREATE TABLE IF NOT EXISTS twitter_account (
      user_id	TEXT UNIQUE NOT NULL,
      oauth_token TEXT,
      oauth_secret	TEXT,
      access_token TEXT,
      access_token_secret	TEXT,
      twitter_id	INTEGER,
      PRIMARY KEY(user_id)
    )
    `,
    function (err) {
      if(err) {
        throw "Error creating 'twitter_account': "+err;
      }
    }
  );
}

//Keeps track of links between matrix users and their accounts
TwitterDB.prototype._create_timeline_table = function () {
  this.db.run(
    `
    CREATE TABLE IF NOT EXISTS timeline_room (
      user_id	TEXT UNIQUE NOT NULL,
      room_id	TEXT NOT NULL,
      PRIMARY KEY(user_id)
    )
    `,
    function (err) {
      if(err) {
        throw "Error creating 'twitter_account': "+err;
      }
    }
  );
}

TwitterDB.prototype._create_dm_room_table = function () {
  this.db.run(
    `
    CREATE TABLE IF NOT EXISTS dm_room (
    	room_id	TEXT NOT NULL,
    	users	TEXT NOT NULL,
    	PRIMARY KEY(room_id)
    );
    `,
    function (err) {
      if(err) {
        throw "Error creating 'dm_room': "+err;
      }
    }
  );
}


TwitterDB.prototype.close = function () {
  this.db.close();
}

module.exports = {
  TwitterDB: TwitterDB
}
