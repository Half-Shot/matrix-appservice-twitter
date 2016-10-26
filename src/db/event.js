const log = require('npmlog');

module.exports = {
  add_event: function (event_id, room_id, tweet_id, ts) {
    log.silly("SQL", "add_event => %s", event_id);
    return this.db.runAsync(
      `
      INSERT INTO event_tweet
      (event_id,room_id,tweet_id,timestamp)
      VALUES ($event_id, $room_id, $tweet_id, $timestamp)

      `
    , {
      $event_id: event_id,
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
      WHERE twitter_since.event_id = $event_id;
      `
    , {
      $event_id: event_id
    }).then(row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error getting since value: %s", err.Error);
      throw err;
    });
  },

  get_event_by_tweet_id: function (tweet_id) {
    log.silly("SQL", "get_event_by_tweet_id => %s", tweet_id);
    return this.db.getAsync(
      `
      SELECT *
      FROM event_tweet
      WHERE twitter_since.tweet_id = $tweet_id;
      `
    , {
      $tweet_id: tweet_id
    }).then(row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error getting since value: %s", err.Error);
      throw err;
    });
  }
}
