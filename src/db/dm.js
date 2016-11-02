const log = require('npmlog');

module.exports = {
  get_dm_room: function (users) {
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
  },

  get_users_from_dm_room: function (room_id) {
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
  },

  add_dm_room: function (room_id, users) {
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
  },

  remove_dm_room: function (users) {
    log.silly("SQL", "remove_dm_room => %s", users);
    return this.db.runAsync(
      `
      DELETE FROM dm_room
      WHERE dm_room.users = $users;
      `
    , {
      $users: users
    }).then(() => {
      log.info("TwitDB", "Deleted dm room %s", users);
    }).catch(err =>{
      log.error("TwitDB", "Error deleting dm room: %s", err);
      throw err;
    });
  }
}
