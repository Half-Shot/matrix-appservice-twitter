const chai = require('chai');
chai.use(require("chai-as-promised"));
const assert = chai.assert;
const Timeline = require('../../src/twitter/Timeline.js');
const Promise  = require('bluebird');

const Timeout = setTimeout(function () { }, 0).constructor; // Only way to access Timeout

// Initialise logging
require('../../src/logging.js').init({level: 'silent'});
describe('Timeline', function () {
  let timeline;
  let _check_empty_rooms; //For coroutine.
  let _since = null;
  let _tweets_fetched;
  const twitter = {
    bridge: {
      getBot: () => {
        return {
          getMemberLists: () => {
            return Promise.resolve({
              foobar: {
                realJoinedUsers: []
              },
              bazbar: {
                realJoinedUsers: ["a", "b", "c", "d", "e"]
              }
            });
          }
        }
      }
    },
    storage: {
      get_since: () => {
        return Promise.resolve(_since);
      },
      set_since: (account, since) => {
        _since = since;
      }
    },
    processor: {
      process_tweets: () => {
        return Promise.resolve();
      }
    },
    client_factory: {
      get_client: () => {
        return Promise.resolve({
          get: (path, req) => {
            _tweets_fetched = true;
            const feed = [];
            for(let i = 0;i<req.count; i++) {
              feed.push({
                id_str: String(i)
              });
            }
            if(path === "search/tweets") {
              return Promise.resolve({statuses: feed});
            }
            return Promise.resolve(feed);
          }
        });
      }
    }
  }
  beforeEach( function () {
    _tweets_fetched = false;
    timeline = new Timeline(twitter, {
      enable: true,
      poll_if_empty: false,
    }, {
      enable: true,
    });
    _check_empty_rooms = Promise.coroutine(timeline._check_empty_rooms.bind(timeline));
  });

  describe('empty room timers', function () {
    it('start_empty_room_checker/stop_empty_room_checker should control the timer', function () {
      timeline.start_empty_room_checker();
      assert.instanceOf(timeline._empty_intervalID, Timeout);
      timeline.stop_empty_room_checker();
      assert.isNull(timeline._empty_intervalID);
    });
    it('should fail if not started', function () {
      assert.throws(timeline.stop_empty_room_checker.bind(timeline));
    });
  });

  describe('timeline timers', function () {
    it('start_timeline/stop_timeline should control the timer', function () {
      timeline.start_timeline();
      assert.instanceOf(timeline._t_intervalID, Timeout);
      timeline.stop_timeline();
      assert.isNull(timeline._t_intervalID);
    });
    it('should fail if not started', function () {
      assert.throws(timeline.stop_timeline.bind(timeline));
    });
  });

  describe('hashtag timers', function () {
    it('start_hashtag/stop_hashtag should control the timer', function () {
      timeline.start_hashtag();
      assert.instanceOf(timeline._h_intervalID, Timeout);
      timeline.stop_hashtag();
      assert.isNull(timeline._h_intervalID);
    });
    it('should fail if not started', function () {
      assert.throws(timeline.stop_hashtag.bind(timeline));
    });
  });

  describe('add_hashtag', function () {
    it('must not add a timeline if the config denys it', function () {
      timeline = new Timeline(null, {}, {
        enable: false,
      });
      assert.isFalse(timeline.add_hashtag("string", "!room:someplace"));
    });
    it('should add a new hashtag with no opts and invalid room', function () {
      assert.throws(() => {
        timeline.add_hashtag("test");
      }, "Not a valid room_id");
      assert.throws(() => {
        timeline.add_hashtag("test", "somewords");
      }, "Not a valid room_id");
    });
    it('should add a new invalid hashtag', function () {
      assert.throws(() => {
        timeline.add_hashtag("£$^£$£$", "!room:someplace");
      }, "Not a valid hashtag");
    });
    it('should add a new hashtag without is_new', function () {
      assert.isTrue(timeline.add_hashtag("test", "!room:someplace"));
      assert.equal(timeline._hashtags[0].hashtag, "test");
      assert.isTrue(timeline._hashtags[0].room.has("!room:someplace"));
    });
    it('should add a new hashtag with is_new', function () {
      assert.isTrue(timeline.add_hashtag("test", "!room:someplace", {is_new: true}));
      assert.isTrue(timeline._newtags.has("#test"));
    });
    it('should update an existing hashtag with a new room', function () {
      assert.isTrue(timeline.add_hashtag("test", "!room:someplace"));
      assert.isTrue(timeline._hashtags[0].room.has("!room:someplace"));
      assert.isTrue(timeline.add_hashtag("test", "!room2:someplace"));
      assert.sameMembers([...timeline._hashtags[0].room], ["!room:someplace", "!room2:someplace"]);
    });
  });

  describe('add_timeline', function () {
    it('must not add a timeline if the config denys it', function () {
      timeline = new Timeline(null, {
        enable: false,
      }, {});
      assert.isFalse(timeline.add_timeline("string", "!room:someplace"));
    });
    it('should add a new timeline with no opts and invalid room', function () {
      assert.throws(() => {
        timeline.add_timeline("test");
      }, "Not a valid room_id");
      assert.throws(() => {
        timeline.add_timeline("test", "somewords");
      }, "Not a valid room_id");
    });
    it('should add a new timeline without is_new', function () {
      assert.isTrue(timeline.add_timeline("test", "!room:someplace"));
      assert.equal(timeline._timelines[0].twitter_id, "test");
      assert.isTrue(timeline._timelines[0].room.has("!room:someplace"));
    });
    it('should add a new timeline with is_new', function () {
      assert.isTrue(timeline.add_timeline("test", "!room:someplace", {is_new: true}));
      assert.isTrue(timeline._newtags.has("test"));
    });
    it('should update an existing timeline with a new room', function () {
      assert.isTrue(timeline.add_timeline("test", "!room:someplace"));
      assert.isTrue(timeline._timelines[0].room.has("!room:someplace"));
      assert.isTrue(timeline.add_timeline("test", "!room2:someplace"));
      assert.sameMembers([...timeline._timelines[0].room], ["!room:someplace", "!room2:someplace"]);
    });
  });

  describe('remove_timeline', function () {
    it('should return false if the timeline does not exist', function () {
      assert.isFalse(timeline.remove_timeline("test", "!room:someplace"));
    });
    it('should remove a timeline.', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set()
      });
      timeline._timelines.push({
        twitter_id: "test2",
        room: new Set()
      });
      timeline._timelines.push({
        twitter_id: "test3",
        room: new Set()
      });
      assert.isTrue(timeline.remove_timeline("test"));
      assert.equal(timeline._timelines[0].twitter_id, "test2");
      assert.equal(timeline._timelines[1].twitter_id, "test3");
      assert.isTrue(timeline.remove_timeline("test2"));
      assert.equal(timeline._timelines[0].twitter_id, "test3");
    });
    it('should remove a timeline with a single room.', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set(["bacon"])
      })
      assert.isTrue(timeline.remove_timeline("test", "bacon"));
      assert.equal(timeline._timelines.length, 0);
    });
    it('should return true if the room does not exist', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set(["bacon"])
      })
      assert.isTrue(timeline.remove_timeline("test", "!room:someplace"));
      assert.deepEqual(timeline._timelines, [
        {
          twitter_id: "test",
          room: new Set(["bacon"])
        }
      ]);
    });
  });

  describe('timeline._process_timeline', function () {
    it('should not process if the timeline list is empty.', function () {
      return timeline._process_timeline().then(() => {
        assert.equal(timeline._t, -1);
      });
    });
    it('should skip empty rooms.', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set(["bacon"])
      });
      timeline._empty_rooms.add("bacon");
      return timeline._process_timeline().then(() => {
        assert.isFalse(_tweets_fetched);
      });
    });
    it('should fetch some tweets.', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set(["bacon"])
      });
      return timeline._process_timeline().then(() => {
        assert.equal(timeline._t, 0, "Queue is incremented.");
        assert.equal(_since, "0");
      });
    });
    it('should wrap around queue.', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set(["bacon"])
      });
      timeline._timelines.push({
        twitter_id: "test1",
        room: new Set(["bacon"])
      });
      timeline._timelines.push({
        twitter_id: "test2",
        room: new Set(["bacon"])
      });
      return timeline._process_timeline().then(() => {
        assert.equal(timeline._t, 0, "Queue is incremented.");
        return timeline._process_timeline();
      }).then(() => {
        assert.equal(timeline._t, 1, "Queue is incremented.");
        return timeline._process_timeline();
      }).then(() => {
        assert.equal(timeline._t, 2, "Queue is incremented.");
        return timeline._process_timeline();
      }).then(() => {
        assert.equal(timeline._t, 0, "Queue is incremented.");
      });
    });
    it('should fetch a tweet for _newtags mode.', function () {
      timeline._timelines.push({
        twitter_id: "test",
        room: new Set(["bacon"])
      });
      timeline._newtags.add("test");
      return timeline._process_timeline().then(() => {
        assert.equal(timeline._t, 0, "Queue is incremented.");
        assert.equal(_since, "0");
        assert.isFalse(timeline._newtags.has("test"));
      });
    });
  });
  describe('timeline._process_hashtags', function () {
    it('should not process if the hashtag list is empty.', function () {
      timeline._process_hashtag().then(() => {
        assert.equal(timeline._h, -1);
      });
    });
    it('should skip empty rooms.', function () {
      timeline._hashtags.push({
        hashtag: "test",
        room: new Set(["bacon"])
      });
      timeline._empty_rooms.add("bacon");
      return timeline._process_hashtag().then(() => {
        assert.isFalse(_tweets_fetched);
      });
    });
    it('should fetch some tweets.', function () {
      timeline._hashtags.push({
        hashtag: "test",
        room: new Set(["bacon"])
      });
      return timeline._process_hashtag().then(() => {
        assert.equal(timeline._h, 0, "Queue is incremented.");
        assert.equal(_since, "0");
      });
    });
    it('should wrap around queue.', function () {
      timeline._hashtags.push({
        hashtag: "test",
        room: new Set(["bacon"])
      });
      timeline._hashtags.push({
        hashtag: "test1",
        room: new Set(["bacon"])
      });
      timeline._hashtags.push({
        hashtag: "test2",
        room: new Set(["bacon"])
      });
      return timeline._process_hashtag().then(() => {
        assert.equal(timeline._h, 0, "Queue is incremented.");
        return timeline._process_hashtag();
      }).then(() => {
        assert.equal(timeline._h, 1, "Queue is incremented.");
        return timeline._process_hashtag();
      }).then(() => {
        assert.equal(timeline._h, 2, "Queue is incremented.");
        return timeline._process_hashtag();
      }).then(() => {
        assert.equal(timeline._h, 0, "Queue is incremented.");
      });
    });
    it('should fetch a tweet for _newtags mode.', function () {
      timeline._hashtags.push({
        hashtag: "test",
        room: new Set(["bacon"])
      });
      timeline._newtags.add("#test");
      return timeline._process_hashtag().then(() => {
        assert.equal(timeline._h, 0, "Queue is incremented.");
        assert.equal(_since, "0");
        assert.isFalse(timeline._newtags.has("#test"));
      });
    });
  });
  describe('_check_empty_rooms', function () {
    it('should add a empty room to the set.', function () {
      _check_empty_rooms().then(()=> {
        assert.isTrue(timeline._empty_rooms.has("foobar"));
      })
    });
    it('should not add an active room to the set.', function () {
      _check_empty_rooms().then(()=> {
        assert.isFalse(timeline._empty_rooms.has("bazbar"));
      })
    });
  });
});
