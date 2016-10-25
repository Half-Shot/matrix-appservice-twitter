const assert = require('assert');
const util = require('../src/util.js');

describe('Util', function () {
  describe('isStrInteger()', function () {
    it('should return false when the value is abcde', function () {
      assert.equal(false, util.isStrInteger('abcde'));
    });

    it('should return false when the value is a2bc1d4e', function () {
      assert.equal(false, util.isStrInteger('a2bc1d4e'));
    });

    it('should return true when the value is a integer', function () {
      assert.equal(true, util.isStrInteger('12345'));
    });
  });
});
