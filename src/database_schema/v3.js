module.exports = {
  run: function (twit_db) {
    twit_db._create(`
      CREATE TABLE event_tweet (
        event_id TEXT UNIQUE NOT NULL,
        room_id TEXT NOT NULL,
        tweet_id TEXT NOT NULL,
        timestamp	INTEGER NOT NULL,
        PRIMARY KEY(event_id)
      )
      `, "user_cache");
  }
}
