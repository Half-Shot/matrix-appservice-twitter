const log      = require('../logging.js');
const Promise  = require('bluebird');

const TIMELINE_POLL_INTERVAL_MS = 3010; //Twitter allows 300 calls per 15 minute (We add 10 milliseconds for a little safety).
const HASHTAG_POLL_INTERVAL_MS = 2010; //Twitter allows 450 calls per 15 minute (We add 10 milliseconds for a little safety).
const EMPTY_ROOM_INTERVAL_MS = 30000;
const TIMELINE_TWEET_FETCH_COUNT = 100;
const HASHTAG_TWEET_FETCH_COUNT = 100;
const RATE_LIMIT_WAIT_MS = 15000; // If the bridge hits a rate limit, how long should it wait before it tries again.
const TWEET_REPLY_MAX_DEPTH = 0;
const NEW_PROFILE_THRESHOLD_MIN = 15; // Max number of new profiles that can be made per minute.

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
    this._hashtagIndex = -1;
    this._timelineIndex = -1;
    this.config = {
      timelines: cfg_timelines,
      hashtags: cfg_hashtags
    }
  }

  /**
   * Do a sync every EMPTY_ROOM_INTERVAL_MS to get the list of members to a room.
   * If a room has no 'real' members then drop/ignore it.
   * If a room has 'real' members then keep/ignore it.
   */
  start_empty_room_checker () {
    this._empty_intervalID = setInterval(() => {
      Promise.coroutine(this._check_empty_rooms.bind(this))()
    }, EMPTY_ROOM_INTERVAL_MS);
  }

  stop_empty_room_checker () {
    if (this._empty_intervalID) {
      clearInterval(this._empty_intervalID);
      this._empty_intervalID = null;
    } else {
      throw Error("Empty Room timer not started");
    }
  }

  /**
   * Start the timeline timer so that timelines will be processed in turn.
   */
  start_timeline () {
    this._t_intervalID = setInterval(() => {
      Promise.coroutine(this._process_feed.bind(this))(true);
    }, TIMELINE_POLL_INTERVAL_MS);
  }

  /**
   * Stop the timeline timer. No more timelines will be processed.
   */
  stop_timeline () {
    if (this._t_intervalID) {
      clearInterval(this._t_intervalID);
      this._t_intervalID = null;
    } else {
      throw Error("Timeline timer not started");
    }
  }

  /**
   * Start the hashtag timer so that hashtags are processed in turn.
   */
  start_hashtag () {
    this._h_intervalID = setInterval(() => {
      Promise.coroutine(this._process_feed.bind(this))(false);
    }, HASHTAG_POLL_INTERVAL_MS);
  }

  /**
   * Stop the hashtag timer so that hashtags are no longer processed.
   */
  stop_hashtag () {
    if (this._h_intervalID) {
      clearInterval(this._h_intervalID);
      this._h_intervalID = null;
    } else {
      throw Error("Hashtag timer not started");
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
    const hashtagIndex = this._find_hashtag(hashtag);
    let hashtagObj;

    if(opts === undefined) {
      opts = {};
    }

    if(opts.is_new === undefined) {
      opts.is_new = false;
    }

    if(hashtagIndex !== -1) {
      hashtagObj = this._hashtags[hashtagIndex]
    }
    else {
      hashtagObj = {hashtag, room: new Set() }
      if(opts.is_new) {
        this._newtags.add("#" + hashtag);
      }
    }
    hashtagObj.room.add(room_id);
    if(hashtagIndex !== -1) {
      this._hashtags[hashtagIndex] = hashtagObj;
    }
    else {
      this._hashtags.push(hashtagObj);
    }
    log.info("Added Hashtag: %s", hashtag);
    return true;
  }

  /**
   * Add a Twitters user's timeline to the timeline processor. Tweets will be
   * automatically send to the given room.
   *
   * @param  {string} twitter_id The twitter ID of a timeline.
   * @param  {string} room_id The room_id to insert tweets into.
   * @param  {object} opts Options
   * @param  {boolean} opts.is_new Is the room 'new', and we shouldn't do a full poll.
   * @param  {boolean} opts.exclude_replies Should we not fetch replies.
   * @return {boolean} was the hashtag added/changed
  */
  add_timeline (twitter_id, room_id, opts) {
    if (this.config.timelines.enable === false) {
      return false;
    }
    const timelineIndex = this._find_timeline(twitter_id);
    let timeline;

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

    if(timelineIndex !== -1) {
      timeline = this._timelines[timelineIndex]
    }
    else {
      timeline = {
        twitter_id,
        room: new Set(),
        exclude_replies: opts.exclude_replies
      }
      if(opts.is_new) {
        this._newtags.add(twitter_id);
      }
    }
    timeline.room.add(room_id);
    if(timelineIndex !== -1) {
      this._timelines[timelineIndex] = timeline;
    }
    else {
      this._timelines.push(timeline);
    }
    log.info("Added Timeline: %s", twitter_id);
    return true;
  }

  /**
   * remove_timeline - Remove a timeline from being
   * processed.
   *
   * @param  {string} twitterId The twitter id of the timeline to remove.
   * @param  {string} [roomId] If specified, only remove from this room.
   * @return {boolean} Was the operation successful.
   */
  remove_timeline (twitterId, roomId) {
    return this._removeFromQueue(true, twitterId, roomId);
  }

  /**
   * remove_timeline - Remove a hashtag from being
   * processed.
   *
   * @param  {string} hashtag The hashtag to remove. (without the #)
   * @param  {string} [roomId] If specified, only remove from this room.
   * @return {boolean} Was the operation successful.
   */
  remove_hashtag (hashtag, roomId) {
    return this._removeFromQueue(false, hashtag, roomId);
  }

  _removeFromQueue (isTimeline, id, roomId) {
    // Get the index of the item and it's associated queue.
    const i = isTimeline ? this._find_timeline(id) : this._find_hashtag(id);
    const queue = isTimeline ? this._timelines : this._hashtags;
    const removeSingle = roomId !== undefined;
    if(i === -1) {
      log.warn("Tried to remove %s but it isn't queued.", id);
      return false;
    }
    if(removeSingle) {
      if (queue[i].room.has(roomId)) {
        queue[i].room.delete(roomId);
      }
      else{
        log.warn("Tried to remove %s for %s but it didn't exist", roomId, id);
        return true; // Well, the room doesn't exist
      }
    }
    else {
      // Remove the whole timeline.
      queue[i].room.clear();
    }

    // Are any rooms being processed at this point. Remove if not.
    if(queue[i].room.size === 0) {
      queue.splice(i, 1);
    }

    if(isTimeline) {
      this._timelines = queue;
    }
    else{
      this._hashtags = queue;
    }
    return true
  }

  is_room_excluded (rooms) {
    if (!this.config.timelines.poll_if_empty) {
      const difference = new Set([...rooms].filter(x => !this._empty_rooms.has(x)));
      if (difference.size === 0) {
        return true;
      }
    }
    return false;
  }

  is_feed_exceeding_user_limit (tweets, isTimeline) {
    if((isTimeline ? this.config.timelines : this.config.hashtags).single_account_fallback) {
      return false;
    }

    const pollInterval = isTimeline ? TIMELINE_POLL_INTERVAL_MS : HASHTAG_POLL_INTERVAL_MS;
    // Rough time since we last polled this feed
    const currentPollInterval = (isTimeline ? this._timelines : this._hashtags).length * pollInterval;
    // Number of new profiles that we can accept in this timespan.
    const maxNProfiles = Math.ceil((currentPollInterval / 60000) * NEW_PROFILE_THRESHOLD_MIN);
    const userIds = new Set(tweets.map((tweet) => {tweet.id_str})).size;
    return userIds > maxNProfiles;
  }

  * _process_feed (isTimeline) {
    const req = {
      count: isTimeline ? TIMELINE_TWEET_FETCH_COUNT : HASHTAG_TWEET_FETCH_COUNT,
      tweet_mode: "extended" // https://github.com/Half-Shot/matrix-appservice-twitter/issues/31
    };
    const getPath = isTimeline ? 'statuses/user_timeline' : 'search/tweets';

    let feed;
    if(isTimeline) {
      if (this._timelines.length === 0) {
        return;
      }
      // Rotate to the next timeline.
      this._timelineIndex++;
      if(this._timelineIndex >= this._timelines.length) {
        this._timelineIndex = 0;
      }
      feed = this._timelines[this._timelineIndex];
    }
    else {
      if (this._hashtags.length === 0) {
        return;
      }
      this._hashtagIndex++;
      if(this._hashtagIndex >= this._hashtags.length) {
        this._hashtagIndex = 0;
      }
      feed = this._hashtags[this._hashtagIndex];
    }

    const client = yield this.twitter.client_factory.get_client();
    const sinceId = isTimeline ? "@" + feed.twitter_id : feed.hashtag;
    if(this.is_room_excluded(feed.room)) {
      log.info("Timeline", `${sinceId} is ignored because the room(s) contains no real members`);
      return;
    }
    if (isTimeline) {
      req.user_id = feed.twitter_id;
      req.exclude_replies = feed.exclude_replies;
      if(this._newtags.has(feed.twitter_id)) {
        req.count = 1;
        this._newtags.delete(feed.twitter_id);
      }
    } else {
      req.q = "%23" + feed.hashtag;
      req.result_type = 'recent';
      if(this._newtags.has("#" + feed.hashtag)) {
        req.count = 1;
        this._newtags.delete("#" + feed.hashtag);
      }
    }
    const since = yield this.twitter.storage.get_since(sinceId);
    if (since) {
      req.since_id = since;
    }
    let results;
    try {
      results = yield client.get(getPath, req);
      if(!isTimeline) {
        results = results.statuses;
      }
    }
    catch (err) {
      const error = Array.isArray(err) ? err[0] : err;
      if (error.code === 88) {
        log.warn("Timeline", `Bridge hit a rate limit on ${getPath}. Waiting ${RATE_LIMIT_WAIT_MS}ms`);
        // We hit a rate limit. Stop the correct timer for RATE_LIMIT_WAIT_MS
        if(isTimeline) {
          this.stop_timeline();
          setTimeout(() => {
            this.start_timeline();
          }, RATE_LIMIT_WAIT_MS);
        } else {
          this.stop_hashtag();
          setTimeout(() => {
            this.start_hashtag();
          }, RATE_LIMIT_WAIT_MS);
        }

      } else {
        log.error("Timeline", `_process_feed: GET ${getPath} returned: %s`, JSON.stringify(error));
      }

      return;
    }

    if (results.length === 0) {
      return;
    }
    else if(results.length === req.count) {
      log.info("Timeline", "Poll request hit count limit. Request likely incomplete.");
    }
    this.twitter.storage.set_since(sinceId, results[0].id_str);
    const shouldForceUserId = this.is_feed_exceeding_user_limit(results, isTimeline);
    let forceUserId = null;
    if(shouldForceUserId) {
      log.verbose("Timeline", `Forcing single user mode for ${sinceId}`);
      forceUserId = shouldForceUserId ? `_twitter_@` + feed.twitter_id : `_twitter_#` + feed.hashtag;
    }
    // If req.count = 1, the resp will be the initial tweet used to get initial "since"
    if (req.count !== 1) {
      try {
        return this.twitter.processor.process_tweets(feed.room, results, {depth: TWEET_REPLY_MAX_DEPTH, forceUserId});
      }
      catch(err) {
        log.error("Timeline", "Error whilst processing %s: %s", sinceId, err);
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
