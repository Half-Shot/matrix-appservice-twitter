const log      = require('npmlog');


const TIMELINE_POLL_INTERVAL = 3050; //Twitter allows 300 calls per 15 minute (We add 50 milliseconds for a little safety).
const HASHTAG_POLL_INTERVAL = 3050; //Twitter allows 450 calls per 15 minute (We add 50 milliseconds for a little safety).
const TIMELINE_TWEET_FETCH_COUNT = 100;
const HASHTAG_TWEET_FETCH_COUNT = 100;
const TWEET_REPLY_MAX_DEPTH = 3;

/**
  Terms:
    Timeline - A users twitter feed.
    Hashtag - Results of a search for a particular hashtag.
*/

class Timeline {
  constructor (twitter) {
    this.twitter = twitter;
    this._t_intervalID = null;
    this._h_intervalID = null;
    this._timelines = [] // {twitter_id:string, room_id:[string]}
    this._hashtags = [] // {hashtag:string, room_id:[string]}
    this._h = 0;
    this._t = 0;
  }

  /**
   * Start the timeline timer so that timelines will be processed in turn.
   */
  start_timeline () {
    this._t_intervalID = setInterval(() => {this._process_timeline();}, TIMELINE_POLL_INTERVAL);
  }

  /**
   * Stop the timeline timer. No more timelines will be processed.
   */
  stop_timeline () {
    if (this._t_intervalID) {
      clearInterval(this._t_intervalID);
      this._t_intervalID = null;
    }
  }

  /**
   * Start the hashtag timer so that hashtags are processed in turn.
   */
  start_hashtag () {
    this._h_intervalID = setInterval(() => {this._process_hashtags();}, HASHTAG_POLL_INTERVAL);
  }

  /**
   * Stop the hashtag timer so that hashtags are no longer processed.
   */
  stop_hashtag () {
    if (this._h_intervalID) {
      clearInterval(this._h_intervalID);
      this._h_intervalID = null;
    }
  }

  /**
   * Add a Twitter hashtag to the hashtag processor. Tweets will be
   * automatically send to the given room.
   *
   * @param  {string} hashtag The twitter ID of a timeline. (without the #)
   * @param  {string} room_id The room_id to insert tweets into.
   */
  add_hashtag (hashtag, room_id) {
    var htag = this._find_hashtag(hashtag);
    var obj;
    if(htag != -1) {
      obj = this._hashtags[htag]
    }
    else {
      obj = {hashtag, room: [] }
    }
    if(!obj.room.includes(room_id)) {
      obj.room.push(room_id);
    }
    this._hashtags.push(obj);
    log.info('Timeline', "Added Hashtag: %s", hashtag);
  }

  /**
   * Add a Twitters user's timeline to the timeline processor. Tweets will be
   * automatically send to the given room.
   *
   * @param  {string} twitter_id The twitter ID of a timeline.
   * @param  {string} room_id The room_id to insert tweets into.
   */
  add_timeline (twitter_id, room_id) {
    var tline = this._find_timeline(twitter_id);
    var obj;
    if(tline != -1) {
      obj = this._timelines[tline]
    }
    else {
      obj = {twitter_id, room: [] }
    }
    if(!obj.room.includes(room_id)) {
      obj.room.push(room_id);
    }
    this._timelines.push(obj);
    log.info('Timeline', "Added Timeline: %s", twitter_id);
  }

  /**
   * remove_timeline - Remove a timeline from being
   * processed.
   *
   * @param  {string} twitter_id The twitter id of the timeline to remove.
   * @param  {string} [room_id] If specified, only remove from this room.
   */
  remove_timeline (twitter_id, room_id) {
    this._remove_from_queue(true, twitter_id, room_id);
  }

  /**
   * remove_timeline - Remove a hashtag from being
   * processed.
   *
   * @param  {string} hashtag The hashtag to remove. (without the #)
   * @param  {string} [room_id] If specified, only remove from this room.
   */
  remove_hashtag (hashtag, room_id) {
    this._remove_from_queue(false, hashtag, room_id);
  }

  _remove_from_queue (isTimeline, id, room_id) {
    var i = isTimeline ? this._find_timeline(id) : this._find_hashtag(id);
    var queue = isTimeline ? this._timelines : this._hashtags;
    if(i != -1) {
      if(room_id) {
        var r = queue[i].room.findIndxex(room_id);
        if (r != -1) {
          delete queue[i].room[r];
        }
        else{
          log.warn("Timeline", "Tried to remove %s for %s but it didn't exist", room_id, id);
        }
      }
      else {
        queue[i].room = []
      }
      if(queue[i].room.length == 0) {
        queue = this._timelines.splice(i, 1);
      }
    }
    else {
      log.warn("Timeline", "Tried to remove %s but it doesn't exist", id);
    }
  }

  _process_timeline () {
    if (this._timelines.length === 0) {
      return;
    }

    var tline = this._timelines[this._t];
    var req = {
      user_id: tline.twitter_id,
      count: TIMELINE_TWEET_FETCH_COUNT
    };

    var since = this._storage.get_since("@"+tline.twitter_id);
    if (since) {
      req.since_id = since;
    }

    this.twitter._client_factory.get_client().get('statuses/user_timeline', req, (error, feed) => {
      if(error) {
        log.error("Timeline", "_process_timeline: GET /statuses/user_timeline returned: %s", error);
        return;
      }
      if (feed.length === 0) {
        return;
      }

      if(feed.length == TIMELINE_TWEET_FETCH_COUNT) {
        log.info("Timeline", "Timeline poll request hit count limit. Request likely incomplete.");
      }

      this._storage.set_since("@"+tline.twitter_id, feed[0].id);

      this._processor.process_tweets(tline.entry.matrix.roomId, feed.reverse(), TWEET_REPLY_MAX_DEPTH);

    });

    this._t++;
    if(this._t >= this._timelines.length) {
      this._t = 0;
    }
  }

  _process_hashtags () {
    if (this._hashtags.length < 1) {
      return;
    }

    var feed = this._hashtags[this._h];
    var req = {
      q: "%23"+feed.hashtag,
      result_type: 'recent',
      count: HASHTAG_TWEET_FETCH_COUNT
    };

    var since = this._storage.get_since(feed.hashtag);
    if (since != undefined) {
      req.since_id = since;
    }

    this.app_twitter.get('search/tweets', req, (error, results) => {
      if(error) {
        log.error("Twitter", "_process_hashtag_feed: GET /search/tweets returned: %s", error);
        return;
      }

      if (results.statuses === 0) {
        return;
      }

      if(results.statuses.length == HASHTAG_TWEET_FETCH_COUNT) {
        log.info("Twitter", "Hashtag poll request hit count limit. Request likely incomplete.");
      }

      this._storage.set_since("@"+feed.hashtag, results.statuses[0].id);

      this._processor.process_tweets(feed.entry.matrix.roomId, results.statuses.reverse(), 0);

    });

    this._h++;
    if(this._h >= this._hashtags.length) {
      this._h = 0;
    }
  }

  _find_timeline (twitter_id) {
    return this._timelines.findIndex((tline) =>
    {
      return tline.twitter_id == twitter_id;
    });
  }

  _find_hashtag (hashtag) {
    return this._hashtags.findIndex((item) =>
    {
      return item.hashtag == hashtag;
    });
  }

}

module.exports = Timeline;
