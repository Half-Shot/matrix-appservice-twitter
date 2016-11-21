const assert = require('assert');
const util = require('../src/util.js');

describe('Util', function () {
  describe('isStrInteger()', function () {
    it('should return false when the string is in the wrong format', function () {
      assert.equal(false, util.isStrInteger(""));
      assert.equal(false, util.isStrInteger('abcde'));
      assert.equal(false, util.isStrInteger('a2bc1d4e'));
    });

    it('should return true when the value is a integer', function () {
      assert.equal(true, util.isStrInteger('12345'));
    });
  });

  describe('isRoomId', function () {
    it('should return false when the string is in the wrong format', function () {
      assert.equal(false, util.isRoomId(""));
      assert.equal(false, util.isRoomId("!:"));
      assert.equal(false, util.isRoomId("!sddsaas"));
      assert.equal(false, util.isRoomId(":saddsd"));
      assert.equal(false, util.isRoomId("!asd94 dd:12 74dd"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.equal(true, util.isRoomId("!foo:bar"));
      assert.equal(true, util.isRoomId("!foo:bar.com"));
    });
  });

  describe('isUserId', function () {
    it('should return false when the string is in the wrong format', function () {
      assert.equal(false, util.isUserId(""));
      assert.equal(false, util.isUserId("@:"));
      assert.equal(false, util.isUserId("@sddsaas"));
      assert.equal(false, util.isUserId(":saddsd"));
      assert.equal(false, util.isUserId("@asd94 dd:12 74dd"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.equal(true, util.isUserId("@foo:bar"));
      assert.equal(true, util.isUserId("@foo:bar.com"));
      assert.equal(true, util.isUserId("@foo-bar:bar.com"));
      assert.equal(true, util.isUserId("@foo$bar:bar.com"));
    });
  });

  describe('isAlphanumeric', function () {
    it('should return false when the string is empty', function () {
      assert.equal(false, util.isAlphanumeric(""));
    });

    it('should return false when the string is the wrong format', function () {
      assert.equal(false, util.isAlphanumeric("ds sz ed "));
      assert.equal(false, util.isAlphanumeric("#dff2!313c."));
    });

    it('should return true when the value is in the correct format', function () {
      assert.equal(true, util.isAlphanumeric("123"));
      assert.equal(true, util.isAlphanumeric("abc"));
      assert.equal(true, util.isAlphanumeric("123abc"));
    });
  });

  describe('isTwitterScreenName', function () {
    it('should return false when the string is empty', function () {
      assert.equal(false, util.isTwitterScreenName(""));
    });

    it('should return false when the string is the wrong format', function () {
      assert.equal(false, util.isTwitterScreenName("foo bar"));
      assert.equal(false, util.isTwitterScreenName("#foobar"));
    });

    it('should return false when the string is over 15 characters', function () {
      assert.equal(false, util.isTwitterScreenName("1234567890123456"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.equal(true, util.isTwitterScreenName("foobar"));
      assert.equal(true, util.isTwitterScreenName("foo_bar"));
      assert.equal(true, util.isTwitterScreenName("123456789012345"));
    });
  });

  describe('isTwitterHashtag', function () {
    it('should return false when the string is empty', function () {
      assert.equal(false, util.isTwitterHashtag(""));
    });

    it('should return false when the string is the wrong format', function () {
      assert.equal(false, util.isTwitterHashtag("foo bar"));
      assert.equal(false, util.isTwitterHashtag("#foobar"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.equal(true, util.isTwitterHashtag("foobar"));
      assert.equal(true, util.isTwitterHashtag("foo_bar"));
      assert.equal(true, util.isTwitterHashtag("123456789012345123456789012345"));
    });
  });

});
