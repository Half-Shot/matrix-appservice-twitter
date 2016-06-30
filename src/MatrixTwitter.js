var Twitter = require('twitter');
var Request = require('request');
var fs = require('fs');
var log = require('npmlog');
var Buffer = require('buffer').Buffer;
var HTMLDecoder = new require('html-entities').AllHtmlEntities;
var MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;

var ProcessedTweetList = require("./ProcessedTweetList.js");
var util = require("./util.js");

const TWITTER_PROFILE_INTERVAL_MS   = 300000;
const TWITTER_CLIENT_INTERVAL_MS    = 60000;
const TWITTER_MSG_QUEUE_INTERVAL_MS = 1500;

/*
  We pass in the full configuration to the constructor since eventually other
  settings will be placed into config (for flags and other forms of auth).
*/
var MatrixTwitter = function (bridge, config, storage) {
  this.app_auth = config.app_auth;
  this.app_twitter = null;
  this.tclients = {};
  this.storage = storage;
  
  this.timeline_list = [];
  this.timeline_queue = [];
  this.timeline_period = 3050; //Twitter allows 300 calls per 15 minute (We add 50 milliseconds for a little safety).
  this.timeline_intervalID = null;
  
  this.hashtag_period = 2050; //Twitter allows 450 calls per 15 minute (We add 50 milliseconds for a little safety).
  this.hashtag_intervalID = null;
  this.hashtag_list = [];
  this.hashtag_queue = [];
  
  this.processed_tweets = new ProcessedTweetList();  //This will contain all the tweet IDs of things we don't want to repeat.
  this.msg_queue = [];
  this.msg_queue_intervalID = null;
  this._bridge = bridge;
  this.tweet_event_cache = {};
};

MatrixTwitter.prototype.start = function(){
  return this.get_bearer_token().then((token) => {
    this.app_auth.bearer_token = token;
    log.info('Twitter','Retrieved token');
    this.app_twitter = new Twitter(this.app_auth);
    this.msg_queue_intervalID = setInterval(() => {this._process_head_of_msg_queue();}, TWITTER_MSG_QUEUE_INTERVAL_MS);
    
    this.start_timeline();
    this.start_hashtag();
    
  }).catch((error) => {
      log.error('Twitter','Error trying to retrieve bearer token:', error);
      throw "Couldn't get a bearer token for Twitter AS.";
  });
}

MatrixTwitter.prototype._get_bearer_http = function () {
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
                            log.error("Twitter","Couldn't write bearer token to file. Reason:",err);
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

MatrixTwitter.prototype.get_bearer_token = function () {
  return new Promise((resolve,reject) => {
    fs.readFile('bearer.tok',{encoding:'utf-8'}, (err, content) => {
      if(err){
        log.warn('Twitter',"Token file not found or unreadable. Requesting new token.");
        log.error("Twitter",err);
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
          log.warn('Twitter',"Authentication with existing token failed. ");
          fs.unlink('bearer.tok', (err) => {
            return this._get_bearer_http();
          });
        }
        else if (response.statusCode == 200){
            log.info('Twitter',"Existing token OK.");
            resolve(content);
        }
        else {
            log.error("Twitter",error);
            reject("Unexpected response to application/rate_limit_status during bearer token validation. Bailing.");
        }
      });
    });
  });
}

MatrixTwitter.prototype._update_user_timeline_profile = function(profile){
  //It's a free request, store the data.
  log.info("Twitter","Updating profile for %s", profile.screen_name);
  var ts = new Date().getTime();
  return this.storage.get_profile_by_id(profile.id).then((old)=>{
    if(old != null){
      var sname = (old.profile.screen_name != profile.screen_name);
      var name = (old.profile.name != profile.name);
      var avatar = (old.profile.profile_background_image_url_https != profile.profile_background_image_url_https);
    }
    else {
      sname = true;
      name = true;
      avatar = true;
    }
    
    var muser = "@twitter_" + profile.id_str + ":" + this._bridge.opts.domain;
    var intent = this._bridge.getIntent(muser);
    if(name || sname){
      intent.setDisplayName(profile.name + " (@" + profile.screen_name + ")");
      log.info("Twitter","Setting new display name for %s", profile.screen_name);
    }
    
    if(avatar){
    log.info("Twitter","Setting new avatar for %s", profile.screen_name);
      //util.uploadContentFromUrl(this._bridge,profile.profile_background_image_url_https,muser).then((uri) =>{
      //  intent.setAvatarUrl(uri);
      //});
    }
  
    
    
  });
  this.storage.set_twitter_profile(profile.id,profile.screen_name,profile,ts);
}

MatrixTwitter.prototype._get_twitter_client = function(sender){
  //Check if we have the account in the cache
  return new Promise( (resolve,reject) =>{
    var id = sender.getId();
    var ts = new Date().getTime();
    var client;
    var creds = sender.get("twitter_oauth");
    if(this.tclients.hasOwnProperty(id)){
      client = this.tclients[id];
      if(ts - client.last_auth < TWITTER_CLIENT_INTERVAL_MS){
        resolve(client);
        return;
      }
      client.get("account/verify_credentials",(error,profile) =>{
        if(error){
          delete this.tclients[id];//Invalidate it
          log.info("Twitter","Credentials for " + id + " are no longer valid.");
        }
        client.profile = profile;
        this._update_user_timeline_profile(profile);
        resolve(client);
        return;
      });
    }
    if(creds !== undefined && !this.tclients.hasOwnProperty(id)) {
      client = new Twitter({
        consumer_key: this.app_auth.consumer_key,
        consumer_secret: this.app_auth.consumer_secret,
        access_token_key: creds.access_token,
        access_token_secret: creds.access_token_secret
      });
      client.last_auth = ts;
      this.tclients[id] = client;
      client.get("account/verify_credentials",(error,profile) =>{
        if(error){
          delete this.tclients[id];//Invalidate it
          log.error("Twitter","We couldn't reauthenticate with the supplied access token for " + id + ". Look into this.");
          reject("Twitter account could not be reauthenticated.");
          //TODO: Possibly find a way to get another key.
        }
        client.profile = profile;
        this._update_user_timeline_profile(profile);
        resolve(client);
      });
      
    }
    else{
      reject("No twitter account linked.");
    }
  });
}

MatrixTwitter.prototype.upload_media = function(sender,data){
  return new Promise( (resolve,reject) => {
      this._get_twitter_client(sender).then((client) => {
        client.post("media/upload",{media:data}, (error, media, response) => {
        if(error){
          log.error("Twitter",error);
          reject("Failed to upload media");
        }
        resolve(media.media_id_string);
      });
    })
  });
}



MatrixTwitter.prototype.send_tweet_to_timeline = function(remote,sender,body,extras){
  var type = remote.get("twitter_type");
  if(!["timeline","hashtag"].includes(type)){
    log.error("Twitter","Twitter type was wrong (%s) ",type)
    return;//Where am I meant to send it :(
  }
  
  var client;
  
  return this._get_twitter_client(sender).then((c) => {
    client = c;
    if(type == "timeline"){
      var timelineID = remote.getId().substr("timeline_".length);
      log.info("Twitter","Trying to tweet " + timelineID);
      return this.get_user_by_id(timelineID);
    }
  }).then(tuser => {
    var status = {status:body};
    if(type == "timeline"){
      var name = "@"+tuser.screen_name;
      if(!body.startsWith(name) && client.profile.screen_name != tuser.screen_name){
        status.status = (name + " " + body).substr(0,140);
      }
      if(extras !== undefined){
        if(extras.hasOwnProperty("media")){
          status.media_ids = extras.media.join(',');
        }
      }
    }
    else if(type == "hashtag"){
      var htag = "#" + remote.roomId.substr("hashtag_".length);
      if(!body.toLowerCase().includes(htag.toLowerCase())){
        status.status = (htag + " " + body).substr(0,140);
      }
    }
    
    client.post("statuses/update",status,(error,tweet) => {
      if(error){
        log.error("Twitter","Failed to send tweet. %s",error);
        return;
      }
      var id = sender.getId();
      this.processed_tweets.push(tweet.id_str);
      log.info("Twitter","Tweet sent from %s!",id);
    });
  }).catch(err =>{
    log.error("Twitter","Failed to send tweet. %s",err);
  });
}

MatrixTwitter.prototype._get_user_from_twitter = function(data) {
  return new Promise((resolve,reject) => {
    this.app_twitter.get('users/show', data, (error, user, response) => {
        if (error) {
            log.error('Twitter',"get_user_by_id: GET /users/show returned: ", error);
            reject(error);
        }
        ts = new Date().getTime();
        this._update_user_timeline_profile(user);
        resolve(user);
    });
  });
}

MatrixTwitter.prototype.get_user_by_id = function(id) {
  log.info("Twitter","Looking up T" + id);
  var ts = new Date().getTime();
  return this.storage.get_profile_by_id(id).then((profile)=>{
    if(profile != null){
      if(ts - profile.timestamp < TWITTER_PROFILE_INTERVAL_MS){
        return profile.profile;
      }
    }
    return this._get_user_from_twitter({user_id:id});
  });
}

MatrixTwitter.prototype.get_user = function(name) {
  log.info("Twitter","Looking up @" + name);
  var ts = new Date().getTime();
  return this.storage.get_profile_by_name(name).then((profile)=>{
    if(profile != null){
      if(ts - profile.timestamp < TWITTER_PROFILE_INTERVAL_MS){
        resolve(profile.profile);
        return;
      }
    }
    return this._get_user_from_twitter({screen_name:name});
  });
}

/*
  Add a user's timeline to the timeline processor. Tweets will be automatically send to
  the given room.
*/
MatrixTwitter.prototype.add_timeline = function(userid, localroom, remoteroom) {
    var obj = {
        "user_id": userid,
        "local": localroom,
        "remote": remoteroom
    };
    this.timeline_list.push(obj);
    this.timeline_queue.push(obj);
    log.info('Twitter',"Added Timeline: %s",userid);
}

MatrixTwitter.prototype.remove_timeline = function(userid){
  const tlfind = (tline) => { tline.user_id == userid };
  this.timeline_list  = this.timeline_list.splice(this.timeline_list.findIndex(tlfind),1);
  this.timeline_queue = this.timeline_queue.splice(this.timeline_queue.findIndex(tlfind),1);
}

MatrixTwitter.prototype.stop_timeline = function() {
    if (this.timeline_intervalID) {
        clearInterval(this.timeline_intervalID);
        this.timeline_intervalID = null;
    }
}

MatrixTwitter.prototype.start_timeline = function() {
    this.timeline_intervalID = setInterval(() => {this._process_timeline();}, this.timeline_period);
}

/*
  This function will fill the content structure for a new matrix message
  for a given tweet.
*/
MatrixTwitter.prototype.tweet_to_matrix_content = function(tweet, type) {
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
MatrixTwitter.prototype._process_head_of_msg_queue = function(){
  if(this.msg_queue.length > 0){
    var msg = this.msg_queue.pop();
    //log.info("Twitter","Pulling off queue:",msg.content.body);
    var intent = this._bridge.getIntent(msg.userId);
    intent.sendEvent(msg.roomId, msg.type, msg.content).then( (id) => {
      //TODO: Cache this for..reasons.
    });
  }
}

MatrixTwitter.prototype._push_to_msg_queue = function(muser,roomid,tweet,type){  
  var newmsg = {
    userId:muser,
    roomId:roomid,
    time:Date.parse(tweet.created_at),
    type:"m.room.message",
    content:this.tweet_to_matrix_content(tweet, type)
  };
  for(var m in this.msg_queue){
    if(newmsg.time > this.msg_queue[m].time){
      this.msg_queue.splice(m,0,newmsg);
      return;
    }
  }
  this.msg_queue.push(newmsg);
}

//Check user display name
//TODO: Check avatar. Probably with a stored key
MatrixTwitter.prototype._get_matrix_twitter_user = function(twitter_user){
  
  // var cli = intent.getClient();
  // var current_user = cli.getUserIdLocalpart() + ":" + this._bridge.opts.domain;
  // console.log(current_user);
  // cli.getProfileInfo(current_user,'displayname').then(info =>{
  //   console.log(info);
  //   var disp = tweet.user.name + " (@" + tweet.user.screen_name + ")";
  //   if(info.displayname != disp){
  //     intent.setDisplayName(disp);
  //   }
  // }).catch(err => {
  //   log.error("Twitter",err);
  // });
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
MatrixTwitter.prototype.process_tweet = function(roomid, tweet, depth) {
    depth--;
    
    var muser = "@twitter_" + tweet.user.id_str + ":" + this._bridge.opts.domain;
    var intent = this._bridge.getIntent(muser);
    
    var type = "m.text";
    if (tweet.in_reply_to_status_id_str != null) {
        type = "m.notice"; // A nicer way to show previous tweets
    }
    //log.info("Twitter","Processing tweet:",tweet.text);
    
    return new Promise( (resolve) => {
      if (tweet.in_reply_to_status_id_str != null && depth > 0) {
          this.app_twitter.get('statuses/show/' + tweet.in_reply_to_status_id_str, {}, (error, newtweet, response) => {
            if (!error) {
                var promise = this.process_tweet(roomid, newtweet, depth)
                if(promise != null){
                  return promise.then(() => {
                        resolve();
                  });
                }
                else{
                  resolve();
                }
            }
            else
            {
                log.error("process_tweet: GET /statuses/show returned: " + error);
            }
          });
      }
      else {
        resolve();
      }
    }).then(() => {
      
      this._update_user_timeline_profile(tweet.user);
      
      if(this.processed_tweets.contains(tweet.id_str)){
        log.info("Twitter","Repeated tweet detected, not processing");
        return;
      }
      
      this.processed_tweets.push(tweet.id_str);
      this._push_to_msg_queue(muser,roomid,tweet,type);
      return;
      
    });
}

/*
  Internal function to process the timeline queue.
*/
MatrixTwitter.prototype._process_timeline = function(self) {
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
          log.error("Twitter","_process_timeline: GET /statuses/user_timeline returned: %s", error.msg);
          return;
        }
        if (feed.length > 0) {
            if(this.msg_queue_intervalID != null){
              clearInterval(this.msg_queue_intervalID);
              this.msg_queue_intervalID = null;
            }
            tline.remote.set("twitter_since", feed[0].id_str);
            var promises = [];
            feed.reverse().forEach((item) => {
                promises.push(this.process_tweet(tline.local.roomId, item, 3));
            });
            Promise.all(promises).then(() =>{
              console.log("Done!");
              this._bridge.getRoomStore().setRemoteRoom(tline.remote);
              this.msg_queue_intervalID = setInterval(() => {this._process_head_of_msg_queue();}, TWITTER_MSG_QUEUE_INTERVAL_MS);
            });

        }
    });
    this.timeline_queue.push(tline);
}

MatrixTwitter.prototype.start_hashtag = function(){
  this.hashtag_intervalID = setInterval(() => {this._process_hashtag_feed();}, this.hashtag_period);
}

MatrixTwitter.prototype.stop_hashtag = function(){
    if (this.hashtag_intervalID) {
        clearInterval(this.hashtag_intervalID);
        this.hashtag_intervalID = null;
    }
}

MatrixTwitter.prototype.add_hashtag_feed = function(hashtag,localroom,remoteroom){
    var obj = {
        "hashtag": hashtag,
        "local": localroom,
        "remote": remoteroom
    };
    this.hashtag_list.push(obj);
    this.hashtag_queue.push(obj);
    log.info('Twitter',"Added Hashtag Feed: %s",hashtag);
}

MatrixTwitter.prototype.remove_hashtag_feed = function(hashtag,localroom,remoteroom){
  const htfind = (feed) => { feed.hashtag == hashtag };
  this.hashtag_list  = this.hashtag_list.splice( this.hashtag_list.findIndex(tlfind) ,1);
  this.hashtag_queue = this.hashtag_queue.splice(this.hashtag_queue.findIndex(tlfind),1);
}

MatrixTwitter.prototype._process_hashtag_feed = function(){
  if (this.hashtag_queue.length < 1) {
      return;
  }
  
  
  var feed = this.hashtag_queue.shift();
  var req = {
    q: "%23"+feed.hashtag,
    result_type: 'recent'
  };
  
  
  var since = feed.remote.get("twitter_since");
  if (since != undefined) {
      req.since_id = since;
  }
  
  this.app_twitter.get('search/tweets', req, (error, results, response) => {
      if(error){
        log.error("Twitter","_process_timeline: GET /statuses/user_timeline returned: %s", error);
        return;
      }
      if(results.statuses.length > 0){
        feed.remote.set("twitter_since", results.search_metadata.max_id_str);
        this._bridge.getRoomStore().setRemoteRoom(feed.remote);
      }
      
      results.statuses.reverse().forEach((item) => {
          this.process_tweet(feed.local.roomId, item, 0);
      });
  });
  this.hashtag_queue.push(feed);
}
//

MatrixTwitter.prototype.send_matrix_event_as_tweet = function(event,user,room){
  if(user == null){
    log.warn("Twitter","User tried to send a tweet without being known by the AS.");
    return;
  }
  if(event.content.msgtype == "m.text"){
    log.info("Twitter","Got message: %s",event.content.body);
    var text = event.content.body.substr(0,140);
    this.send_tweet_to_timeline(room,user,text);
  }
  else if(event.content.msgtype == "m.image"){
    log.info("Twitter","Got image: %s",event.content.body);
    //Get the url
    var url = event.content.url;
    if(url.startsWith("mxc://")){
      url = this._bridge.opts.homeserverUrl + "/_matrix/media/r0/download/" + url.substr("mxc://".length);
    }
    this._downloadImage(url).then((buffer) =>{
      return this.twitter.upload_media(user,buffer);
    }).then ((mediaId) => {
      this.send_tweet_to_timeline(room,user,"",{media:[mediaId]});
    }).catch(err => {
      log.error("Twitter","Failed to send image to timeline. %s", err);
    });    
  }
}

MatrixTwitter.prototype.attach_user_stream = function(ruser){
  return this._get_twitter_client(ruser).then((c) => {
    var stream = c.stream('user', {with: "user"});
    stream.on('data',  (data) => {
      if(data.hasOwnProperty("direct_message")){
        this._process_incoming_dm(data.direct_message);
      }
    });
    
    stream.on('error', function(error) {
     log.error("Twitter","Stream gave an error %s",error);
    });
  });
}

MatrixTwitter.prototype._process_incoming_dm = function(msg){
  //Find the room
  var users = [msg.sender_id_str,msg.recipient_id_str].sort();
  this._bridge.getRoomStore().getMatrixRoom({twitter_type:"dm",twitter_users:users}).then((room) => {
    //TODO: Check to see if the message exists.
    if(!room){
      var intent = this._bridge.getIntentFromLocalpart("twitter_" + msg.sender_id_str);
      log.info("Twitter.DM","Creating a new room for DMs from %s(%s) => %s(%s)",msg.sender_id_str,msg.sender_screen_name,msg.recipient_id_str,msg.recipient_screen_name);
      intent.createRoom(
        false,
        opts = {
            visibility: "private",
            room_alias_name: "twitterdm_#"+msg.sender_id_str+"_"+msg.recipient_id_str,
            invite:[
              "@twitter_" + msg.sender_id_str + ":" + this._bridge.opts.domain,
              "@twitter_" + msg.recipient_id_str + ":" + this._bridge.opts.domain
            ]
            //name: "[Twitter] DM "+,
            //topic: "Twitter feed for #"+name,
            // initial_state: [
            //     {
            //         "type": "m.room.join_rules",
            //         "content": {
            //             "join_rule": "public"
            //         },
            //         "state_key": ""
            //     }
            // ]
        }
      ).then(roomid => {
        var mroom = new MatrixRoom(roomid);
        mroom.set("twitter_type","dm");
        mroom.set("twitter_users",users);
        this._bridge.getRoomStore().setMatrixRoom(mroom);
        this._put_dm_in_room(roomid,msg);
      }).catch(err => {
        log.error("Twitter.DM","Failed to create DM room: %s",err);
      });
    }
    else{
        this._put_dm_in_room(room.roomId,msg);
    }
  });
}
    
//Send from sender to recipient
  MatrixTwitter.prototype._put_dm_in_room = function(room,msg){
  var intent = this._bridge.getIntentFromLocalpart("twitter_" + msg.sender_id_str);
  log.info("Twitter.DM","Attempting to send DM from %s(%s) => %s(%s)",msg.sender_id_str,msg.sender_screen_name,msg.recipient_id_str,msg.recipient_screen_name);
  intent.sendEvent(room.roomId, "m.text", msg.text).then( (id) => {
    //TODO: Cache this for....reasons
  });
}

module.exports = {
    MatrixTwitter: MatrixTwitter
}
