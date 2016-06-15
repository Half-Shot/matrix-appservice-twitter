var Twitter = require('twitter');
var Request = require('request');
var fs = require('fs');
var Buffer = require('buffer').Buffer;

const TWITTER_PROFILE_INTERVAL_MS = 60000;
/*
  We pass in the full configuration to the constructor since eventually other
  settings will be placed into config (for flags and other forms of auth).
*/
var MTwitter = function (bridge, config) {
  this.app_auth = config.app_auth;
  this.app_twitter = null;
  this.tuser_cache = {};
  this.timeline_list = [];
  this.timeline_queue = [];
  this.timeline_period = 0;
  this.timeline_intervalID = null;
  this.msg_queue = [];
  this._bridge = bridge;
  this.tweet_event_cache = {};
};

MTwitter.prototype.start = function(){
  return this.get_bearer_token().then((token) => {
    this.app_auth.bearer_token = token;
    console.log('Retrieved token');
    this.app_twitter = new Twitter(this.app_auth);
    setInterval(() => { this._process_head_of_msg_queue(); }, 500);
    this.start_timeline();
  }).catch((error) => {
      console.error('Error trying to retrieve bearer token:', error);
      throw "Couldn't get a bearer token for Twitter AS.";
  });
}

MTwitter.prototype._get_bearer_http = function () {
  return new Promise( (resolve,reject) => {
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
    Request.post(options, function(error, response, body) {
        if (error) {
            reject(error);
        } else if (response.statusCode !== 200){
            reject("Response to bearer token request returned non OK")
            console.log("Body of response:",body);
            console.log("Statuscode of respnse:",response.statusCode);
        } else {
            try {
                var jsonresponse = JSON.parse(body);
                if (jsonresponse.token_type == "bearer") {
                    fs.writeFile("bearer.tok", jsonresponse.access_token, (err) => {
                        if (err) {
                            //This error is unfortunate, but not a failure to retrieve a token so the bridge can run fine.
                            console.error("Couldn't write bearer token to file. Reason:",err);
                        }
                    });
                    //Not waiting for callback since it is trivial to get a new token, and can be done async
                    resolve(jsonresponse.bearer_token);
                } else {
                    reject("Request to oauth2/post did not return the correct token type ('bearer'). This is weeeird.");
                    console.log("Body of response:",body);
                }
            } catch (e) {
                reject(e);
            }
        }
    });
  });
}

MTwitter.prototype.get_bearer_token = function () {
  return new Promise((resolve,reject) => {
    fs.readFile('bearer.tok',{encoding:'utf-8'}, (err, content) => {
      if(err){
        console.log("Token file not found or unreadable. Requesting new token.");
        console.log(err);
        return this._get_bearer_http();
      }
      //Test the token
      var auth = {
        consumer_key: this.app_auth.consumer_key,
        consumer_secret: this.app_auth.consumer_secret,
        bearer_token: content
      };
      this.app_twitter = new Twitter(auth).get('application/rate_limit_status', {}, (error,status,response) => {        
        if(response.statusCode == 401){
          console.log("Authentication with existing token failed. ");
          fs.unlink('bearer.tok', (err) => {
            return this._get_bearer_http();
          });
        }
        else if (response.statusCode == 200){
            console.log("Existing token OK.");
            resolve(content);
        }
        else {
            console.log(error);
            reject("Unexpected response to application/rate_limit_status during bearer token validation. Bailing.");
        }
      });
    });
  });
}

MTwitter.prototype.get_user_by_id = function(id) {
    var ts = new Date().getTime();
    return new Promise((resolve, reject) => {
        for (var i in this.tuser_cache) {
            var cached = this.tuser_cache[i];
            if (ts - cached.cache_time > TWITTER_PROFILE_INTERVAL_MS) {
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
                console.error("get_user_by_id: GET /users/show returned: ", error);
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

MTwitter.prototype.get_user = function(name) {
    console.log("Looking up @" + name);
    return new Promise((resolve, reject) => {
        var ts = new Date().getTime();
        if (this.tuser_cache[name] != undefined) {
            console.log("Checking cache for @" + name);
            var cached = this.tuser_cache[name];
            if (ts - cached.cache_time < TWITTER_PROFILE_INTERVAL_MS) {
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
  Add a user's timeline to the timeline processor. Tweets will be automatically send to
  the given room.
*/
MTwitter.prototype.add_timeline = function(userid, localroom, remoteroom) {
    var obj = {
        "user_id": userid,
        "local": localroom,
        "remote": remoteroom
    };
    this.timeline_list.push(obj);
    this.timeline_queue.push(obj);
    console.log("Added Timeline:",userid);
}

MTwitter.prototype.remove_timeline = function(userid){
  const tlfind = (tline) => { tline.user_id == userid };
  this.timeline_list  = this.timeline_list.splice(this.timeline_list.findIndex(tlfind),1);
  this.timeline_queue = this.timeline_queue.splice(this.timeline_queue.findIndex(tlfind),1);
}

/*
  This function will fill the content structure for a new matrix message
  for a given tweet.
*/
MTwitter.prototype.tweet_to_matrix_content = function(tweet, type) {
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

//Runs every 500ms to help not overflow the room.
MTwitter.prototype._process_head_of_msg_queue = function(){
  if(this.msg_queue.length > 0){
    var msg = this.msg_queue.shift();
    var intent = this._bridge.getIntent(msg.userId);
    intent.sendEvent(msg.roomId, msg.type, msg.content).then( (id) => {
      console.log(id);
    });
  }
}

/*
  Process a given tweet (including resolving any parent tweets), and
  submit it to the given room. This function is recursive, limited to the depth
  set.
  roomid - Matrix Room ID of the room that we are processing.
  depth - The maximum depth of the tweet chain (replies to replies) to be traversed.
  Set this to how deep you wish to traverse and it will be decreased when the
  function calls itself. 
*/
MTwitter.prototype.process_tweet = function(roomid, tweet, depth) {
    //console.log(tweet);
    depth--;
    if (depth < 0) {
        return;
    }
    
    var muser = "@twitter_" + tweet.user.id_str + ":" + bridge.opts.domain;
    var intent = this._bridge.getIntent(muser);

    var type = "m.text";
    if (tweet.in_reply_to_status_id_str != null) {
        type = "m.notice"; // A nicer way to show previous tweets
    }
    
    if (tweet.in_reply_to_status_id_str != null) {
        this.app_twitter.get('statuses/show/' + tweet.in_reply_to_status_id_str, {}, (error, newtweet, response) => {
            if (!error) {
                this.process_tweet(roomid, newtweet, depth);
                return;
            }
            console.error("process_tweet: GET /statuses/show returned: ", error);
        });
    }
    this.msg_queue.push(
      {
        userId:muser,
        roomId:roomid,
        type:"m.room.message",
        content:this.tweet_to_matrix_content(tweet, type)
      }
    );
}

/*
  Internal function to process the timeline queue.
*/
MTwitter.prototype._process_timeline = function(self) {
    if (this.timeline_queue.length < 1) {
        return;
    }
    
    var tline = this.timeline_queue.shift();
    var id = tline.remote.getId().substr("@twitter_".length);

    var req = {
        user_id: id,
        count: 3
    };
    var since = tline.remote.get("twitter_since");
    if (since != undefined) {
        req.since_id = since;
    }

    this.app_twitter.get('statuses/user_timeline', req, (error, feed, response) => {
        if(error){
          console.error("_process_timeline: GET /statuses/user_timeline returned: ", error);
          return;
        }
        if (feed.length > 0) {
            tline.remote.set("twitter_since", feed[0].id_str, 3);
            feed.reverse().forEach((item) => {
                this.process_tweet(tline.local.roomId, item, 3);
            });
            this._bridge.getRoomStore().setRemoteRoom(tline.remote);
        }
    });
    this.timeline_queue.push(tline);
}

MTwitter.prototype.stop_timeline = function() {
    if (this.timeline_intervalID) {
        clearInterval(this.timeline_intervalID);
        this.timeline_intervalID = null;
    }
}

MTwitter.prototype.start_timeline = function() {
    this.timeline_period = 3050; //Twitter allows 300 calls per 15 minute (We add 50 milliseconds for a little safety).
    this.timeline_intervalID = setInterval(() => {this._process_timeline();}, this.timeline_period);
}

module.exports = {
    MatrixTwitter: MTwitter
}
