const log = require('../logging.js');

module.exports = {
  add_event: function (event_id, sender, room_id, tweet_id, ts) {
    log.silly("SQL", "add_event => %s", event_id);
    return this.db.runAsync(
      `
      INSERT INTO event_tweet
      (event_id, sender, room_id,tweet_id,timestamp)
      VALUES ($event_id, $sender, $room_id, $tweet_id, $timestamp)
      `
    , {
      $event_id: event_id,
      $sender: sender,
      $room_id: room_id,
      $tweet_id: tweet_id,
      $timestamp: ts
    }).catch( err => {
      log.error("TwitDB", "Error inserting event: %s", err.Error);
      throw err;
    });
  },

  get_event_by_event_id: function (event_id) {
    log.silly("SQL", "get_event_by_event_id => %s", event_id);
    return this.db.getAsync(
      `
      SELECT *
      FROM event_tweet
      WHERE event_tweet.event_id = $event_id;
      `
    , {
      $event_id: event_id
    }).then(row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error getting event: %s", err.Error);
      throw err;
    });
  },

  get_event_by_tweet_id: function (tweet_id) {
    log.silly("SQL", "get_event_by_tweet_id => %s", tweet_id);
    return this.db.getAsync(
      `
      SELECT *
      FROM event_tweet
      WHERE event_tweet.tweet_id = $tweet_id;
      `
    , {
      $tweet_id: tweet_id
    }).then(row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error getting event: %s", err.Error);
      throw err;
    });
  },

  room_has_tweet: function (room_id, tweet_id) {
    log.silly("SQL", "room_has_tweet => %s, %s", room_id, tweet_id);
    return this.db.getAsync(
      `
      SELECT *
      FROM event_tweet
      WHERE event_tweet.tweet_id = $tweet_id
      AND event_tweet.room_id = $room_id;
      `
    , {
      $tweet_id: tweet_id,
      $room_id: room_id
    }).then(row => {
      return row !== undefined;
    }).catch( err => {
      log.error("TwitDB", "Error checking room_has_tweet: %s", err.Error);
      throw err;
    });
  }
}
