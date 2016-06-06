var Twitter = require('twitter');
var Request = require('request');
var fs = require('fs');
var Buffer = require('buffer').Buffer;

var TWITTER_PROFILE_INTERVAL = 60000;

var mtwitter = function(bridge, config) {
  this.app_auth = config.app_auth;
  this.app_twitter = null;
  this.tuser_cache = {};
  this.timeline_list = [];
  this.timeline_queue = [];
  this.timeline_period = 0;
  this.timeline_intervalobj = null;
  this._bridge = bridge;

  this.get_bearer_token((bt) => {
      if (bt != null) {
          this.app_auth.bearer_token = bt;
          console.log("Twitter Application Auth OK!");
          this.app_twitter = new Twitter(this.app_auth);
          return;
      }
      console.error("Twitter Application Failed Auth. The bridge will be operating in a limited capacity.");
  });
}

mtwitter.prototype.get_bearer_token = function(cb){
  try {
      fs.accessSync('bearer.tok', fs.R_OK);
      var tok = fs.readFileSync('bearer.tok', 'utf8');
      cb(tok);
      return;
  } catch (e) {
      console.log("Bearer token either does not exist or cannot be read, getting a new token.")
  }

  var key = this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret;
  key = Buffer.from(this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret, 'ascii').toString('base64');
  var options = {
      url: "https://api.twitter.com/oauth2/token",
      headers: {
          'Authorization': "Basic " + key
      },
      form: "grant_type=client_credentials",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8"
  };
  Request.post(options, function(error, response, body) {
      if (error) {
          console.log("Error", error);
          return false;
      } else {
          try {
              var jsonresponse = JSON.parse(body);
              if (jsonresponse.token_type == "bearer") {
                  fs.writeFile("bearer.tok", jsonresponse.access_token, (err) => {
                      if (err) {
                          console.error("Couldn't write bearer token to file. Reason:",err);
                      }
                  });
                  cb(jsonresponse.bearer_token);
              } else {
                  console.error("Error getting bearer token: Unexpected response");
                  cb(null);
              }
          } catch (e) {
              console.error("Error getting bearer token:", e);
              cb(null);
          }

      }
  });
}

mtwitter.prototype.get_user_by_id = function(id) {
    var ts = new Date().getTime();
    return new Promise((resolve, reject) => {
        for (var name in this.tuser_cache) {
            var cached = this.tuser_cache[name];
            if (ts - cached.cache_time > TWITTER_PROFILE_INTERVAL) {
                continue;
            }
            if (cached.user != null && cached.user.id_str == id) {
                resolve(cached.user);
            }
        }
        this.app_twitter.get('users/show', {
            user_id: id
        }, (error, user, response) => {
            if (error) {
                console.error(error);
                reject(error);
            } else {
                this.tuser_cache[user.screen_name] = {
                    cache_time: ts,
                    user: user
                };
                resolve(user);
            }
        });
    });
}

mtwitter.prototype.get_user = function(name) {
    console.log("Looking up @" + name);
    return new Promise((resolve, reject) => {
        var ts = new Date().getTime();
        if (this.tuser_cache[name] != undefined) {
            console.log("Checking cache for @" + name);
            var cached = this.tuser_cache[name];
            if (ts - cached.cache_time < TWITTER_PROFILE_INTERVAL) {
                resolve(cached.user);
            }
        }

        console.log("Checking twitter for @" + name);
        this.app_twitter.get('users/show', {
            screen_name: name
        }, (error, user, response) => {
            if (error) {
                this.tuser_cache[name] = {
                    cache_time: ts,
                    user: null
                };
                reject(error);
            }
            this.tuser_cache[name] = {
                cache_time: ts,
                user: user
            };
            resolve(user);
        });
    });

}

/*
  Add a user's timeline to the iterator. Tweets will be automatically send to
  the given room.
*/
mtwitter.prototype.enqueue_timeline = function(userid, localroom, remoteroom) {
    var obj = {
        "user_id": userid,
        "local": localroom,
        "remote": remoteroom
    };
    this.timeline_list.push(obj);
    this.timeline_queue.push(obj);
}

/*
  This function will fill the content structure for a new matrix message
  for a given tweet.
*/
mtwitter.prototype.construct_message = function(tweet, type) {
    return {
        "body": tweet.text,
        "created_at": tweet.created_at,
        "likes": tweet.favorite_count,
        "reblogs": tweet.retweet_count,
        "tweet_id": tweet.id_str,
        "tags": tweet.entities.hashtags,
        "msgtype": type
    }
}

/*
  Process a given tweet (including resolving any parent parent tweets), and
  submit it to the appropriate room.
*/
mtwitter.prototype.process_tweet = function(bridge, roomid, tweet, treeN) {
    //console.log(tweet);
    var muser = "@twitter_" + tweet.user.id_str + ":" + bridge.opts.domain;
    var intent = bridge.getIntent(muser);
    treeN--;
    if (treeN < 0) {
        console.log("Bailing because we have gone too far deep.")
        return;
    }

    var type = "m.text";
    if (tweet.in_reply_to_status_id_str != null) {
        type = "m.notice"; // A nicer way to show previous tweets
    }
    var tweet_content = this.construct_message(tweet, type);

    if (tweet.in_reply_to_status_id_str != null) {
        this.app_twitter.get('statuses/show/' + tweet.in_reply_to_status_id_str, {}, (error, newtweet, response) => {
            if (!error) {
                this.process_tweet(bridge, roomid, newtweet, treeN);
                return;
            }
            console.error(error);
        });
        setTimeout(() => {
            intent.sendEvent(roomid, "m.room.message", tweet_content)
        }, treeN * 250); //Make sure not to send them too quickly.
    }
}

/*
  Internal function to process the timeline queue.
*/
mtwitter.prototype._process_timeline = function(self) {
    if (self.timeline_queue.length < 1) {
        return;
    }
    
    var tline = self.timeline_queue[0];
    self.timeline_queue = self.timeline_queue.slice(1);
    var id = tline.remote.getId().substr(9);

    var req = {
        user_id: id,
        count: 3
    };
    var since = tline.remote.get("twitter_since");
    if (since != undefined) {
        req.since_id = since;
    }

    self.app_twitter.get('statuses/user_timeline', req, (error, feed, response) => {
        if (!error) {
            if (feed.length > 0) {
                tline.remote.set("twitter_since", feed[0].id_str, 3);
                feed = feed.reverse();
                for (var item in feed) {
                    self.process_tweet(self._bridge, tline.local.roomId, feed[item], 3);
                }
                self._bridge.getRoomStore().setRemoteRoom(tline.remote);
            }
            return;
        }
        console.error(error);
    });
    self.timeline_queue.push(tline);
}

mtwitter.prototype.stop_timeline = function() {
    if (this.timeline_intervalobj) {
        clearInterval(this.timeline_intervalobj);
        this.timeline_intervalobj = null;
    }
}

mtwitter.prototype.start_timeline = function() {
    this.timeline_period = 3050; //Twitter allows 300 calls per 15 minute (We add 50 milliseconds for a little safety).
    this.timeline_intervalobj = setInterval(() => {this._process_timeline(this);}, this.timeline_period);
}

module.exports = {
    MatrixTwitter: mtwitter
}
