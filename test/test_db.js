const assert = require('chai').assert;
const TwitterDB = require('../src/TwitterDB.js');
const log = require('npmlog');
log.level = "silent";


describe('TwitterDB', function () {
  describe('constructor()', () => {
    it("doesn't throw", () => {
      new TwitterDB(":memory:");
    });
  });

  describe('init()', () => {
    var db = new TwitterDB(":memory:");
    var promise = db.init();
    it('should return a Promise.', () => {
      assert.isNotNull(promise, 'init() is not null');
    });

    it('should update the schema successfully', () =>{
      return promise.then(() => {
        assert.equal(db.version, db._target_schema, 'Schema version is the correct version.')
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
