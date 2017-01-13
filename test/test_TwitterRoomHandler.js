const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const TwitterRoomHandler = require('../src/TwitterRoomHandler.js');

// Initialise logging
require('../src/logging.js').init({level: 'silent'});

var bridge_room_entries;

const bridge = {
  opts: {
    registration: {
      sender_localpart: "foo"
    },
    domain: "bar.com"
  },
  getRoomStore: function () {
    return {
      getEntriesByMatrixId: function () {
        return Promise.resolve(bridge_room_entries);
      }
    }
  }
}

var _was_invited, _left, _message, _alias, _room_created;
var _handler_called;
const handlers = {};

for (let type of ["services", "timeline", "directmessage", "hashtag"]) {
  handlers[type] = {
    processInvite: function () {
      _was_invited = true;
      _handler_called = type;
    },
    processLeave: function () {
      _left = true;
      _handler_called = type;
    },
    processMessage: function () {
      _message = true;
      _handler_called = type;
    },
    processAliasQuery: function () {
      _alias = true;
      _handler_called = type;
    },
    onRoomCreated: function () {
      _room_created = true;
      _handler_called = type;
    }
  }
}

const config = {
  hashtags: {
    enable: true
  },
  timelines: {
    enable: true
  }
}

describe('TwitterRoomHandler', function () {
  let room_handler = null;
  beforeEach( function () {
    room_handler = new TwitterRoomHandler(bridge, config, handlers);
    _was_invited = false;
    _left = false;
    _message = false;
    _alias = false;
    _room_created = false;
    _handler_called = "";
  });

  describe('processInvite', function () {
    it('should fail if sender is the bot', function () {
      room_handler.processInvite({
        sender: "@foo:bar.com",
        state_key: "@foo:bar.com"
      }, null, {rooms: { remote: null } });
      assert.isFalse(_was_invited);
    });
    it('should fail if context is present', function () {
      room_handler.processInvite({
        sender: "@lemon:cake.com",
        state_key: "@foo:bar.com"
      }, null, {rooms: { remote: {} } });
      assert.isFalse(_was_invited);
    });
    it('should go to dm if context is present', function () {
      room_handler.processInvite({
        sender: "@lemon:cake.com",
        state_key: "@lemon:cake.com"
      }, null, {rooms: { remote: {} } });
      assert.isTrue(_was_invited);
      assert.equal(_handler_called, "directmessage");
    });
    it('should go to dm if the state key is not the bot', function () {
      room_handler.processInvite({
        sender: "@lemon:cake.com",
        state_key: "@lemon:cake.com"
      }, null, {rooms: { remote: null } });
      assert.isTrue(_was_invited);
      assert.equal(_handler_called, "directmessage");
    });
    it('should go to services if the state key is the bot', function () {
      room_handler.processInvite({
        sender: "@lemon:cake.com",
        state_key: "@foo:bar.com"
      }, null, {rooms: { remote: null } });
      assert.isTrue(_was_invited);
      assert.equal(_handler_called, "services");
    });
  });

  describe('processLeave', function () {
    it('should fail if context is null', function () {
      room_handler.processLeave(null, null, {rooms: { remote: null } })
      assert.isFalse(_left);
    });
    it('should fail if type is not used', function () {
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "timeline"}} } });
      assert.isFalse(_left);
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "hashtag"}} } });
      assert.isFalse(_left);
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "dm"}} } });
      assert.isFalse(_left);
    });
    it('should fail if type is not used', function () {
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "timeline"}} } });
      assert.isFalse(_left);
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "hashtag"}} } });
      assert.isFalse(_left);
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "dm"}} } });
      assert.isFalse(_left);
    });
    it('should succeed', function () {
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "service"}} } });
      assert.isTrue(_left);
      _left = false;
      room_handler.processLeave(null, null, {rooms: { remote: { data: { twitter_type: "user_timeline"}} } });
      assert.isTrue(_left);
    });
  });

  describe('processAliasQuery', function () {
    it("should return null if type isn't known", function () {
      assert.isNull(room_handler.processAliasQuery('', "_twitter_aa"));
    });
    it("should return true if type is @", function () {
      room_handler.processAliasQuery('', "_twitter_@timeline")
      assert.isTrue(_alias);
    });
    it("should return true if type is #", function () {
      room_handler.processAliasQuery('', "_twitter_#hashtag");
      assert.isTrue(_alias);
    });
  });

  describe('onRoomCreated', function () {
    it("should not call onRoomCreated if room not found", function () {
      bridge_room_entries = [];
      return room_handler.onRoomCreated("foo", "bar").then(() =>{
        assert.isFalse(_room_created);
      })
    });
    it("should not call onRoomCreated if type not known", function () {
      bridge_room_entries = [{
        remote: {
          data: {
            twitter_type: "service"
          }
        }
      }];
      return room_handler.onRoomCreated("foo", "bar").then(() =>{
        assert.isFalse(_room_created);
      });
    });
    it("should call onRoomCreated if type is timeline", function () {
      bridge_room_entries = [{
        remote: {
          data: {
            twitter_type: "timeline"
          }
        }
      }];
      return room_handler.onRoomCreated("foo", "bar").then(() =>{
        assert.isTrue(_room_created);
      });
    });
    it("should call onRoomCreated if type is hashtag", function () {
      bridge_room_entries = [{
        remote: {
          data: {
            twitter_type: "hashtag"
          }
        }
      }];
      return room_handler.onRoomCreated("foo", "bar").then(() =>{
        assert.isTrue(_room_created);
      });
    });
  });

  describe('passEvent', function () {
    it('should be able to call processMessage', function () {
      var request = {
        getData: function () {
          return {
            type: "m.room.message",
            sender: "@bar:bar.com"
          }
        }
      }
      room_handler.passEvent(request, {rooms: { remote: { data: { twitter_type: "service"}} } });
      assert.isTrue(_message);
      room_handler.passEvent(request, {rooms: { remote: { data: { twitter_type: "timeline"}} } });
      assert.isTrue(_message);
      room_handler.passEvent(request, {rooms: { remote: { data: { twitter_type: "hashtag"}} } });
      assert.isTrue(_message);
      room_handler.passEvent(request, {rooms: { remote: { data: { twitter_type: "dm"}} } });
      assert.isTrue(_message);
    });
    it('should be able to call processInvite', function () {
      var request = {
        getData: function () {
          return {
            type: "m.room.member",
            membership: "invite",
            sender: "@bar:bar.com",
            state_key: "@foo:bar.com"
          }
        }
      }
      room_handler.passEvent(request, {rooms: { remote: null } });
      assert.isTrue(_was_invited);
    });
    it('should be able to call processLeave', function () {
      var request = {
        getData: function () {
          return {
            type: "m.room.member",
            membership: "leave"
          }
        }
      }
      room_handler.passEvent(request, {rooms: { remote: { data: { twitter_type: "user_timeline" }} } });
      assert.isTrue(_left);
    });
    it('should not call processMessage if the sender differs (user_timeline)', function () {
      var request = {
        getData: function () {
          return {
            type: "m.room.message",
            sender: "@foo:bar.com"
          }
        }
      }
      room_handler.passEvent(request, {
        rooms: { remote: { data: { twitter_type: "user_timeline", twitter_owner: "@bar:bar.com"}}}
      });
      assert.isFalse(_message);
    });
    it('should be able to call processMessage (user_timeline)', function () {
      var request = {
        getData: function () {
          return {
            type: "m.room.message",
            sender: "@bar:bar.com"
          }
        }
      }
      room_handler.passEvent(request, {
        rooms: { remote: { data: { twitter_type: "user_timeline", twitter_owner: "@bar:bar.com"}}}
      });
      assert.isTrue(_message);
    });
    it('should ignore other events', function () {
      let type = "m.room.member";
      const request = {
        getData: () => {
          return {
            type: type,
            membership: "potato",
            sender: "@bar:bar.com",
            state_key: "@foo:bar.com"
          }
        }
      }
      room_handler.passEvent(request, {rooms: { remote: null } });
      type = "m.room.message";
      room_handler.passEvent(request, {rooms: { remote: null } });
      room_handler.passEvent(request, {rooms: { remote: { data: { twitter_type: "fail"}} } });
      type = "m.room.fake";
      room_handler.passEvent(request, {rooms: { remote: {} } });
      assert.isFalse(_was_invited);
      assert.isFalse(_left);
      assert.isFalse(_message);
    });

  });
});
