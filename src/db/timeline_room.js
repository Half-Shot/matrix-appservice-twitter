const log = require('../logging.js');

module.exports = {
  get_timeline_room: function (user_id) {
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
  },

  set_timeline_with_option: function (room_id, _with) {
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
  },

  set_timeline_replies_option: function (room_id, replies) {
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
  },

  set_timeline_room: function (user_id, room_id, _with, replies) {
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
  },

  remove_timeline_room: function (user_id) {
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
}
