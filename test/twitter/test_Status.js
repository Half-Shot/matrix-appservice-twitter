const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const Status = require('../../src/twitter/Status.js');

// Initialise logging
require('../../src/logging.js').init({level: 'silent'});

var notified = false;

const twitter = {
  notify_matrix_user: function () {
    notified = true;
  },
  profile: {
    get_by_id: function (id) {
      return Promise.resolve({
        screen_name: id
      });
    },
  },
  client_factory: {
    get_client: function () {
      return Promise.resolve();
    }
  },

  storage: {
    users: {},
    get_profile_from_userid: function () {
      return Promise.resolve({
        screen_name: "foobar"
      })
    },
    get_twitter_account: function (id) {
      if(!this.users[id]) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        access_type: this.users[id]
      });
    }
  }
};

describe('Status', function () {
  var status;
  beforeEach( function () {
    status = new Status(twitter);
    notified = false;
  });

  describe('_can_send', function () {
    it("returns false if the user is null", function () {
      return assert.isRejected(status._can_send(null));
    });
    it("returns false if the user has not linked their account", function () {
      twitter.storage.users["@foo:bar"] = null;
      return assert.isRejected(status._can_send("@foo:bar"));
    });
    it("returns false if the user has read permissions", function () {
      twitter.storage.users["@foo:bar"] = "read";
      return assert.isRejected(status._can_send("@foo:bar"));
    });
    it("returns true if the user has write/dm permissions", function () {
      twitter.storage.users["@foo:bar"] = "dm";
      var p1 = assert.becomes(status._can_send("@foo:bar"), true);
      twitter.storage.users["@foo:dah"] = "write";
      return Promise.all([assert.becomes(status._can_send("@foo:dah"), true), p1]);
    });
  });

  describe('send_matrix_event', function () {
    let event;
    beforeEach( function () {
      status = new Status(twitter);
      notified = false;
      event = {content: {body: ""}};
      status._build_tweets = status._send_tweets = () => {return Promise.resolve();}
    });

    it('will not send if _can_send fails', function () {
      notified = false;
      status._can_send = () => {return Promise.reject("Fail.");}
      return assert.isRejected(status.send_matrix_event(event, "@foo:bar"));
    });

    it('will not send if _get_room_context fails', function () {
      notified = false;
      status._can_send = () => {return Promise.resolve();}
      status._get_room_context = () => {return Promise.reject();}
      return assert.isRejected(status.send_matrix_event(event, "@foo:bar"));
    });

    it('will not send if _get_room_context does not match tweet context', function () {
      status._can_send = () => {return Promise.resolve();}
      status._get_room_context = () => {return Promise.resolve({screennames: [], hashtags: []})};
      return Promise.all(["@words and poems", "#words and poems", "words and poems"].map(body => {
        return assert.isRejected(status.send_matrix_event({content: {body}}, "@foo:bar"));
      }));
    });

    it('will not send if _get_tweet_context does not match room context', function () {
      status._can_send = () => {return Promise.resolve();}
      status._get_tweet_context = () => {return {screennames: ["poems"], hashtags: ["words"]}};
      status._get_room_context = () => {return Promise.resolve({screennames: ["words"], hashtags: ["poems"]})};
      return assert.isRejected(status.send_matrix_event(event, "@foo:bar"));
    });

    it('will send if _get_room_context does match tweet context', function () {
      status._can_send = () => {return Promise.resolve();}
      status._get_tweet_context = () => {return {screennames: ["poems"], hashtags: ["words"]}};
      status._get_room_context = () => {return Promise.resolve({screennames: ["poems"], hashtags: ["words"]})};
      return assert.isFulfilled(status.send_matrix_event(event, "@foo:bar"));
    });

    it('will send if _get_room_context passes the tweet', function () {
      status._can_send = () => {return Promise.resolve();}
      status._get_room_context = () => {return Promise.resolve({screennames: [], hashtags: [], pass: true})};
      return assert.isFulfilled(status.send_matrix_event(event, "@foo:bar"));
    });

    it('will notify on fail', function () {
      notified = false;
      status._can_send = () => {return Promise.reject({"notify": "Oh dear!", "error": "Something went wrong!"});}
      return assert.isRejected(status.send_matrix_event(event, "@foo:bar", null)).then(() =>{
        return assert.isTrue(notified, true);
      });
    });

  });

  describe('_get_tweet_context', function () {
    const tests = new Map();
    tests.set("", { "screennames": [], "hashtags": []});
    tests.set("@This is fine", { "screennames": ["This"], "hashtags": []});
    tests.set("@This #is @fine", { "screennames": ["This", "fine"], "hashtags": ["is"]});
    tests.set("@Half_Shot", { "screennames": ["Half_Shot"], "hashtags": []});
    tests.set("#Half_Shot", { "screennames": [], "hashtags": ["Half_Shot"]});
    tests.set("@this is #fine", { "screennames": ["this"], "hashtags": ["fine"]});
    tests.set("#Guess what", { "screennames": [], "hashtags": ["Guess"]});
    tests.set("This@isnot@fine", { "screennames": [], "hashtags": []});
    tests.set("This#isnot# fine", { "screennames": [], "hashtags": []});
    tests.set("This @isreallynotfinesopleaseno", { "screennames": [], "hashtags": []});
    tests.set("This #isaboslutelyfineandyoucandothis",
     { "screennames": [], "hashtags": ["isaboslutelyfineandyoucandothis"]}
    );
    tests.set("This #isfine@withthis", { "screennames": [], "hashtags": ["isfine"]});
    tests.set("This is also @fine#withthis", { "screennames": ["fine"], "hashtags": []});
    tests.set("~~@thisisfine", { "screennames": ["thisisfine"], "hashtags": []});
    tests.set("~~#thisisfine", { "screennames": [], "hashtags": ["thisisfine"]});
    tests.forEach((value, key) =>{
      it(`"${key}" will return "${JSON.stringify(value)}"`, function () {
        assert.deepEqual(status._get_tweet_context(key), value);
      });
    });
  });

  describe('_get_room_context', function () {
    const empty = {screennames: [], hashtags: [], pass: false}
    it('will return empty without context', function () {
      return assert.eventually.deepEqual(status._get_room_context([]), empty);
    });
    it('will return a screename for a timeline room', function () {
      return assert.eventually.deepEqual(status._get_room_context([{
        data: {
          twitter_type: "timeline",
          twitter_user: "fakeuser",
          twitter_bidirectional: true
        }
      }]), {screennames: ["fakeuser"], hashtags: [], pass: false });
    });
    it('will return a screename & pass for a user_timeline room', function () {
      return assert.eventually.deepEqual(status._get_room_context([{
        data: {
          twitter_type: "user_timeline",
          twitter_owner: "foobar",
          twitter_bidirectional: true
        }
      }]), {screennames: ["foobar"], hashtags: [], pass: true });
    });
    it('will return a hashtag for a hashtag room', function () {
      return assert.eventually.deepEqual(status._get_room_context([{
        data: {
          twitter_type: "hashtag",
          twitter_hashtag: "hashtag",
          twitter_bidirectional: true
        }
      }]), {screennames: [], hashtags: ["hashtag"], pass: false });
    });
    it('will return empty if not bidirectional', function () {
      var promises = [];
      for(var type of ["user_timeline", "hashtag", "timeline"]) {
        promises.push(assert.eventually.deepEqual(status._get_room_context([{
          data: {
            twitter_type: type,
            twitter_bidirectional: false
          }
        }]), empty ));
        promises.push(assert.eventually.deepEqual(status._get_room_context([{
          data: {
            twitter_type: type
          }
        }]), empty ));
      }
      return Promise.all(promises);
    });
  });

  describe('_build_tweets', function () {
    const event = {content: {}};
    const profile = {screen_name: "foobar"};
    const context = {};
    it('will return no tweets on an empty content', function () {
      event.content.msgtype = "m.text";
      event.content.body = "";
      return assert.eventually.deepEqual(status._build_tweets(event, context, profile), []);
    });
    it('will return no tweets on a unsupported type', function () {
      event.content.msgtype = "m.potato";
      event.content.body = "";
      return assert.eventually.deepEqual(status._build_tweets(event, context, profile), []);
    });
    it('will return a single tweet with a 140 char message', function () {
      event.content.msgtype = "m.text";
      event.content.body = "x".repeat(140);
      return status._build_tweets(event, context, profile).then(tweets => {
        assert.equal(tweets.length, 1);
        assert.equal(tweets[0].status, event.content.body);
        assert.isNull(tweets[0].in_reply_to_status_id);
      })
    });
    it('will return a two tweets with a 180 char message', function () {
      event.content.msgtype = "m.text";
      event.content.body = "x".repeat(180);
      return status._build_tweets(event, context, profile).then(tweets => {
        assert.equal(tweets.length, 2);
        assert.equal(tweets[0].status, event.content.body.substr(0, 140));
        assert.equal(tweets[1].status, "@foobar " + event.content.body.substr(140));
        assert.isNull(tweets[0].in_reply_to_status_id);
        assert.equal(tweets[1].in_reply_to_status_id, "previous");
      })
    });
    it('will return the maximum number of tweets with a 404 length message', function () {
      event.content.msgtype = "m.text";
      event.content.body = "x".repeat(404);
      return status._build_tweets(event, context, profile).then(tweets => {
        assert.equal(tweets.length, 3);
        assert.equal(tweets[0].status.length, 140);
        assert.equal(tweets[1].status.length, 140);
        assert.equal(tweets[2].status.length, 140);

        assert.isNull(tweets[0].in_reply_to_status_id);
        assert.equal(tweets[1].in_reply_to_status_id, "previous");
        assert.equal(tweets[1].in_reply_to_status_id, "previous");
      })
    });
    it('will reject when going over the maximum number', function () {
      event.content.msgtype = "m.text";
      event.content.body = "x".repeat(405);
      return assert.isRejected(status._build_tweets(event, context, profile));
    });
    it('will return a * wrapped message if type is a m.emote', function () {
      event.content.msgtype = "m.emote";
      event.content.body = "x".repeat(138);
      return status._build_tweets(event, context, profile).then(tweets => {
        assert.equal(tweets.length, 1);
        assert.equal(tweets[0].status, "*" + event.content.body + "*");
        assert.isNull(tweets[0].in_reply_to_status_id);
      })
    });
    it('will reject m.image (not supported yet)', function () {
      event.content.msgtype = "m.image";
      return assert.isRejected(status._build_tweets(event, context, profile));
    });
  });

  describe('_send_tweets', function () {
    let sent_count = 0;
    let last_tweet = null;
    beforeEach( function () {
      sent_count = 0;
      last_tweet = null;
    });

    const client = {
      post: function (url, tweet) {
        sent_count++;
        last_tweet = tweet;
        return Promise.resolve({
          id_str: "previous_tweet"
        })
      }
    }
    const tweets = [];
    it('will send a single tweet', function () {
      tweets.push({
        status: "Words",
        in_reply_to_status_id: null
      })
      return status._send_tweets(client, tweets, null).then( () => {
        assert.equal(sent_count, 1);
      });
    });
    it('will send multiple tweets', function () {
      tweets.push({
        status: "Words",
        in_reply_to_status_id: null
      })
      tweets.push({
        status: "Words",
        in_reply_to_status_id: "previous"
      })
      return status._send_tweets(client, tweets, null).then( () => {
        assert.equal(sent_count, 2);
        assert.equal(last_tweet.in_reply_to_status_id, "previous_tweet");
      });
    });
    it('will report a failed send', function () {
      client.post = function () {
        return Promise.reject("Some dumb error");
      }
      tweets.push({
        status: "Words",
        in_reply_to_status_id: null
      })
      assert.isRejected(status._send_tweets(client, tweets, null));
    });
  });
});
