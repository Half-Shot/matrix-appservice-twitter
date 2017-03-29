const log = require('./logging.js');
const mime = require('mime-types')
const HTMLDecoder = new require('html-entities').AllHtmlEntities;

const util = require("./util.js");
const Promise = require('bluebird');

const TWITTER_MSG_QUEUE_INTERVAL_MS = 150;
const MSG_QUEUE_LAGGING_THRESHOLD = 50; // The number of messages to be stored in the msg queue before we complain about lag.
const DEFAULT_TWEET_DEPTH = 1;

class TweetProcessor {
  constructor (opts) {
    this._tclient = opts.client;
    this._twitter = opts.twitter;
    this._bridge = opts.bridge;
    this._storage = opts.storage;
    this.media_cfg = opts.media;
    this.process_pool = []; //{roomid,tweet,depth}
    this.msg_queue = [];
    this.tweetids_to_lookup = [];
    this.lookup_tweets = [];
    this.msg_queue_intervalID = null;
  }


  start () {
    if(this._msg_queue_intervalID != null) {
      log.warn("Attempted to call start() while already running.");
      return;
    }
    this._msg_queue_intervalID = setInterval(() => {
      this._process_head_of_msg_queue();
    }, TWITTER_MSG_QUEUE_INTERVAL_MS);
  }

  stop () {
    if(this._msg_queue_intervalID != null) {
      log.warn("Attempted to call stop() while not running.");
      return;
    }
    clearInterval(this._msg_queue_intervalID);
  }

  //Runs every TWITTER_MSG_QUEUE_INTERVAL_MS to help not overflow the HS.
  _process_head_of_msg_queue () {
    const promises = [];
    if(this.msg_queue.length > 0) {
      log.silly("Messages in send queue: %s", this.msg_queue.length)
      if(this.msg_queue.length >= MSG_QUEUE_LAGGING_THRESHOLD) {
        log.warn("Message queue has a large number of unsent events. %s (warn at:%s) ",
         this.msg_queue.length,
         MSG_QUEUE_LAGGING_THRESHOLD
        );
      }
      const msgs = this.msg_queue.pop();
      for(const msg of msgs) {
        const intent = this._bridge.getIntentFromLocalpart(msg.userId);
        promises.push(intent.sendEvent(msg.roomId, msg.type, msg.content).then(res => {
          if (msg.content.msgtype === "m.text" ) {
            this._storage.add_event(res.event_id, msg.userId, msg.roomId, msg.content.tweet_id, Date.now());
          }
        }).catch(reason =>{
          log.error("Failed send tweet to room: %s", reason);
        }));
      }
    }
    return Promise.all(promises);
  }

  /**
   * This function will fill the content structure for a new matrix message for a given tweet.
   *
   * @param  {TwitterTweet} tweet The tweet object from the Twitter API See {@link}
   * @param  {Type} type  The 'msgtype' of a message.
   * @return {Object}     The content of a Matrix 'm.room.message' event.
   *
   * @see {@link https://dev.twitter.com/overview/api/tweets}
   */
  tweet_to_matrix_content (tweet, type, on_behalf_of) {
    let text = tweet.full_text || tweet.text;
    let tags = [];
    if (!tweet.entities) {
      tweet.entities = {}
    }
    if (!tweet.user) {
      throw Error("User field not found in tweet");
    }
    if (tweet.entities.urls) {
      text = this._tweet_expand_urls(text,  tweet.entities.urls );
    }
    if (tweet.entities.hashtags) {
      tags = tweet.entities.hashtags.map((hashtag) => {
        return hashtag.text;
      })
    }
    text = HTMLDecoder.decode(text);
    if (on_behalf_of) {
      text = `@${tweet.user.screen_name}: ${text}`;
    }

    const mxtweet = {
      "body": text,
      "created_at": tweet.created_at,
      "likes": tweet.favorite_count,
      "reblogs": tweet.retweet_count,
      "tweet_id": tweet.id_str,
      "tags": tags,
      "msgtype": type,
      "external_url": `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`
    }

    if (tweet._retweet_info) {
      mxtweet.retweet = tweet._retweet_info;
    }

    if (on_behalf_of) {
      mxtweet.on_behalf_of = on_behalf_of;
    }

    return mxtweet;
  }

  _tweet_expand_urls (text, urls) {
    let offset = 0;
    for(const url of urls) {
      const start = offset + url.indices[0];
      const end = offset + url.indices[1];
      text = text.substr(0, start) + url.expanded_url + text.substr(end);
      offset += url.expanded_url.length - (end-start);
    }
    return text;
  }

  _push_to_msg_queue (muser, roomid, tweet, type, on_behalf_of) {
    const time = Date.parse(tweet.created_at);
    let content;
    try {
      content = this.tweet_to_matrix_content(tweet, type, on_behalf_of);
    } catch (e) {
      return Promise.reject("Tweet was missing user field.", e);
    }
    const newmsg = {
      userId: muser,
      roomId: roomid,
      time: time,
      type: "m.room.message",
      content: content,
    };

    const media_promises = [];
    if(tweet.entities.hasOwnProperty("media") && this.media_cfg.enable_download) {
      for(const media of tweet.entities.media) {
        if(media.type !== 'photo') {
          continue;
        }
        const mimetype = mime.lookup(media.media_url_https);
        const media_info = {
          w: media.sizes.large.w,
          h: media.sizes.large.h,
          mimetype,
          size: 0

        }
        media_promises.push(
          util.uploadContentFromUrl(
            this._bridge,
            media.media_url_https
          ).then( (obj) => {
            media_info.size = obj.size;
            return {
              userId: muser,
              roomId: roomid,
              time: time,
              type: "m.room.message",
              content: {
                body: media.display_url,
                info: media_info,
                msgtype: "m.image",
                url: obj.mxc_url
              }
            }
          })
        );
      }
    }

    return Promise.all(media_promises).then(msgs =>{
      msgs.unshift(newmsg);
      for(const m in this.msg_queue) {
        if(newmsg.time > this.msg_queue[m].time) {
          this.msg_queue.splice(m, 0, msgs);
          return;
        }
      }

      this.msg_queue.push(msgs);
    }).catch(reason =>{
      log.error("Failed to submit tweet to queue, reason: %s", reason);
    });
  }


  /**
   * Simliar to process_tweet but returns a promise for when all tweets have
   * been sent. This function is intended to optimise the processing of
   * tweets in a given array.
   * @param  {String} rooms
   * @param  {TwitterTweet[]} tweets
   * @param  {Object} opts
   * @see this.process_tweet()
   */
  process_tweets (rooms, tweets, opts) {
    if (opts == null) {
      opts = { }
    }
    if (opts.client == null) {
      opts.client = this._tclient;
    }
    if (opts.depth == null) {
      opts.depth = DEFAULT_TWEET_DEPTH;
    }
    const promises = [];
    tweets.forEach( (tweet) => {
      promises.push(this._process_tweet(rooms, tweet, opts.depth, opts));
    });
    return Promise.all(promises);
  }

  /**
   * Process a given tweet (including esolving any parent tweets),
   * and submit it to the given room. This function is recursive,
   * limited to the depth set.
   *
   * @param  {String} rooms Matrix Room ID of the room that we are processing.
   * @param  {TwitterTweet} tweet The tweet object from the Twitter API See {@link}
   * @param  {Object} opts Options for the processor.
   * @param  {Number} opts.depth The maximum depth of the tweet chain (replies to
   * replies) to be traversed. Set this to how deep you wish to traverse and it
   * will be decreased when the function calls itself.
   * @param  {TwitterClient} opts.client = null The twitter authed client to use.
   * @param  {String} opts.force_user_id Should we force one account to post for the tweet.
   * @return {Promise}  A promise that resolves once the tweet has been queued.
   *
   * @see {@link https://dev.twitter.com/overview/api/tweets}
   */
   */
  process_tweet (rooms, tweet, opts) {
    if (opts == null) {
      opts = { }
    }
    if (opts.client == null) {
      opts.client = this._tclient;
    }
    if (opts.depth == null) {
      opts.depth = DEFAULT_TWEET_DEPTH;
    }
    return this._process_tweet(rooms, tweet, opts.depth, opts);
  }

  /**
   * @see this.process_tweet()
   */
  _process_tweet (rooms, tweet, depth, opts) {
    depth--;
    const type = "m.text";
    let promise;
    if (tweet.in_reply_to_status_id_str != null && depth > 0) {
      promise = opts.client.get('statuses/show/' + tweet.in_reply_to_status_id_str, {})
      .then((newtweet) => {
        return this._process_tweet(rooms, newtweet, depth, opts);
      }).catch(error => {
        log.error("process_tweet: GET /statuses/show returned: " + error);
        throw error;
      });
    }
    else {
      promise = Promise.resolve();
    }

    promise = promise.then(() => { return this._twitter.profile.update(tweet.user); });
    if (tweet.retweeted_status) {
      tweet.retweeted_status._retweet_info = { id: tweet.id_str, tweet: tweet.user.id_str };
      tweet = tweet.retweeted_status; // We always want the root tweet.
      promise = promise.then(() => { return this._twitter.profile.update(tweet.user) });
    }

    return promise.then( () => {
      if(typeof rooms == "string") {
        rooms = [rooms];
      }
      rooms.forEach((roomid) => {
        this._storage.room_has_tweet(roomid, tweet.id_str).then(
          (room_has_tweet) => {
            if (!room_has_tweet) {
              const realUserId = '_twitter_'+tweet.user.id_str;
              const userId = opts.force_user_id == null ? realUserId : opts.force_user_id
              this._push_to_msg_queue(
                userId, roomid, tweet, type, opts.force_user_id != null ? realUserId : null
              );
            }
          }
        );
      });
    });
  }
}

module.exports = TweetProcessor;
