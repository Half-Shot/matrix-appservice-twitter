const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const TweetProcessor = require('../src/TweetProcessor.js');


const client = {

}

const twitter = {

}

const intent = {
  sendEvent: function () {
    event_sent = true;
    return Promise.resolve({event_id: "$foobar"});
  }
}

const bridge = {
  getIntent: function () {
    return intent;
  }
}

var event_added, event_sent = false;

const storage = {
  add_event: function ( ) {
    event_added = true;
  }
}


const opts = {
  client,
  twitter,
  bridge,
  storage,
  media: {
    enable_download: true
  }
}

describe('TweetProcessor', function () {
  var processor;
  beforeEach( function () {
    processor = new TweetProcessor(opts);
    event_added = false;
    event_sent = false;
  });
  describe('start', function () {
    it('will start ', function () {
      processor._process_head_of_msg_queue = () => {};
      processor.start();
    });
  });
  describe('_process_head_of_msg_queue', function () {
    it('will do nothing on an empty queue. ', function () {
      return assert.isFulfilled(processor._process_head_of_msg_queue());
    });
    it('will send a m.text event. ', function () {
      event_added = false;
      event_sent = false;
      processor.msg_queue.push([{
        roomId: "!foo:bar",
        type: "m.room.message",
        userId: "@foo:bar",
        content: {tweet_id: "11111", msgtype: "m.text"}
      }])
      return assert.isFulfilled(processor._process_head_of_msg_queue()).then( () =>{
        assert.isTrue(event_sent);
        assert.isTrue(event_added);
        assert.isTrue(processor.msg_queue.length === 0);
      });
    });
    it('will not store a non m.text event.', function () {
      event_added = false;
      event_sent = false;
      processor.msg_queue.push([{
        roomId: "!foo:bar",
        type: "m.room.message",
        userId: "@foo:bar",
        content: {tweet_id: "11111", msgtype: "m.potato"}
      }])
      return assert.isFulfilled(processor._process_head_of_msg_queue()).then( () =>{
        assert.isTrue(event_sent);
        assert.isFalse(event_added);
        assert.isTrue(processor.msg_queue.length === 0);
      });
    });
  });
});
