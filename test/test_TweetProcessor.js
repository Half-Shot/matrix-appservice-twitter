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
    describe('_tweet_expand_urls', function () {
      it('will not modify a urlless tweet.', function () {
        const text = processor._tweet_expand_urls("Words, words and more words", []);
        assert.equal(text, "Words, words and more words");
      });
      it('will modify a tweet with a single url.', function () {
        const text = processor._tweet_expand_urls("Words,http://short words and more words", [{
          expanded_url: "http://example.com",
          indices: [6, 18]
        }]);
        assert.equal(text, "Words,http://example.com words and more words");
      });
      it('will modify a tweet with two urls.', function () {
        const text = processor._tweet_expand_urls("Words,http://short words and more words with http://e.shorter", [{
          expanded_url: "http://example.com",
          indices: [6, 18]
        }, {
          expanded_url: "https://evenshorter.com",
          indices: [45, 61]
        }]);
        assert.equal(text, "Words,http://example.com words and more words with https://evenshorter.com");
      });
      it('will modify a tweet with three urls.', function () {
        const text = processor._tweet_expand_urls(
          "Words,http://short words and http://m.short more words with http://e.shorter",
          [{
            expanded_url: "http://example.com",
            indices: [6, 18]
          }, {
            expanded_url: "http://penguins.com",
            indices: [29, 43]
          }, {
            expanded_url: "https://evenshorter.com",
            indices: [60, 76]
          }]
        );
        assert.equal(
          text,
          "Words,http://example.com words and http://penguins.com more words with https://evenshorter.com"
        );
      });
    });
  });
});
