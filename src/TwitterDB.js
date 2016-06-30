var SQLite3 = require('sqlite3').verbose();
var log = require('npmlog');

var TwitterDB = function(filepath){
  this.db = new SQLite3.Database(filepath,(err) => {
    if(err){
      log.error("TwitDB","Error opening database, %s");
    }
  });
}

TwitterDB.prototype.init = function() {
  this._create_profile_cache();
  this._create_twitter_table();
}

TwitterDB.prototype.get_profile_by_id = function(id){
  log.info("TwitDB","Retrieving profile: %s",id);
  return new Promise((resolve,reject) =>{
    this.db.get(
      `
      SELECT profile, timestamp 
      FROM user_cache 
      WHERE user_cache.id = $id;
      `
    ,{
      $id: id
    }
    ,(err,row) =>{
      if(err != null){
        log.error("TwitDB","Error retrieving profile: %s",err.Error);
        reject(err);
      }
      if(row !== undefined){
        row.profile = JSON.parse(row.profile);
        resolve(row);
      }
      else {
        resolve(null);
      }
    });
  });
}

TwitterDB.prototype.get_profile_by_name = function(name){
  log.info("TwitDB","Retrieving profile: %s",name);
  return new Promise((resolve,reject) =>{
    this.db.get(
      `
      SELECT profile, timestamp 
      FROM user_cache 
      WHERE user_cache.screenname = $name;
      `
    ,{
      $id: id
    }
    ,(err,row) =>{
      if(err != null){
        log.error("TwitDB","Error retrieving profile: %s",err.Error);
        reject(err);
        return;
      }
      if(row !== undefined){
        row.profile = JSON.parse(row.profile);
        resolve(row);
      }
      else {
        resolve(null);
      }
    });
  });
}

TwitterDB.prototype.set_twitter_profile = function(id,name,data,timestamp){
  this.db.run(
    `     
    REPLACE INTO user_cache VALUES ($id,$name,$data,$timestamp);
    `
  ,{
    $id: id,
    $name: name,
    $data: JSON.stringify(data),
    $timestamp: timestamp
  },
  function (err) {
    if(err){
      log.error("TwitDB","Error storing profile: %s",err);
      return;
    }
    log.info("TwitDB","Stored profile for %s",name);
  });
}

//Caches every user profile we grab from Twitter so as to not go over our limits.
TwitterDB.prototype._create_profile_cache = function(){
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
      if(err){
        log.error("TwitDB","Error creating 'user_cache': %s",err);
        return;
      }
    }
  );
}

//Keeps track of links between matrix users and their accounts
TwitterDB.prototype._create_twitter_table = function(){
  this.db.run(
    `
    CREATE TABLE IF NOT EXISTS twitter_account (
      user_id	INTEGER UNIQUE NOT NULL,
      oauth_token TEXT,
      oauth_secret	TEXT,
      access_token TEXT,
      access_token_secret	TEXT,
      twitter_id	INTEGER,
      PRIMARY KEY(user_id)
    )
    `,
    function (err) {
      if(err){
        log.error("TwitDB","Error creating 'twitter_account': %s",err);
        return;
      }
    }
  );
}

TwitterDB.prototype.get_client_data = function(user_id){
  log.info("TwitDB","Retrieving client data: %s",user_id);
  return new Promise((resolve,reject) =>{
    this.db.get(
      `
      SELECT * 
      FROM twitter_account 
      WHERE twitter_account.user_id = $user_id;
      `
    ,{
      $user_id: user_id
    }
    ,(err,row) =>{
      if(err != null){
        log.error("TwitDB","Error retrieving client data: %s",err.Error);
        reject(err);
      }
      if(row !== undefined){
        resolve(row);
      }
      else {
        resolve(null);
      }
    });
  });
}

TwitterDB.prototype.set_client_data = function(user_id,twitter_id,data){
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
  ,{
    $user_id: user_id,
    $twitter_id: twitter_id,
    $oauth_token: data.oauth_token,
    $oauth_secret: data.oauth_secret,
    $access_token: data.access_token,
    $access_token_secret: data.access_token_secret
  },
  function (err) {
    if(err){
      log.error("TwitDB","Error storing client data: %s",err);
      return;
    }
    log.info("TwitDB","Stored client data for %s",user_id);
  });
}

TwitterDB.prototype.close = function() { 
  this.db.close();
}

module.exports = {
  TwitterDB: TwitterDB
}
