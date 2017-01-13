const assert = require('chai').assert;
const TwitterDB = require('../src/TwitterDB.js');

describe('TwitterDB', function () {
  describe('constructor()', () => {
    it("doesn't throw", () => {
      new TwitterDB(":memory:");
    });
  });

  describe('init()', () => {
    it('should update the schema successfully', () =>{
      var db = new TwitterDB(":memory:");
      return db.init().then(() => {
        assert.equal(db.version, db._target_schema, 'Schema version is the correct version.')
      });
    });
    it('should close properly', () => {
      var db = new TwitterDB(":memory:");
      return db.init().then(() => {
        db.close();
      });
    });
  });

  describe('_get_schema_version()', () => {
    var db = new TwitterDB(":memory:");
    it('should match the database version', () => {
      return db.init().then(() => {
        return db._get_schema_version();
      }).then(version => {
        assert.equal(version, db.version, 'Database and object version match.');
      });
    });
  });

  describe('_set_schema_version()', () => {
    var db = new TwitterDB(":memory:");
    it('should update successfully', () => {
      return db.init().then(() => {
        return db._set_schema_version(db.version, 9999);
      }).then(() => {
        return db._get_schema_version();
      }).then(version => {
        assert.equal(version, 9999, 'Schema version updates successfully.');
      });
    });
  });
});
