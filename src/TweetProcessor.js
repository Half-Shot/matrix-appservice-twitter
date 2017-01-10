const log = require('npmlog');
const mime = require('mime-types')
const HTMLDecoder = new require('html-entities').AllHtmlEntities;

const util = require("./util.js");
const Promise = require('bluebird');

const TWITTER_MSG_QUEUE_INTERVAL_MS = 150;
const MSG_QUEUE_LAGGING_THRESHOLD = 50; // The number of messages to be stored in the msg queue before we complain about lag.

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
      log.warn("TweetProcessor", "Attempted to call start() while already running.");
    }
    this._msg_queue_intervalID = setInterval(() => {
      this._process_head_of_msg_queue();
    }, TWITTER_MSG_QUEUE_INTERVAL_MS);
  }

  //Runs every TWITTER_MSG_QUEUE_INTERVAL_MS to help not overflow the HS.
  _process_head_of_msg_queue () {
    if(this.msg_queue.length > 0) {
      log.silly("TweetProcessor", "Messages in send queue: %s", this.msg_queue.length)
      if(this.msg_queue.length >= MSG_QUEUE_LAGGING_THRESHOLD) {
        log.warn("TweetProcessor", "Message queue has a large number of unsent events. %s (warn at:%s) ",
         this.msg_queue.length,
         MSG_QUEUE_LAGGING_THRESHOLD
        );
      }
      var msgs = this.msg_queue.pop();
      var promises = [];
      for(const msg of msgs) {
        var intent = this._bridge.getIntent(msg.userId);
        promises.push(intent.sendEvent(msg.roomId, msg.type, msg.content).then(res => {
          if (msg.content.msgtype === "m.text" ) {
            this._storage.add_event(res.event_id, msg.userId, msg.roomId, msg.content.tweet_id, Date.now());
          }
        }).catch(reason =>{
          log.error("TwitterProcessor", "Failed send tweet to room: %s", reason);
        }));
      }
      return Promise.all(promises);
    }
    return Promise.resolve();
  }

  /**
   * This function will fill the content structure for a new matrix message for a given tweet.
   *
   * @param  {TwitterTweet} tweet The tweet object from the Twitter API See {@link}
   * @param  {type} type  The 'msgtype' of a message.
   * @return {object}     The content of a Matrix 'm.room.message' event.
   *
   * @see {@link https://dev.twitter.com/overview/api/tweets}
   */
  tweet_to_matrix_content (tweet, type) {
    const mxtweet = {
      "body": new HTMLDecoder().decode(tweet.full_text || tweet.text),
      "created_at": tweet.created_at,
      "likes": tweet.favorite_count,
      "reblogs": tweet.retweet_count,
      "tweet_id": tweet.id_str,
      "tags": tweet.entities.hashtags,
      "msgtype": type,
      "external_url": `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`
    }

    if (tweet._retweet_info) {
      mxtweet.retweet = tweet._retweet_info;
    }

    // URLs
    let offset = 0;
    for(const url of tweet.entities.urls) {
      let text = mxtweet.body;
      text = text.substr(0, offset+ url.indices[0]) + url.expanded_url + text.substr(url.indices[1]);
      offset += url.expanded_url.length - (url.indices[1] - url.indices[0]);
      mxtweet.body = text;
    }

    return mxtweet;
  }

  _push_to_msg_queue (muser, roomid, tweet, type) {
    var time = Date.parse(tweet.created_at);
    var newmsg = {
      userId: muser,
      roomId: roomid,
      time: time,
      type: "m.room.message",
      content: this.tweet_to_matrix_content(tweet, type)
    };

    var media_promises = [];
    if(tweet.entities.hasOwnProperty("media") && this.media_cfg.enable_download) {
      for(var media of tweet.entities.media) {
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
            media.media_url_https,
            this._bridge.getIntent(muser)
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
      for(var m in this.msg_queue) {
        if(newmsg.time > this.msg_queue[m].time) {
          this.msg_queue.splice(m, 0, msgs);
          return;
        }
      }

      this.msg_queue.push(msgs);
    }).catch(reason =>{
      log.error("TweetProcessor", "Failed to submit tweet to queue, reason: %s", reason);
    });
  }


  /**
   * A function used to process
   *
   * @param  {type} roomid        description
   * @param  {type} tweets        description
   * @param  {type} depth         description
   * @param  {type} client = null description
   * @return {type}               description
   */
  process_tweets (rooms, tweets, depth, client = null) {
    if (client == null) {
      client = this._tclient;
    }
    tweets.forEach( (tweet) => {
      this._process_tweet(rooms, tweet, depth, client);
    });

  }

  process_tweet (rooms, tweet, depth, client = null) {
    if (client == null) {
      client = this._tclient;
    }
    this._process_tweet(rooms, tweet, depth, client);
  }

  /**
   * TweetProcessor.prototype._process_tweet - Process a given tweet (including
   * resolving any parent tweets), and submit it to the given room. This function
   * is recursive, limited to the depth set.
   *
   * @param  {String} rooms Matrix Room ID of the room that we are processing.
   * @param  {TwitterTweet} tweet The tweet object from the Twitter API See {@link}
   * @param  {Number} depth  The maximum depth of the tweet chain (replies to
   * replies) to be traversed. Set this to how deep you wish to traverse and it
   * will be decreased when the function calls itself.
   * @return {Promise[]]}  A promise that resolves once the tweet has been queued.
   *
   * @see {@link https://dev.twitter.com/overview/api/tweets}
   */
  _process_tweet (rooms, tweet, depth, client) {
    depth--;
    var type = "m.text";
    var promise;
    if (tweet.in_reply_to_status_id_str != null && depth > 0) {
      promise = client.getAsync('statuses/show/' + tweet.in_reply_to_status_id_str, {})
      .then((newtweet) => {
        return this._process_tweet(rooms, newtweet, depth, client);
      }).catch(error => {
        log.error("TweetProcessor", "process_tweet: GET /statuses/show returned: " + error);
        throw error;
      });
    }
    else {
      promise = Promise.resolve();
    }

    this._twitter.update_profile(tweet.user);
    if(tweet.retweeted_status) {
      tweet.retweeted_status._retweet_info = { id: tweet.id_str, tweet: tweet.user.id_str };
      tweet = tweet.retweeted_status; // We always want the root tweet.
      this._twitter.update_profile(tweet.user);
    }

    promise.then( () => {
      if(typeof rooms == "string") {
        rooms = [rooms];
      }
      rooms.forEach((roomid) => {
        this._storage.room_has_tweet(roomid, tweet.id_str).then(
          (room_has_tweet) => {
            if (!room_has_tweet) {
              this._push_to_msg_queue(
                '@_twitter_'+tweet.user.id_str + ':' + this._bridge.opts.domain, roomid, tweet, type
              );
            }
          }
        );
      });
    });
    return promise;
  }
}

module.exports = TweetProcessor;
