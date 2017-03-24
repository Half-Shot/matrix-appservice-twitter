const log      = require('../logging.js');
const Promise  = require('bluebird');
const Util  = require('../util.js');

const TIMELINE_POLL_INTERVAL = 3010; //Twitter allows 300 calls per 15 minute (We add 10 milliseconds for a little safety).
const HASHTAG_POLL_INTERVAL = 2010; //Twitter allows 450 calls per 15 minute (We add 10 milliseconds for a little safety).
const EMPTY_ROOM_INTERVAL = 30000;
const TIMELINE_TWEET_FETCH_COUNT = 100;
const HASHTAG_TWEET_FETCH_COUNT = 100;
const TWEET_REPLY_MAX_DEPTH = 0;

/**
  Terms:
    Timeline - A users twitter feed.
    Hashtag - Results of a search for a particular hashtag.
*/

class Timeline {
  constructor (twitter, cfg_timelines, cfg_hashtags) {
    this.twitter = twitter;
    this._t_intervalID = null;
    this._h_intervalID = null;
    this._empty_intervalID = null;
    this._timelines = [] // {twitter_id:string, room:[string]}
    this._hashtags = [] // {hashtag:string, room:[string]}
    this._newtags = new Set();
    this._empty_rooms = new Set();
    this._h = -1;
    this._t = -1;
    this.config = {
      timelines: cfg_timelines,
      hashtags: cfg_hashtags
    }
  }

  /**
   * Do a sync every EMPTY_ROOM_INTERVAL to get the list of members to a room.
   * If a room has no 'real' members then drop/ignore it.
   * If a room has 'real' members then keep/ignore it.
   */
  start_empty_room_checker () {
    this._empty_intervalID = setInterval(() => {
      Promise.coroutine(this._check_empty_rooms.bind(this))()
    }, EMPTY_ROOM_INTERVAL);
  }

  stop_empty_room_checker () {
    if (this._empty_intervalID) {
      clearInterval(this._empty_intervalID);
      this._empty_intervalID = null;
    } else {
      throw Error("Timer not started");
    }
  }

  /**
   * Start the timeline timer so that timelines will be processed in turn.
   */
  start_timeline () {
    this._t_intervalID = setInterval(() => {
      Promise.coroutine(this._process_timeline.bind(this))();
    }, TIMELINE_POLL_INTERVAL);
  }

  /**
   * Stop the timeline timer. No more timelines will be processed.
   */
  stop_timeline () {
    if (this._t_intervalID) {
      clearInterval(this._t_intervalID);
      this._t_intervalID = null;
    } else {
      throw Error("Timer not started");
    }
  }

  /**
   * Start the hashtag timer so that hashtags are processed in turn.
   */
  start_hashtag () {
    this._h_intervalID = setInterval(() => {
      Promise.coroutine(this._process_hashtag.bind(this))();
    }, HASHTAG_POLL_INTERVAL);
  }

  /**
   * Stop the hashtag timer so that hashtags are no longer processed.
   */
  stop_hashtag () {
    if (this._h_intervalID) {
      clearInterval(this._h_intervalID);
      this._h_intervalID = null;
    } else {
      throw Error("Timer not started");
    }
  }

  /**
   * Add a Twitter hashtag to the hashtag processor. Tweets will be
   * automatically send to the given room.
   *
   * @param  {string} hashtag The twitter ID of a timeline. (without the #)
   * @param  {string} room_id The room_id to insert tweets into.
   * @param  {object} opts Options
   * @param  {boolean} opts.is_new Is the room 'new', and we shouldn't do a full poll.
   * @return {boolean} was the hashtag added/changed
   */
  add_hashtag (hashtag, room_id, opts) {
    if (this.config.hashtags.enable === false) {
      return false;
    }
    if (!Util.isRoomId(room_id)) {
      throw Error("Not a valid room_id");
    }
    if(!Util.isTwitterHashtag(hashtag)) {
      throw Error("Not a valid hashtag");
    }
    const htag = this._find_hashtag(hashtag);
    let obj;


    if(opts === undefined) {
      opts = {};
    }

    if(opts.is_new === undefined) {
      opts.is_new = false;
    }

    if(htag !== -1) {
      obj = this._hashtags[htag]
    }
    else {
      obj = {hashtag, room: new Set() }
      if(opts.is_new) {
        this._newtags.add("#"+hashtag);
      }
    }
    obj.room.add(room_id);
    if(htag !== -1) {
      this._hashtags[htag] = obj;
    }
    else {
      this._hashtags.push(obj);
    }
    log.info("Added Hashtag: %s", hashtag);
    return true;
  }

  /**
   * Add a Twitters user's timeline to the timeline processor. Tweets will be
   * automatically send to the given room.
   *
   * HTM* - Use a single account to send tweets, avoiding large numbers of join
   * events. This is enabled automatically unless disabled via config
   *
   * @param  {string} twitter_id The twitter ID of a timeline.
   * @param  {string} room_id The room_id to insert tweets into.
   * @param  {object} opts Options
   * @param  {boolean} opts.is_new Is the room 'new', and we shouldn't do a full poll.
   * @param  {boolean} opts.exclude_replies Should we not fetch replies.
   * @param  {boolean} opts.high_traffic_mode Enable high traffic mode on the timeline*.
   * @return {boolean} was the hashtag added/changed
  */
  add_timeline (twitter_id, room_id, opts) {
    if (this.config.timelines.enable === false) {
      return false;
    }
    if (!Util.isRoomId(room_id)) {
      throw Error("Not a valid room_id");
    }
    const tline = this._find_timeline(twitter_id);
    let obj;

    if(opts === undefined) {
      opts = {};
    }

    if(opts.is_new === undefined) {
      opts.is_new = false;
    }

    if(opts.exclude_replies === undefined) {
      opts.exclude_replies = false;
    }

    if(opts.high_traffic_mode === undefined) {
      opts.high_traffic_mode = false;
    }

    if(tline !== -1) {
      obj = this._timelines[tline]
    }
    else {
      obj = {
        twitter_id,
        room: new Set(),
        exclude_replies: opts.exclude_replies,
        high_traffic_mode: opts.high_traffic_mode
      }
      if(opts.is_new) {
        this._newtags.add(twitter_id);
      }
    }
    obj.room.add(room_id);
    if(tline !== -1) {
      this._timelines[tline] = obj;
    }
    else {
      this._timelines.push(obj);
    }
    log.info("Added Timeline: %s", twitter_id);
    return true;
  }

  /**
   * remove_timeline - Remove a timeline from being
   * processed.
   *
   * @param  {string} twitter_id The twitter id of the timeline to remove.
   * @param  {string} [room_id] If specified, only remove from this room.
   * @return {boolean} Was the operation successful.
   */
  remove_timeline (twitter_id, room_id) {
    return this._remove_from_queue(true, twitter_id, room_id);
  }

  /**
   * remove_timeline - Remove a hashtag from being
   * processed.
   *
   * @param  {string} hashtag The hashtag to remove. (without the #)
   * @param  {string} [room_id] If specified, only remove from this room.
   * @return {boolean} Was the operation successful.
   */
  remove_hashtag (hashtag, room_id) {
    return this._remove_from_queue(false, hashtag, room_id);
  }

  _remove_from_queue (isTimeline, id, room_id) {
    const i = isTimeline ? this._find_timeline(id) : this._find_hashtag(id);
    const queue = isTimeline ? this._timelines : this._hashtags;
    if(i !== -1) {
      if(room_id) {
        if (queue[i].room.has(room_id)) {
          queue[i].room.delete(room_id);
        }
        else{
          log.warn("Tried to remove %s for %s but it didn't exist", room_id, id);
          return true; // Well, the room doesn't exist
        }
      }
      else {
        queue[i].room.clear();
      }
      if(queue[i].room.size === 0) {
        queue.splice(i, 1);
      }

      if(isTimeline) {
        this._timelines = queue;
      }
      else{
        this._hashtags = queue;
      }
      return true;
    }
    else {
      log.warn("Tried to remove %s but it doesn't exist", id);
      return false;
    }
  }

  is_room_excluded (rooms, id) {
    if (!this.config.timelines.poll_if_empty) {
      const difference = new Set([...rooms].filter(x => !this._empty_rooms.has(x)));
      if (difference.size === 0) {
        log.info("Timeline", "Skipping %s because no real users are using it.", id);
        return true;
      }
    }
    return false;
  }

  * _process_timeline () {
    if (this._timelines.length === 0) {
      return;
    }
    // Rotate to the next timeline.
    this._t++;
    if(this._t >= this._timelines.length) {
      this._t = 0;
    }

    const tline = this._timelines[this._t];
    if(this.is_room_excluded(tline.room, tline.twitter_id)) {
      return;
    }

    const client = yield this.twitter.client_factory.get_client();
    const req = {
      user_id: tline.twitter_id,
      count: TIMELINE_TWEET_FETCH_COUNT,
      exclude_replies: tline.exclude_replies,
      tweet_mode: "extended" // https://github.com/Half-Shot/matrix-appservice-twitter/issues/31
    };

    if(this._newtags.has(req.user_id)) {
      req.count = 1;
      this._newtags.delete(req.user_id);
    }

    const since = yield this.twitter.storage.get_since("@"+tline.twitter_id);
    if (since) {
      req.since_id = since;
    }
    let feed;
    try {
      feed = yield client.get('statuses/user_timeline', req);
    }
    catch (error) {
      log.error("Timeline", "_process_timeline: GET /statuses/user_timeline returned: %s", error.code);
      return;
    }
    if (feed.length === 0) {
      return;
    }
    else if(feed.length === TIMELINE_TWEET_FETCH_COUNT) {
      log.info("Timeline", "Poll request hit count limit. Request likely incomplete.");
    }

    const s = feed[0].id_str;
    this.twitter.storage.set_since("@"+tline.twitter_id, s);
    // If req.count = 1, the resp will be the initial tweet used to get initial "since"
    if (req.count !== 1) {
      try {
        yield this.twitter.processor.process_tweets(tline.room, feed, {depth: TWEET_REPLY_MAX_DEPTH} );
      }
      catch(err) {
        log.error("Timeline", "Error whilst processing timeline %s: %s", tline.twitter_id, err);
      }
    }
    return;
  }

  * _process_hashtag () {
    if (this._hashtags.length === 0) {
      return;
    }
    this._h++;
    if(this._h >= this._hashtags.length) {
      this._h = 0;
    }

    const client = yield this.twitter.client_factory.get_client();
    const feed = this._hashtags[this._h];
    if(this.is_room_excluded(feed.room, feed.hashtag)) {
      return;
    }

    const req = {
      q: "%23"+feed.hashtag,
      result_type: 'recent',
      count: HASHTAG_TWEET_FETCH_COUNT,
      tweet_mode: "extended" // https://github.com/Half-Shot/matrix-appservice-twitter/issues/31
    };

    if(this._newtags.has("#"+feed.hashtag)) {
      req.count = 1;
      this._newtags.delete("#"+feed.hashtag);
    }

    const since = yield this.twitter.storage.get_since(feed.hashtag);
    if (since) {
      req.since_id = since;
    }
    let results;
    try {
      results = yield client.get('search/tweets', req);
    }
    catch (error) {
      log.error("Timeline", "_process_hashtags: GET /search/tweets returned: %s", error.code);
      return;
    }
    if (results.statuses.length === 0) {
      return;
    }
    else if(results.statuses.length === HASHTAG_TWEET_FETCH_COUNT) {
      log.info("Timeline", "Poll request hit count limit. Request likely incomplete.");
    }
    const s = results.statuses[0].id_str;
    this.twitter.storage.set_since(feed.hashtag, s);
    // If req.count = 1, the resp will be the initial tweet used to get initial "since"
    if (req.count !== 1) {
      try {
        yield this.twitter.processor.process_tweets(feed.room, results.statuses, {depth: 0, force_user_id});
      }
      catch(err) {
        log.error("Timeline", "Error whilst processing hashtag feed %s: %s", feed.hashtag, err);
      }
    }
  }

  * _check_empty_rooms () {
    const bot = this.twitter.bridge.getBot();
    const memberLists = yield bot.getMemberLists();
    for (const room in memberLists) {
      if (memberLists[room].realJoinedUsers.length === 0) {
        log.silly("Timeline", "%s has no real users", room);
        this._empty_rooms.add(room);
      } else {
        this._empty_rooms.delete(room);
      }
    }
  }

  _find_timeline (twitter_id) {
    return this._timelines.findIndex((tline) =>
    {
      return tline.twitter_id === twitter_id;
    });
  }

  _find_hashtag (hashtag) {
    return this._hashtags.findIndex((item) =>
    {
      return item.hashtag === hashtag;
    });
  }

}

module.exports = Timeline;
