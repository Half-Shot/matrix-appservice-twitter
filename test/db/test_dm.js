const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const TwitterDB = require('../../src/TwitterDB.js');

describe('TwitterDB.dm', function () {
  var db;
  beforeEach(() => {
    db = new TwitterDB(":memory:");
    return db.init();
  });

  describe('add_dm_room()', () => {
    it("should reject when supplying bad arguments", () => {
      assert.isRejected(db.add_dm_room(null, null));
      assert.isRejected(db.add_dm_room("", null));
      assert.isRejected(db.add_dm_room(null, ""));
    });

    it("should accept correct arguements", () => {
      assert.isFulfilled(db.add_dm_room("abc", "def"), 'Accept string,string');
    });

  });

  describe('get_dm_room()', () => {

    it("should return null if no entry exists", () => {
      var promise = db.get_dm_room("potato");
      return assert.isFulfilled(promise) && assert.becomes(promise, null);
    });

    it("should return a string if an entry exists", () => {
      return db.add_dm_room("foo", "bar").then(() =>{
        return assert.becomes(db.get_dm_room("bar"), "foo");
      });
    });


  });

  describe('get_users_from_dm_room()', () => {

    it("should return null if no entry exists", () => {
      var promise = db.get_users_from_dm_room("potato");
      return assert.isFulfilled(promise) && assert.becomes(promise, null);
    });

    it("should return a string if an entry exists", () => {
      return db.add_dm_room("foo", "bar").then(() =>{
        return assert.becomes(db.get_users_from_dm_room("foo"), "bar");
      });
    });
  });

});
