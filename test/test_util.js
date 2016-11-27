const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const nock = require('nock');
const util = require('../src/util.js');


describe('Util', function () {

  describe('downloadFile', function () {

    it('should fulfill and give the correct response', function () {
      nock('http://twitterasfakeurl').get('/test').reply(
        200,
        'Lorem Ipsum is simply dummy text of the printing and typesetting industry'
      );
      return assert.becomes(
         util.downloadFile("http://twitterasfakeurl/test"),
         Buffer.from('Lorem Ipsum is simply dummy text of the printing and typesetting industry')
      );
    });

    it('should fulfill with https', function () {
      nock('https://twitterasfakeurl').get('/test').reply(
        200,
        'Lorem Ipsum is simply dummy text of the printing and typesetting industry'
      );
      return assert.isFulfilled(util.downloadFile("https://twitterasfakeurl/test"));
    });

    it('should reject on bad URL', function () {
      return assert.isRejected(util.downloadFile("https://fakeurl/test"));
    });

    it('should reject on non 200 status code', function () {
      nock('https://twitterasfakeurl').get('/test').reply(
        404
      );
      return assert.isRejected(util.downloadFile("https://twitterasfakeurl/test"));
    });

    it('should reject on an error', function () {
      nock('https://twitterasfakeurl').get('/test').replyWithError(
        'simulated error'
      );
      return assert.isRejected(util.downloadFile("https://twitterasfakeurl/test"));
    });

  });

  describe('uploadContentFromUrl', function () {
    var test_name = "";
    const intent = {
      getClient: function () {
        return { uploadContent: function (req) {

          if(typeof req.stream !== "object") {
            assert.isObject(req.stream, "stream was not a object");
          }

          if(typeof req.name !== "string") {
            assert.isString(req.name, "name was not a string");
            assert.isEqual(req.name, test_name);
          }

          if(typeof req.type !== "string") {
            assert.isString(req.type, "type was not a string");
          }

          return Promise.resolve(JSON.stringify({
            content_uri: "mxc://someserver.com/foobar"
          }));
        }}
      }
    }

    const bridge = {
      getIntent: function () {
        return intent;
      }
    }

    it('should fulfill and give the correct response (name not specified)', function () {
      nock('http://twitterasfakeurl').get('/test').reply(
        200,
        'Lorem Ipsum is simply dummy text of the printing and typesetting industry'
      );
      const promise = util.uploadContentFromUrl(bridge, "http://twitterasfakeurl/test", null, null);
      test_name = "test";
      return Promise.all([
        assert.isFulfilled(promise),
        assert.eventually.isObject(promise),
        assert.eventually.property(promise, 'mxc_url'),
        assert.eventually.property(promise, 'size')
      ]);
    });

    it('should fulfill and give the correct response (name specified)', function () {
      nock('http://twitterasfakeurl').get('/test').reply(
        200,
        'Lorem Ipsum is simply dummy text of the printing and typesetting industry'
      );
      const promise = util.uploadContentFromUrl(bridge, "http://twitterasfakeurl/test", null, "foobar");
      test_name = "foobar";
      return Promise.all([
        assert.isFulfilled(promise),
        assert.eventually.isObject(promise),
        assert.eventually.property(promise, 'mxc_url'),
        assert.eventually.property(promise, 'size')
      ]);
    });

    it('should fulfill with https', function () {
      nock('https://twitterasfakeurl').get('/test').reply(
        200,
        'Lorem Ipsum is simply dummy text of the printing and typesetting industry'
      );
      return assert.isFulfilled(util.uploadContentFromUrl(bridge, "https://twitterasfakeurl/test", null, null));
    });

    it('should reject on bad URL', function () {
      return assert.isRejected(util.uploadContentFromUrl(bridge, "https://fakeurl/test", null, null));
    });

    it('should reject on non 200 status code', function () {
      nock('https://twitterasfakeurl').get('/test').reply(
        404
      );
      return assert.isRejected(util.uploadContentFromUrl(bridge, "http://twitterasfakeurl/test", null, null));
    });

    it('should reject on an error', function () {
      nock('https://twitterasfakeurl').get('/test').replyWithError(
        'simulated error'
      );
      return assert.isRejected(util.uploadContentFromUrl(bridge, "http://twitterasfakeurl/test", null, null));
    });

  });
  describe('isStrInteger', function () {
    it('should return false when the string is in the wrong format', function () {
      assert.isFalse( util.isStrInteger(""));
      assert.isFalse( util.isStrInteger('abcde'));
      assert.isFalse( util.isStrInteger('a2bc1d4e'));
    });

    it('should return true when the value is a integer', function () {
      assert.isTrue( util.isStrInteger('12345'));
    });
  });

  describe('isRoomId()', function () {
    it('should return false when the string is in the wrong format', function () {
      assert.isFalse( util.isRoomId(""));
      assert.isFalse( util.isRoomId("!:"));
      assert.isFalse( util.isRoomId("!sddsaas"));
      assert.isFalse( util.isRoomId(":saddsd"));
      assert.isFalse( util.isRoomId("!asd94 dd:12 74dd"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.isTrue( util.isRoomId("!foo:bar"));
      assert.isTrue( util.isRoomId("!foo:bar.com"));
    });
  });

  describe('isUserId', function () {
    it('should return false when the string is in the wrong format', function () {
      assert.isFalse( util.isUserId(""));
      assert.isFalse( util.isUserId("@:"));
      assert.isFalse( util.isUserId("@sddsaas"));
      assert.isFalse( util.isUserId(":saddsd"));
      assert.isFalse( util.isUserId("@asd94 dd:12 74dd"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.isTrue( util.isUserId("@foo:bar"));
      assert.isTrue( util.isUserId("@foo:bar.com"));
      assert.isTrue( util.isUserId("@foo-bar:bar.com"));
      assert.isTrue( util.isUserId("@foo$bar:bar.com"));
    });
  });

  describe('isAlphanumeric()', function () {
    it('should return false when the string is empty', function () {
      assert.isFalse( util.isAlphanumeric(""));
    });

    it('should return false when the string is the wrong format', function () {
      assert.isFalse( util.isAlphanumeric("ds sz ed "));
      assert.isFalse( util.isAlphanumeric("#dff2!313c."));
    });

    it('should return true when the value is in the correct format', function () {
      assert.isTrue( util.isAlphanumeric("123"));
      assert.isTrue( util.isAlphanumeric("abc"));
      assert.isTrue( util.isAlphanumeric("123abc"));
    });
  });

  describe('isTwitterScreenName', function () {
    it('should return false when the string is empty', function () {
      assert.isFalse( util.isTwitterScreenName(""));
    });

    it('should return false when the string is the wrong format', function () {
      assert.isFalse( util.isTwitterScreenName("foo bar"));
      assert.isFalse( util.isTwitterScreenName("#foobar"));
    });

    it('should return false when the string is over 15 characters', function () {
      assert.isFalse( util.isTwitterScreenName("1234567890123456"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.isTrue( util.isTwitterScreenName("foobar"));
      assert.isTrue( util.isTwitterScreenName("foo_bar"));
      assert.isTrue( util.isTwitterScreenName("123456789012345"));
    });
  });

  describe('isTwitterHashtag', function () {
    it('should return false when the string is empty', function () {
      assert.isFalse( util.isTwitterHashtag(""));
    });

    it('should return false when the string is the wrong format', function () {
      assert.isFalse( util.isTwitterHashtag("foo bar"));
      assert.isFalse( util.isTwitterHashtag("#foobar"));
    });

    it('should return true when the value is in the correct format', function () {
      assert.isTrue(util.isTwitterHashtag("foobar"));
      assert.isTrue(util.isTwitterHashtag("foo_bar"));
      assert.isTrue(util.isTwitterHashtag("123456789012345123456789012345"));
    });
  });

  describe('roomPowers', function () {
    var users = {"alpha": 5, "beta": 10};
    var powers = util.roomPowers(users);
    assert.isObject(powers);
    assert.property(powers, 'content');
    assert.deepEqual(powers.content.users, users);
  });
});
