module.exports = {
  run: function (twit_db) {
    twit_db.db.exec(`
      ALTER TABLE timeline_room  ADD COLUMN retweets TEXT NOT NULL DEFAULT "root";
      `);
  }
}
