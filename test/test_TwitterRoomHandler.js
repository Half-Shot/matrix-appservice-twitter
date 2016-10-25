const assert = require('assert');
const TwitterRoomHandler = require('../src/TwitterRoomHandler.js');

class DummyHandler {
  processInvite () {

  }
}

describe('TwitterRoomHandler', function () {
  var handler = TwitterRoomHandler(
    {
      opts: {
        domain: "example.com",
        registration: {
          sender_localpart: "test"
        }
      }
    },
    {

    },
    {
      services: new DummyHandler()
    }
  );
  describe('processInvite()', function () {

  });
});
