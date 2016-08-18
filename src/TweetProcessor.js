var util = require("./util.js");
var log = require('npmlog');
var HTMLDecoder = new require('html-entities').AllHtmlEntities;
var ProcessedTweetList = require("./ProcessedTweetList.js");


const TWITTER_MSG_QUEUE_INTERVAL_MS = 750;
const TWITTER_LOOKUP_INTERVAL = 60000;
const MSG_QUEUE_LAGGING_THRESHOLD = 50; // The number of messages to be stored in the msg queue before we complain about lag.

var TweetProcessor = function (opts) {
  this._tclient = opts.client;
  this._bridge = opts.bridge;
  this._storage = opts.storage;
  this.media_cfg = opts.media;
  this.process_pool = []; //{roomid,tweet,depth}
  this.msg_queue = [];
  this.tweetids_to_lookup = [];
  this.lookup_tweets = [];
  this.msg_queue_intervalID = null;
  this.processed_tweets = new ProcessedTweetList(256, 32);  //This will contain all the tweet IDs of things we don't want to repeat.
}

TweetProcessor.prototype.push_processed_tweet = function (roomid, status) {
  this.processed_tweets.push(roomid, status);
}

TweetProcessor.prototype.start = function () {
  if(this._msg_queue_intervalID != null) {
    log.warn("TweetProcessor", "Attempted to call start() while already running.");
  }
  this._msg_queue_intervalID = 0;
  this._msg_queue_intervalID = setInterval(() => {
    this._process_head_of_msg_queue();
  }, TWITTER_MSG_QUEUE_INTERVAL_MS);
}

//Runs every TWITTER_MSG_QUEUE_INTERVAL_MS to help not overflow the HS.
TweetProcessor.prototype._process_head_of_msg_queue = function () {
  if(this.msg_queue.length > 0) {
    if(this.msg_queue.length >= MSG_QUEUE_LAGGING_THRESHOLD) {
      log.warn("TweetProcessor", "Message queue has a large number of unsent events. %s (warn at:%s) ",
       this.msg_queue.length,
       MSG_QUEUE_LAGGING_THRESHOLD
      );
    }
    var msgs = this.msg_queue.pop();
    var promises = [];
    for(var msg of msgs) {
      // var intent = this._bridge.getIntent(msg.userId);
      // promises.push(intent.sendEvent(msg.roomId, msg.type, msg.content).catch(reason =>{
      //   log.error("TwitterProcessor", "Failed send tweet to room: %s", reason);
      // }));
      log.info("TweetProcessor", "Msg: " + msg.content);
    }
    Promise.all(promises);
  }
}

/**
 * MatrixTwitter.prototype.tweet_to_matrix_content - This function will fill
 * the content structure for a new matrix message for a given tweet.
 *
 * @param  {TwitterTweet} tweet The tweet object from the Twitter API See {@link}
 * @param  {type} type  The 'msgtype' of a message.
 * @return {object}     The content of a Matrix 'm.room.message' event.
 *
 * @see {@link https://dev.twitter.com/overview/api/tweets}
 */
TweetProcessor.prototype.tweet_to_matrix_content = function (tweet, type) {
  return {
    "body": new HTMLDecoder().decode(tweet.text),
    "created_at": tweet.created_at,
    "likes": tweet.favorite_count,
    "reblogs": tweet.retweet_count,
    "tweet_id": tweet.id_str,
    "tags": tweet.entities.hashtags,
    "msgtype": type
  }
}

TweetProcessor.prototype._push_to_msg_queue = function (muser, roomid, tweet, type) {
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
      if(media.type != 'photo') {
        continue;
      }
      media_promises.push(
        util.uploadContentFromUrl(
          this._bridge,
          media.media_url_https,
          this._bridge.getIntentFromLocalpart("twitter_" + tweet.id_str)
        ).then( (mxc_url) => {
          return {
            userId: muser,
            roomId: roomid,
            time: time,
            type: "m.room.message",
            content: {
              body: media.display_url,
              msgtype: "m.image",
              url: mxc_url
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

TweetProcessor.prototype.process_tweets = function (roomid, tweets, depth, client = null) {
  if (client == null) {
    client = this._tclient;
  }
  tweets.forEach( (tweet) => {
    this._process_tweet(roomid, tweet, depth);
  });

}

TweetProcessor.prototype.process_tweet = function (roomid, tweet, depth, client = null) {
  if (client == null) {
    client = this._tclient
  }
  this._process_tweet(roomid, tweet, depth, client);
}

/**
 * TweetProcessor.prototype._process_tweet - Process a given tweet (including
 * resolving any parent tweets), and submit it to the given room. This function
 * is recursive, limited to the depth set.
 *
 * @param  {String} roomid Matrix Room ID of the room that we are processing.
 * @param  {TwitterTweet} tweet The tweet object from the Twitter API See {@link}
 * @param  {Number} depth  The maximum depth of the tweet chain (replies to
 * replies) to be traversed. Set this to how deep you wish to traverse and it
 * will be decreased when the function calls itself.
 * @return {Promise[]]}  A promise that resolves once the tweet has been queued.
 *
 * @see {@link https://dev.twitter.com/overview/api/tweets}
 */
TweetProcessor.prototype._process_tweet = function (roomid, tweet, depth, client) {
  depth--;
  var type = "m.text";
  if (tweet.in_reply_to_status_id_str != null) {
    type = "m.notice"; // A nicer way to show previous tweets
  }
  return new Promise( (resolve) => {
    if (tweet.in_reply_to_status_id_str != null && depth > 0) {
      client.get(
        'statuses/show/' + tweet.in_reply_to_status_id_str, {}, (error, newtweet) => {
          if (!error) {
            return this._process_tweet(roomid, newtweet, depth);
          }
          else
          {
            log.error("TweetProcessor", "process_tweet: GET /statuses/show returned: " + error[0].message);
            reject();
          }
        });
    }
    else {
      resolve();
    }
  }).then(() => {
    this._update_user_timeline_profile(tweet.user);
    if(this.processed_tweets.contains(roomid, tweet.text)) {
      log.info("TweetProcessor", "Repeated tweet detected, not processing");
      return;
    }

    this.processed_tweets.push(roomid, tweet.text);
    this._push_to_msg_queue('@twitter_'+tweet.user.id_str + ':' + this._bridge.opts.domain, roomid, tweet, type);
    return;
  });
}


module.exports = {
  TweetProcessor: TweetProcessor
}
