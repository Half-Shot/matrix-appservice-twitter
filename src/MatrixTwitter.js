var Twitter = require('twitter');
var Request = require('request');
var fs = require('fs');
var log = require('npmlog');
var Buffer = require('buffer').Buffer;
var HTMLDecoder = new require('html-entities').AllHtmlEntities;
var MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;

var ProcessedTweetList = require("./ProcessedTweetList.js");
var util = require("./util.js");

const TWITTER_CLIENT_INTERVAL_MS    = 60000;
const TWITTER_MSG_QUEUE_INTERVAL_MS = 1500;
const TIMELINE_POLL_INTERVAL = 3050; //Twitter allows 300 calls per 15 minute (We add 50 milliseconds for a little safety).
const HASHTAG_POLL_INTERVAL = 3050; //Twitter allows 450 calls per 15 minute (We add 50 milliseconds for a little safety).
const TWEET_REPLY_MAX_DEPTH = 3;
const TIMELINE_TWEET_FETCH_COUNT = 100;


/**
 * MatrixTwitter - This class handles the connections between the Twitter API
 * and the bridge.
 * @class
 * @param  {matrix-appservice-bridge.Bridge} bridge
 * @param  config. Bridge configuration (currently only make use of the auth
*  information)
 * @param  config.app_auth.consumer_key Twitter consumer key
 * @param  config.app_auth.consumer_secret Twitter consumer secret
 * @param  {TwitterDB}       storage
 */
var MatrixTwitter = function (bridge, config, storage) {
  this.app_auth = config.app_auth;
  this.app_twitter = null;
  this._app_twitter_promise = null;
  this.tclients = new Map(); // {'@userid':TwitterClient}
  this.storage = storage;

  this.timeline_queue = [];
  this.timeline_intervalID = null;

  this.hashtag_intervalID = null;
  this.hashtag_queue = [];

  this.user_streams = new Map(); // {'@userid':TwitterStream}

  this.processed_tweets = new ProcessedTweetList(256, 32);  //This will contain all the tweet IDs of things we don't want to repeat.
  this.sent_dms = new ProcessedTweetList(1, 1);  //This will contain the body of the DM posted to a room to avoid reposting it.
  this.msg_queue = [];
  this.msg_queue_intervalID = null;
  this._bridge = bridge;
};


/**
 * MatrixTwitter.prototype.start - Starts the timers for polling the API and
 * authenticates the application with Twitter.
 * @function
 * @return {Promise}  A promise that returns when authentication succeeds.
 */
MatrixTwitter.prototype.start = function () {
  if(this._app_twitter_promise != null) {
    log.warn("Twitter",  "Attempted to call start() while having been started previously.");
    return this._app_twitter_promise;
  }

  this._app_twitter_promise = this._get_bearer_token().then((token) => {
    this.app_auth.bearer_token = token;
    log.info('Twitter', 'Retrieved token');
    this.app_twitter = new Twitter(this.app_auth);

    this.msg_queue_intervalID = setInterval(() => {
      this._process_head_of_msg_queue();
    }, TWITTER_MSG_QUEUE_INTERVAL_MS);

    this.start_timeline();
    this.start_hashtag();

  }).catch((error) => {
    log.error('Twitter', 'Error trying to retrieve bearer token:', error);
    throw error;
  });

  return this._app_twitter_promise;
}

MatrixTwitter.prototype._get_bearer_http = function () {
  return new Promise( (resolve, reject) => {
    var key = this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret;
    key = Buffer.from(key, 'ascii').toString('base64');
    var options = {
      url: "https://api.twitter.com/oauth2/token",
      headers: {
        'Authorization': "Basic " + key
      },
      form: "grant_type=client_credentials",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8"
    };
    Request.post(options, function (error, response, body) {
      if (error) {
        reject(error);
      } else if (response.statusCode !== 200) {
        reject("Response to bearer token request returned non OK")
        log.error("Twitter",
              "Body of response:%s\nStatuscode of respnse:%s",
              body,
              response.statusCode
            );
      } else {
        try {
          var jsonresponse = JSON.parse(body);
        } catch (e) {
          reject(e);
        }
        if (jsonresponse.token_type == "bearer") {
          fs.writeFile("bearer.tok", jsonresponse.access_token, (err) => {
            if (err) {
              //This error is unfortunate, but not a failure to retrieve a token so the bridge can run fine.
              log.error("Twitter", "Couldn't write bearer token to file. Reason:", err);
            }
          });
          //Not waiting for callback since it is trivial to get a new token, and can be done async
          resolve(jsonresponse.bearer_token);
        } else {
          reject({msg: "Request to oauth2/post did not return the correct" +
                  "token type ('bearer'). This is weeeird."});
          log.error("Twitter", "Body of response:%s", body);
        }
      }
    });
  });
}

MatrixTwitter.prototype._get_bearer_token = function () {
  return new Promise((resolve) => {
    fs.readFile('bearer.tok', {encoding: 'utf-8'}, (err, content) => {
      if(err) {
        log.warn('Twitter', "Token file not found or unreadable. Requesting new token.");
        log.error("Twitter", err);
        resolve(this._get_bearer_http());
      }
      resolve(content);
    });
  }).then(token => {
    //Test the token
    return new Promise((resolve, reject) =>{
      var auth = {
        consumer_key: this.app_auth.consumer_key,
        consumer_secret: this.app_auth.consumer_secret,
        bearer_token: token
      };
      this.app_twitter = new Twitter(auth).get(
        'application/rate_limit_status',
        {},
        (error, status, response) => {
          if(response.statusCode == 401) {
            log.warn('Twitter', "Authentication with existing token failed. ");
            fs.unlink('bearer.tok', (err) => {
              if(err) {
                log.warn('Twitter', "Couldn't delete bearer.tok");
              }
              resolve(this._get_bearer_http());
            });
          }
          else if (response.statusCode == 200) {
            log.info('Twitter', "Existing token OK.");
            resolve(token);
          }
          else {
            log.error("Twitter", error);
            reject("Unexpected response to application/rate_limit_status " +
              "during bearer token validation. Bailing.");
          }
        });
    });
  });
}

MatrixTwitter.prototype._get_intent = function (id) {
  return this._bridge.getIntentFromLocalpart("twitter_" + id);
}

MatrixTwitter.prototype._update_user_timeline_profile = function (profile) {
  var ts = new Date().getTime();
  if(profile == null) {
    log.warn("Twitter", "Tried to preform a profile update with a null profile.");
    return;
  }
  this.storage.get_profile_by_id(profile.id).then((old)=>{
    var update_name = true;
    var update_avatar = true;
    if(old != null && old.profile != null) {
      //If either the real name (name) or the screen_name (handle) are out of date, update the screen name.
      update_name = (old.profile.name != profile.name)
      update_name = (old.profile.screen_name != profile.screen_name);
      update_avatar = (old.profile.profile_image_url_https != profile.profile_image_url_https);
    }

    var intent = this._get_intent(profile.id_str);
    if(update_name) {
      if(profile != null && profile.name != null && profile.screen_name != null ) {
        intent.setDisplayName(profile.name + " (@" + profile.screen_name + ")");
      }
      else {
        log.warn("Twitter", "Tried to preform a user display name update with a null profile.");
      }
    }

    if(update_avatar) {
      if(profile == null || profile.profile_image_url_https == null) {
        log.warn("Twitter", "Tried to preform a user avatar update with a null profile.");
        return;
      }
      util.uploadContentFromUrl(this._bridge, profile.profile_image_url_https, intent).then((uri) =>{
        return intent.setAvatarUrl(uri);
      }).catch(err => {
        log.error(
            'Twitter',
            "Couldn't set new avatar for @%s because of %s",
            profile.screen_name,
            err
          );
      });
    }
    this.storage.cache_user_profile(profile.id, profile.screen_name, profile, ts);
  });
}

MatrixTwitter.prototype._create_twitter_client = function (creds) {
  var ts = new Date().getTime();
  var client = new Twitter({
    consumer_key: this.app_auth.consumer_key,
    consumer_secret: this.app_auth.consumer_secret,
    access_token_key: creds.access_token,
    access_token_secret: creds.access_token_secret
  });
  /* Store a timestamp to track the point of login with the client. We do this
     to avoid having to keep track of auth timestamps in another map. */
  client.last_auth = ts;
  return client;
}

MatrixTwitter.prototype._get_twitter_client = function (sender) {
  //Check if we have the account in the cache
  return this.storage.get_twitter_account(sender).then((creds) => {
    return new Promise( (resolve, reject) => {
      if(creds == null) {
        reject("No twitter account linked.");
        return;
      }

      var ts = new Date().getTime();
      var id = creds.user_id;
      var client;
      if(this.tclients.has(id)) {
        client = this.tclients[id];
        if(ts - client.last_auth < TWITTER_CLIENT_INTERVAL_MS) {
          resolve(client);
          return;
        }

        log.info("Twitter", "Credentials for %s need to be reevaluated.", sender);
        client.get("account/verify_credentials", (error, profile) => {
          if(error) {
            log.info("Twitter", "Credentials for " + id + " are no longer valid.");
            log.error("Twitter", error);
            delete this.tclients[id];//Invalidate it
            resolve(this._get_twitter_client(sender));
            return;
          }
          client.profile = profile;
          this._update_user_timeline_profile(profile);
          resolve(client);
        });
      }
      else {
        client = this._create_twitter_client(creds);
        this.tclients[id] = client;
        client.get("account/verify_credentials", (error, profile) => {
          if(error) {
            delete this.tclients[id];//Invalidate it
            log.error(
              "Twitter",
              "We couldn't authenticate with the supplied access token for %s. Look into this. %s",
              id,
              error
            );
            reject(error);
            return;
            //TODO: Possibly find a way to get another key.
          }
          client.profile = profile;
          client.last_auth = ts;
          this._update_user_timeline_profile(profile);
          resolve(client);
        });
      }
    });
  });
}

MatrixTwitter.prototype._get_user = function (data) {
  return new Promise((resolve, reject) => {
    this.app_twitter.get('users/show', data, (error, user) => {
      if (error) {
        if(Array.isArray(error)) {
          error = error[0];
        }

        log.error(
              'Twitter',
              "get_profile_by_id: GET /users/show returned: %s %s",
              error.code,
              error.message
            );
        reject(error.message);
        return;
      }
      this._update_user_timeline_profile(user);
      resolve(user);
    });
  });
}

/**
 * MatrixTwitter.prototype.get_profile_by_id - Get a Twitter profile by a users
 * Twitter ID.
 *
 * @param  {number} id Twitter Id
 * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
 * to be returned. See https://dev.twitter.com/rest/reference/get/users/show
 */
MatrixTwitter.prototype.get_profile_by_id = function (id) {
  log.info("Twitter", "Looking up T" + id);
  return this.storage.get_profile_by_id(id).then((profile)=>{
    if(profile != null) {
      return profile;
    }
    return this._get_user({user_id: id});
  });
}

/**
 * MatrixTwitter.prototype.get_user_by_screenname - Get a Twitter profile by a
 * users screen name.
 * @param  {number} id Twitter Screen name
 * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
 * to be returned. See {@link}
 *
 * @see {@link https://dev.twitter.com/rest/reference/get/users/show}
 */
MatrixTwitter.prototype.get_user_by_screenname = function (name) {
  log.info("Twitter", "Looking up @" + name);
  return this.storage.get_profile_by_name(name).then((profile)=>{
    if(profile != null) {
      return profile;
    }
    return this._get_user({screen_name: name});
  });
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
MatrixTwitter.prototype.tweet_to_matrix_content = function (tweet, type) {
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

//Runs every 500ms to help not overflow the room.
MatrixTwitter.prototype._process_head_of_msg_queue = function () {
  if(this.msg_queue.length > 0) {
    var msgs = this.msg_queue.pop();
    //log.info("Twitter","Pulling off queue:",msg.content.body);
    var promises = [];
    for(var msg of msgs) {
      var intent = this._bridge.getIntent(msg.userId);
      promises.push(intent.sendEvent(msg.roomId, msg.type, msg.content).catch(reason =>{
        log.error("Twitter", "Failed send tweet to room: %s", reason);
      }));
    }
    Promise.all(promises);
  }
}


MatrixTwitter.prototype._push_to_msg_queue = function (muser, roomid, tweet, type) {
  var time = Date.parse(tweet.created_at);
  var newmsg = {
    userId: muser,
    roomId: roomid,
    time: time,
    type: "m.room.message",
    content: this.tweet_to_matrix_content(tweet, type)
  };

  var media_promises = [];
  if(tweet.entities.hasOwnProperty("media")) {
    for(var media of tweet.entities.media) {
      if(media.type != 'photo') {
        continue;
      }
      media_promises.push(
        util.uploadContentFromUrl(
          this._bridge,
          media.media_url_https,
          this._get_intent(tweet.id_str)
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
    log.error("Twitter", "Failed to submit tweet to queue, reason: %s", reason);
  });
}

/**
 * MatrixTwitter.prototype.process_tweet - Process a given tweet (including
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
MatrixTwitter.prototype.process_tweet = function (roomid, tweet, depth) {
  depth--;

  var type = "m.text";
  if (tweet.in_reply_to_status_id_str != null) {
    type = "m.notice"; // A nicer way to show previous tweets
  }
    //log.info("Twitter","Processing tweet:",tweet.text);

  return new Promise( (resolve, reject) => {
    if (tweet.in_reply_to_status_id_str != null && depth > 0) {
      this.app_twitter.get(
            'statuses/show/' + tweet.in_reply_to_status_id_str, {}, (error, newtweet) => {
              if (!error) {
                return this.process_tweet(roomid, newtweet, depth);
              }
              else
              {
                log.error("process_tweet: GET /statuses/show returned: " + error[0].message);
                reject("process_tweet failed to retrieve a reply");
              }
            });
    }
    else {
      resolve();
    }
  }).then(() => {
    this._update_user_timeline_profile(tweet.user);
    if(this.processed_tweets.contains(roomid, tweet.text)) {
      log.info("Twitter", "Repeated tweet detected, not processing");
      return;
    }

    this.processed_tweets.push(roomid, tweet.text);
    this._push_to_msg_queue('@twitter_'+tweet.user.id_str + ':' + this._bridge.opts.domain, roomid, tweet, type);
    return;

  });
}

/**
 * MatrixTwitter.prototype.send_matrix_event_as_tweet - Takes a message event
 * from a room and tries to identify the sender and the correct format before
 * processing it in {@see send_tweet_to_timeline}.
 *
 * @param  {MatrixEvent}               event Matrix event data
 * @param  {external:MatrixUser} user  The user who sent the event.
 * @param  {external:RemoteRoom} room  The remote room that got the message.
 */
MatrixTwitter.prototype.send_matrix_event_as_tweet = function (event, user, room) {
  if(user == null) {
    log.warn("Twitter", "User tried to send a tweet without being known by the AS.");
    return;
  }
  if(event.content.msgtype == "m.text") {
    log.info("Twitter", "Got message: %s", event.content.body);
    var text = event.content.body.substr(0, 140);
    this.send_tweet_to_timeline(room, user, text);
  }
  else if(event.content.msgtype == "m.image") {
    log.info("Twitter", "Got image: %s", event.content.body);
    //Get the url
    var url = event.content.url;
    if(url.startsWith("mxc://")) {
      url = this._bridge.opts.homeserverUrl + "/_matrix/media/r0/download/" + url.substr("mxc://".length);
    }
    util.downloadFile(url).then((buffer) =>{
      return this.upload_media(user, buffer);
    }).then ((mediaId) => {
      this.send_tweet_to_timeline(room, user, "", {media: [mediaId]});
    }).catch(err => {
      log.error("Twitter", "Failed to send image to timeline. %s", err);
    });
  }
}


/**
 * MatrixTwitter.prototype.send_tweet_to_timeline - Send
 *
 * @param  {extenal:RemoteRoom} remote  The remote room that got the message.
 * @param  {extenal:MatrixUser} sender  The user who sent the event.
 * @param  {string}             body    The message content.
 * @param  extras                       Extra information to send with the tweet.
 * @param  {string[]} extras.media      Media files to attach to the tweet.
 */
MatrixTwitter.prototype.send_tweet_to_timeline = function (remote, sender, body, extras) {
  var type = remote.get("twitter_type");
  if(!["timeline", "hashtag", "user_timeline"].includes(type)) {
    log.error("Twitter", "Twitter type was wrong (%s) ", type)
    return;//Where am I meant to send it :(
  }

  var client;

  return this._get_twitter_client(sender.getId()).then((c) => {
    client = c;
    if(type == "timeline") {
      var timelineID = remote.getId().substr("timeline_".length);
      log.info("Twitter", "Trying to tweet " + timelineID);
      return this.get_profile_by_id(timelineID);
    }
  }).then(tuser => {
    var status = {status: body};
    if(type == "timeline") {
      var name = "@"+tuser.screen_name;
      if(!body.startsWith(name) && client.profile.screen_name != tuser.screen_name) {
        status.status = (name + " " + body);
      }
    }
    else if(type == "hashtag") {
      var htag = "#" + remote.roomId.substr("hashtag_".length);
      if(!body.toLowerCase().includes(htag.toLowerCase())) {
        status.status = (htag + " " + body);
      }
    }

    if(extras !== undefined) {
      if(extras.hasOwnProperty("media")) {
        status.media_ids = extras.media.join(',');
      }
    }

    status.status = status.status.substr(0, 140);

    this.processed_tweets.push(remote.roomId, status.status);
    client.post("statuses/update", status, (error) => {
      if(error) {
        log.error("Twitter", "Failed to send tweet. %s", error);
        return;
      }
      var id = sender.getId();
      log.info("Twitter", "Tweet sent from %s!", id);
    });
  }).catch(err =>{
    log.error("Twitter", "Failed to send tweet. %s", err);
  });
}

/*
  Timeline functions
*/

MatrixTwitter.prototype._process_timeline = function () {
  if (this.timeline_queue.length === 0) {
    return;
  }


  var tline = this.timeline_queue.shift();
  var id = tline.entry.remote.getId().substr("@twitter_".length);
  var req = {
    user_id: id,
    count: TIMELINE_TWEET_FETCH_COUNT
  };
  var since = tline.entry.remote.get("twitter_since");
  if (since != undefined) {
    req.since_id = since;
  }

  this.app_twitter.get('statuses/user_timeline', req, (error, feed) => {
    if(error) {
      log.error("Twitter", "_process_timeline: GET /statuses/user_timeline returned: %s", error);
      return;
    }
    if (feed.length === 0) {
      return;
    }

    if(this.msg_queue_intervalID != null) {
      clearInterval(this.msg_queue_intervalID);
      this.msg_queue_intervalID = null;
    }
    tline.entry.remote.set("twitter_since", feed[0].id_str);
    var promises = [];
    feed.reverse().forEach((item) => {
      promises.push(this.process_tweet(tline.entry.matrix.roomId, item, TWEET_REPLY_MAX_DEPTH));
    });
    Promise.all(promises).then(() =>{
      this._bridge.getRoomStore().upsertEntry(tline.entry).catch(err =>{
        log.warn("Twitter", "Couldn't store twitter_since by upserting %s\n%s", feed.entry.remote.roomId, err);
      });
      this.msg_queue_intervalID = setInterval(() => {
        this._process_head_of_msg_queue();
      }, TWITTER_MSG_QUEUE_INTERVAL_MS);
    });

  });
  this.timeline_queue.push(tline);
}

/**
 * MatrixTwitter.prototype.add_timeline - Add a user's timeline to the timeline
 * processor. Tweets will be automatically send to the given room.
 *
 * @param  {string} userid The Matrix user_id of the timeline owner. This would
 *                         be a bridge user.
 * @param  {external:Entry} entry The entry for a room in the RoomBridgeStore.
 */
MatrixTwitter.prototype.add_timeline = function (userid, entry) {
  var obj = {
    "user_id": userid,
    "entry": entry
  };
  this.timeline_queue.push(obj);
  log.info('Twitter', "Added Timeline: %s", userid);
}


/**
 * MatrixTwitter.prototype.remove_timeline - Remove a timeline from being
 * processed.
 *
 * @param  {type} userid The Matrix user_id of the timeline owner. This would
 *                       be a bridge user.
 */
MatrixTwitter.prototype.remove_timeline = function (userid) {
  const tlfind = (tline) => { return tline.user_id == userid };
  var item = this.timeline_queue.findIndex(tlfind);
  if(item != -1) {
    this.timeline_queue = this.timeline_queue.splice(item, 1);
  }
}


/**
 * MatrixTwitter.prototype.stop_timeline - Stop the timeline timer so that
 * timelines are no longer processed.
 */
MatrixTwitter.prototype.stop_timeline = function () {
  if (this.timeline_intervalID) {
    clearInterval(this.timeline_intervalID);
    this.timeline_intervalID = null;
  }
}


/**
 * MatrixTwitter.prototype.start_timeline - Start the timeline timer so that
 * timelines will be processed in turn.
 */
MatrixTwitter.prototype.start_timeline = function () {
  this.timeline_intervalID = setInterval(() => {this._process_timeline();}, TIMELINE_POLL_INTERVAL);
}

/*
  Hashtag functions
*/


/**
 * MatrixTwitter.prototype.start_hashtag - Start the hashtag timer so that
 * hashtags are processed in turn.
 */
MatrixTwitter.prototype.start_hashtag = function () {
  this.hashtag_intervalID = setInterval(() => {this._process_hashtag_feed();}, HASHTAG_POLL_INTERVAL);
}

/**
 * MatrixTwitter.prototype.stop_hashtag - Stop the hashtag timer so that
 * hashtags are no longer processed.
 */
MatrixTwitter.prototype.stop_hashtag = function () {
  if (this.hashtag_intervalID) {
    clearInterval(this.hashtag_intervalID);
    this.hashtag_intervalID = null;
  }
}


/**
 * MatrixTwitter.prototype.add_hashtag_feed - Add a hashtag to be processed.
 *
 * @param  {string} hashtag The hashtag to add (without the #).
 * @param  {external:Entry} entry The entry for a room in the RoomBridgeStore.
 */
MatrixTwitter.prototype.add_hashtag_feed = function (hashtag, entry) {
  var obj = {
    "hashtag": hashtag,
    "entry": entry
  };
  this.hashtag_queue.push(obj);
  log.info('Twitter', "Added Hashtag Feed: %s", hashtag);
}


/**
 * MatrixTwitter.prototype.remove_hashtag_feed - Remove a hashtag so that it
 * will no longer be processed.
 *
 * @param  {string} hashtag The hashtag to remove (without the #).
 */
MatrixTwitter.prototype.remove_hashtag_feed = function (hashtag) {
  const htfind = (feed) => { return feed.hashtag == hashtag };
  var item = this.hashtag_queue.findIndex(htfind);
  if(item != -1) {
    this.hashtag_queue = this.hashtag_queue.splice(item, 1);
  }
}

MatrixTwitter.prototype._process_hashtag_feed = function () {
  if (this.hashtag_queue.length < 1) {
    return;
  }

  var feed = this.hashtag_queue.shift();
  var req = {
    q: "%23"+feed.hashtag,
    result_type: 'recent'
  };
  var since = feed.entry.remote.get("twitter_since");
  if (since != undefined) {
    req.since_id = since;
  }

  this.app_twitter.get('search/tweets', req, (error, results) => {
    if(error) {
      log.error("Twitter", "_process_hashtag_feed: GET /search/tweets returned: %s", error);
      return;
    }

    if(results.statuses.length > 0) {
      feed.entry.remote.set("twitter_since", results.search_metadata.max_id_str);
      this._bridge.getRoomStore().upsertEntry(feed.entry).catch(err =>{
        log.warn("Twitter", "Couldn't store twitter_since by upserting %s\n%s", feed.entry.remote.roomId, err);
      });
    }

    results.statuses.reverse().forEach((item) => {
      this.process_tweet(feed.entry.matrix.roomId, item, 0);
    });
  });
  this.hashtag_queue.push(feed);
}

/*
  User Stream functions
*/


/**
 * MatrixTwitter.prototype.attach_user_stream - Start reading live updates from
 * a Twitter User Stream.
 *
 * @param  {string} user The user's matrix ID.
 * @return {Promise}   A Promise that will resolve with the operation completes.
 */
MatrixTwitter.prototype.attach_user_stream = function (user) {
  if(this.user_streams.has(user)) {
    log.warn("Twitter", "Not attaching stream since we already have one connected!");
    return;
  }
  return this._get_twitter_client(user).then((c) => {
    var stream = c.stream('user', {with: "followings"});
    log.info("Twitter", "Attached stream for " + user);
    stream.on('data',  (data) => {
      if(data.direct_message) {
        this._process_incoming_dm(data.direct_message);
      }
      else if (data.warning) {
        log.warn("Twitter.UserStream",
         "Got a warning from a User Stream.\n%s : %s",
          data.warning.code,
          data.warning.message
        );
      }
      else if (data.id) { //Yeah..the only way to know if it's a tweet is to check if the ID field is set at the root level.
        this._push_to_user_timeline(user, data);
      }
    });
    stream.on('error', function (error) {
      log.error("Twitter", "Stream gave an error %s", error);
    });
    this.user_streams[user] = stream;
  }).catch(reason =>{
    log.warn("Twitter", "Couldn't attach user stream for %s : %s", user, reason);
  });
}

/**
 * MatrixTwitter.prototype.detach_user_stream - Stop reading updates about a
 * user.
 *
 * @param  {string} user The user's matrix ID.
 */
MatrixTwitter.prototype.detach_user_stream = function (user) {
  log.info("Twitter", "Detached stream for " + user);
  if(this.user_streams.has(user)) {
    this.user_streams[user].destroy();
    delete this.user_streams[user];
  }
}


/**
 * MatrixTwitter.prototype.create_user_timeline - If a room does not exist for
 * a matrix user's personal timeline, it will be created here.
 *
 * @param  {string} user The user's matrix ID.
 * @param  {object}      The user's Twitter profile.
 * @return {Promise}     A promise that returns once the operation has completed.
 */
MatrixTwitter.prototype.create_user_timeline = function (user, profile) {
  //Check if room exists.
  return this.storage.get_timeline_room(user).then(troom =>{
    if(troom != null) {
      return;
    }
    var intent = this._get_intent(profile.id_str);
    //Create the room
    return intent.createRoom(
      {
        createAsClient: true,
        options: {
          invite: [user],
          name: "[Twitter] Your Timeline",
          visibility: "private",
          initial_state: [
            {
              "type": "m.room.join_rules",
              "content": {
                "join_rule": "public"
              },
              "state_key": ""
            }
          ]
        }
      }
    ).then(room =>{
      var mroom = new MatrixRoom(room.room_id);
      var rroom = new RemoteRoom("tl_"+user);
      rroom.set("twitter_type", "user_timeline");
      rroom.set("twitter_owner", user);
      this._bridge.getRoomStore().linkRooms(mroom, rroom);
      this.storage.set_timeline_room(user, room.room_id);
    });
  });
}

MatrixTwitter.prototype._push_to_user_timeline = function (user, msg) {
  this.storage.get_timeline_room(user).then(value =>{
    if(value) {
      this.process_tweet(value, msg, TWEET_REPLY_MAX_DEPTH);
      return;
    }
    log.error("Twitter.UserTimeline", "A user is registered but its timeline room is null. Something is up.");
  });
}

MatrixTwitter.prototype._create_dm_room = function (msg) {
  log.info(
    "Twitter.DM",
    "Creating a new room for DMs from %s(%s) => %s(%s)",
    msg.sender_id_str,
    msg.sender_screen_name,
    msg.recipient_id_str,
    msg.recipient_screen_name
  );
  return Promise.all([
    this.storage.get_matrixid_from_twitterid(msg.sender_id_str),
    this.storage.get_matrixid_from_twitterid(msg.recipient_id_str)
  ]).then(user_ids =>{
    var invitees = new Set([
      "@twitter_" + msg.recipient_id_str + ":" + this._bridge.opts.domain
    ]);
    for(var user_id of user_ids) {
      if(user_id != null) {
        invitees.add(user_id);
      }
    }
    return [...invitees];
  }).then(invitees => {
    var intent = this._get_intent(msg.sender_id_str);
    return intent.createRoom(
      {
        createAsClient: true,
        options: {
          invite: invitees,
          name: "[Twitter] DM "+msg.sender_screen_name+":"+msg.recipient_screen_name,
          visibility: "private",
          //topic: "Twitter feed for #"+name,
          initial_state: [
            {
              "type": "m.room.join_rules",
              "content": {
                "join_rule": "invite"
              },
              "state_key": ""
            }
          ]
        }
      }
    );
  });
}

MatrixTwitter.prototype._process_incoming_dm = function (msg) {
  var users = [msg.sender_id_str, msg.recipient_id_str].sort().join('');

  this._update_user_timeline_profile(msg.sender);
  this._update_user_timeline_profile(msg.recipient);

  if(this.sent_dms.contains(users, msg.text)) {
    log.info("Twitter.DM", "DM has already been processed, ignoring.");
    return;
  }

  this.storage.get_dm_room(users).then(room_id =>{
    if(room_id) {
      this._put_dm_in_room(room_id, msg);
      return;
    }
    //Create a new room.
    return this._create_dm_room(msg).then(room => {
      return this.storage.add_dm_room(room.room_id, users).then(() =>{
        var mroom = new MatrixRoom(room.room_id);
        var rroom = new RemoteRoom("dm_"+users);
        rroom.set("twitter_type", "dm");
        this._bridge.getRoomStore().linkRooms(mroom, rroom);
        this._put_dm_in_room(room.room_id, msg);
      });
    });
  }).catch(reason =>{
    log.error("Twitter.DM", "Couldn't create room. Reason: " + reason);
  });

}

MatrixTwitter.prototype._put_dm_in_room = function (room_id, msg) {
  var intent = this._get_intent(msg.sender_id_str);
  log.info(
    "Twitter.DM",
    "Recieved DM from %s(%s) => %s(%s)",
    msg.sender_id_str, msg.sender_screen_name,
    msg.recipient_id_str,
    msg.recipient_screen_name
  );
  intent.sendMessage(room_id, {"msgtype": "m.text", "body": msg.text});
}


/**
 * MatrixTwitter.prototype.send_dm - Send a DM on the users behalf. The room_id
 * should be a DM room which has been set up for the user in advance.
 *
 * @param  {string} user_id    The user trying to send the message.
 * @param  {string} room_id    The DM room that the message was sent from.
 * @param  {string} text       The body text of the message.
 * @return {Promise}           A promise that will resolve when the operation
 * completes
 */
MatrixTwitter.prototype.send_dm = function (user_id, room_id, text) {
  //Get the users from the room
  var users = "";
  return this.storage.get_users_from_dm_room(room_id).then(u =>{
    users = u;
    if(users == null) {
      log.error(
        "Twitter.DM",
        ("User (%s) tried to send a DM to (%s) but the room was not found in" +
         + "the DB. This shouldn't happen."),
        user_id, room_id
      );
    }
    return this._get_twitter_client(user_id);
  }).then(client => {
    var otheruser = users.replace(client.profile.id_str, "");
    log.info(
      "Twitter.DM",
      "Sending DM from %s(%s) => %s",
      client.profile.id_str,
      client.profile.screen_name,
      otheruser
    );
    this.sent_dms.push(users, text);
    client.post("direct_messages/new", {user_id: otheruser, text: text}, (error) =>{
      if(error) {
        log.error("Twitter.DM", "direct_messages/new failed. Reason: %s", error);
      }
    });
  }).catch(reason =>{
    log.error("Twitter.DM", "Failed to send DM: %s", reason);
  });
}

module.exports = {
  MatrixTwitter: MatrixTwitter
}
