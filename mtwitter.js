var Twitter = require('twitter');
var Request = require('request');
var fs = require('fs');
var Buffer = require('buffer').Buffer;

var TWITTER_PROFILE_INTERVAL = 60000;

var mtwitter = function(bridge,config){
  this.app_auth = config.app_auth;
  this.app_twitter = null;
  this.tuser_cache = {};
  this.timeline_list = [];
  this.timeline_queue = [];
  this.timeline_period = 0;
  this.timeline_intervalobj = null;
  this._bridge = bridge;
  this.get_bearer_token = function(cb){
    
    try{
      fs.accessSync('bearer.tok',fs.R_OK);
      var tok = fs.readFileSync('bearer.tok', 'utf8');
      cb(tok);
      return;
    }
    catch(e){
      console.log("Bearer token either does not exist or cannot be read, getting a new token.")
    }
    
    var key = this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret;
    key = Buffer.from(this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret,'ascii').toString('base64');
    var options = {
      url: "https://api.twitter.com/oauth2/token",
      headers: {
        'Authorization': "Basic " +  key
      },
      form: "grant_type=client_credentials",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8"
    };
    Request.post(options,function (error,response,body){
      if(error){
          console.log("Error",error);
          return false;
      } else {
          try{
            var jsonresponse = JSON.parse(body);
            if(jsonresponse.token_type == "bearer"){
              fs.writeFile("bearer.tok",jsonresponse.access_token, (err) => {
                if(err){
                  console.console.error("Couldn't write bearer token to file.");
                }
              });
              cb(jsonresponse.bearer_token);
            } 
            else {
              console.error("Error getting bearer token: Unexpected response");
              cb(null);
            }
          }
          catch(e){
            console.error("Error getting bearer token:",e);
            cb(null);
          }

      }
    });
  }
  
  this.get_bearer_token((bt) => {
    if(bt != false){
      this.app_auth.bearer_token = bt;
      console.log("Twitter Application Auth OK!");
      this.app_twitter = new Twitter(this.app_auth);
    }
    else {
      console.error("Twitter Application Failed Auth. The bridge will be operating in a limited capacity.");
    }
  });

  this.get_user_by_id = function(id,cb){
    var ts = new Date().getTime();
    for(var name in this.tuser_cache){
      var cached = this.tuser_cache[name];
      if(ts - cached.cache_time > TWITTER_PROFILE_INTERVAL){
        continue;
      }
      if(cached.user != null){
        if(cached.user.id_str == id){
          cb(cached.user);
          return;
        }
      }
    }
    
    this.app_twitter.get('users/show',{user_id : id}, function(error, user, response){
      if(error){
        console.error(error);
        cb(null);
      }
      else {
        twit.tuser_cache[user.screen_name] = {cache_time:ts,user:user};
        cb(user);
      }
    })
    
  }
  
  this.get_user = function(name,cb){
    console.log("Looking up @" + name);
    var ts = new Date().getTime();
    if(this.tuser_cache[name] != undefined){
      console.log("Using cache");
      var cached = this.tuser_cache[name];
      if(ts - cached.cache_time < TWITTER_PROFILE_INTERVAL){
        return cached.user;
      }
    }
    var twit = this;
    this.app_twitter.get('users/show',{screen_name: name}, function(error, user, response){
      if(error){
        console.error(error);
        twit.tuser_cache[name] = {cache_time:ts,user:null};
        cb(null);
      }
      else {
        twit.tuser_cache[name] = {cache_time:ts,user:user};
        cb(user);
      }
    });
  }
  
  this.enqueue_timeline = (userid,localroom,remoteroom) => {
    var obj = {"user_id":userid,"local":localroom,"remote":remoteroom};
    this.timeline_list.push(obj);
    this.timeline_queue.push(obj);
  }
  
  this.process_timeline = () => {
    if(this.timeline_queue < 1){
      return;
    }
    var tline = this.timeline_queue[0];
    this.timeline_queue = this.timeline_queue.slice(1);
    var id = tline.remote.getId().substr(9);
    
    var req = {user_id : id,count: 3};
    var since = tline.remote.get("twitter_since");
    if(since != undefined){
      req.since_id = since;
    }
    
    var bridge = this._bridge
    this.app_twitter.get('statuses/user_timeline',req, function(error, feed, response){
      if(!error){
        if(feed.length > 0){
          var intent = bridge.getIntent(tline.user_id);
          tline.remote.set("twitter_since",feed[0].id_str);
          feed = feed.reverse();
          for(var item in feed){
            intent.sendText(tline.local.roomId,feed[item].text);//TODO: We need to make sure not to spam the HS 
          }
          bridge.getRoomStore().setRemoteRoom(tline.remote);
        }
      }
      else {
          console.error(error);
      }
    });
    this.timeline_queue.push(tline);
  }
  
  this.stop_timeline = () => {
    if(this.timeline_intervalobj){
      clearInterval(this.timeline_intervalobj);
      this.timeline_intervalobj = null;
    }
  }
  
  this.start_timeline = () => {
    this.timeline_period = 3050; //Twitter allows 300 calls per 15 minute (We add 50 milliseconds for a little safety).
    this.timeline_intervalobj = setInterval(this.process_timeline,this.timeline_period);
  }
}

// this.init: function(config){
//   this._twitter = new Twitter({
//     consumer_key: '',
//     consumer_secret: '',
//     bearer_token: ''
//   });
// }
// get_user: function(name){
//   return {
//     name: name
//   };
// }

module.exports = {
    MatrixTwitter: mtwitter
}
