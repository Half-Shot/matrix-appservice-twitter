module.exports = {
  run: function (twit_db) {
    twit_db.db.exec(`
    CREATE TABLE schema (
      version	INTEGER UNIQUE NOT NULL
    );
    INSERT INTO schema VALUES (0);
    `);

    twit_db._create(`
      CREATE TABLE user_cache (
        id	TEXT UNIQUE NOT NULL,
        screenname TEXT NOT NULL,
        profile	TEXT NOT NULL,
        timestamp	INTEGER NOT NULL,
        PRIMARY KEY(id)
      )
      `, "user_cache");
    twit_db._create(`
      CREATE TABLE twitter_account (
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
    twit_db._create(`
      CREATE TABLE timeline_room (
        user_id	TEXT UNIQUE NOT NULL,
        room_id	TEXT NOT NULL,
        PRIMARY KEY(user_id)
      )
      `, "timeline_room");
    twit_db._create(`
      CREATE TABLE dm_room (
      	room_id	TEXT NOT NULL,
      	users	TEXT NOT NULL,
      	PRIMARY KEY(room_id)
      );
      `, "dm_room");
    twit_db._create(`
      CREATE TABLE twitter_since (
      	id TEXT NOT NULL,
      	since	INTEGER,
      	PRIMARY KEY(id)
      );
      `, "twitter_since");
  }
}
