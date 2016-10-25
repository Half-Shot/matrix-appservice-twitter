module.exports = {
  run: function (twit_db) {
    twit_db.db.exec(`
      ALTER TABLE timeline_room ADD COLUMN with TEXT;
      ALTER TABLE timeline_room ADD COLUMN replies TEXT;
      UPDATE timeline_room SET with = "followings"
      UPDATE timeline_room SET replies = "mutual";
      `);
  }
}
