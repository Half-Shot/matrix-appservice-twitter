const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const TwitterDB = require('../../src/TwitterDB.js');
const log = require('npmlog');
global.Promise = require('bluebird');


describe('TwitterDB.dm', function () {
  var db;
  beforeEach(() => {
    db = new TwitterDB(":memory:");
    return db.init();
  });

  describe('add_event()', () => {
    it("should be able to add an event", () => {
      assert.isFulfilled(
        db.add_dm_room(
          "$abc:example.com",
          "@test:example.com",
          "!abc:example.com",
          12345,
          12345
        )
      );
    });
  });

  // describe('get_best_guess_reply_target()', () => {
  //
  //
  // });

  describe('get_event_by_event_id()', () => {
    it("should be able to get an event", () => {
      return db.add_dm_room("foo", "bar").then(() =>{
        return assert.becomes(db.get_users_from_dm_room("foo"), "bar");
      });
    });
  });

  describe('get_event_by_tweet_id()', () => {
    it("should return a string if an entry exists", () => {
      return db.add_dm_room("foo", "bar").then(() =>{
        return assert.becomes(db.get_users_from_dm_room("foo"), "bar");
      });
    });
  });

});
