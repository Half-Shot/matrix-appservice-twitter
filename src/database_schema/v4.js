module.exports = {
  run: function (twit_db) {
    twit_db.db.exec(`
      ALTER TABLE event_tweet ADD COLUMN sender TEXT NOT NULL DEFAULT "";
      `);
  }
}
