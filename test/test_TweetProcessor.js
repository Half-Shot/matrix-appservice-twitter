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
      processor.stop();
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
  describe('tweet_to_matrix_content', function () {
    it('will convert html special chars to regular characters.', function () {
      const mx_content = processor.tweet_to_matrix_content({
        text: "&lt;3",
        entities: { },
        user: {

        }
      });
      const mx_content2 = processor.tweet_to_matrix_content({
        text: "<3",
        entities: { },
        user: {

        }
      });
      assert.equal(mx_content.body, "<3");
      assert.equal(mx_content2.body, "<3");
    });
    it('will put hashtags in content', function () {
      const mx_content = processor.tweet_to_matrix_content({
        text: "#foo, #bar and #baz",
        entities: {
          hashtags: [
            {
              indices: [0, 3],
              text: "foo"
            },
            {
              indices: [6, 10],
              text: "bar"
            },
            {
              indices: [15, 19],
              text: "baz"
            }
          ]
        },
        user: {

        }
      });
      assert.sameMembers(mx_content.tags, ["foo", "bar", "baz"]);
    });
    it('will put metadata in content', function () {
      const mx_content = processor.tweet_to_matrix_content({
        full_text: "This is a fulltext.",
        created_at: "Today",
        favorite_count: 5,
        retweet_count: 42,
        id_str: "820675371330916353",
        entities: { },
        user: {
          screen_name: "Half_Shot",
          id_str: "366675043"
        },
        _retweet_info: "This would be a retweet thing, but here is some content"
      });
      assert.equal(mx_content.body, "This is a fulltext.");
      assert.equal(mx_content.created_at, "Today");
      assert.equal(mx_content.likes, 5);
      assert.equal(mx_content.reblogs, 42);
      assert.equal(mx_content.tweet_id, "820675371330916353");
      assert.equal(mx_content.external_url, "https://twitter.com/Half_Shot/status/820675371330916353");
      assert.equal(mx_content.created_at, "Today");
      assert.equal(mx_content.retweet, "This would be a retweet thing, but here is some content");
    });
    // full_text or text
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
