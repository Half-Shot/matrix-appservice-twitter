var log  = require('npmlog');
var http = require('http');
var Buffer  = require("buffer").Buffer;

var RemoteRoom  = require("matrix-appservice-bridge").RemoteRoom;
var MatrixRoom  = require("matrix-appservice-bridge").MatrixRoom;

var TimelineHandler = function (bridge, twitter) {
  this._bridge = bridge;
  this.twitter = twitter;
}

TimelineHandler.prototype.processInvite = function (event, request, context) {
  log.info("Handler.Timeline","Got invite for a timeline");
  if (event.state_key.startsWith("@twitter_"))
  { //We should prolly use a regex
      if (event.membership == "invite")
      {
          var intent = this._bridge.getIntent(event.state_key);
          intent.join(event.room_id);

          //Set the avatar based on the 'owners' avatar.
          intent.getClient().getProfileInfo(event.state_key, 'avatar_url').then((content) =>
          {

              if (typeof content.avatar_url != "string")
              {
                  log.error("Handler.Timeline","User", event.state_key, "does not have an avatar set. This is unexpected.");
                  console.log(content);
                  return;
              }

              log.info("Handler.Timeline","Set Room Avatar:", content.avatar_url);
              intent.sendStateEvent(event.room_id, "m.room.avatar", "",
              {
                  "url": content.avatar_url
              });
          });

          if (context.rooms.remote != null)
          {
              this.twitter.add_timeline(event.state_key, context.rooms.matrix, context.rooms.remote);
              return;
          }
          log.warn("Handler.Timeline","Couldn't find the remote room for this timeline.");
      }
      else if(event.membership == "leave"){
        log.warn("Handler.Timeline", event.sender + " left " + event.room_id);
        
        //var users = getRoomMembers(event.room_id);
        //for(var user of users){
        //  console.log(user);
        //}
      }
    }
}

TimelineHandler.prototype.processMessage = function (event, request, context) {
  if(context.senders.remote == null){
    log.warn("Handler.Timeline","User tried to send a tweet without being known by the AS.");
    return;
  }
  if(event.content.msgtype == "m.text"){
    log.info("Handler.Timeline","Got message: %s",event.content.body);
    var text = event.content.body.substr(0,140);
    this.twitter.send_tweet_to_timeline(context.rooms.remote,context.senders.remote,text);
  }
  else if(event.content.msgtype == "m.image"){
    log.info("Handler.Timeline","Got image: %s",event.content.body);
    //Get the url
    var url = event.content.url;
    if(url.startsWith("mxc://")){
      url = this._bridge.opts.homeserverUrl + "/_matrix/media/r0/download/" + url.substr("mxc://".length);
    }
    this._downloadImage(url).then((buffer) =>{
      return this.twitter.upload_media(context.senders.remote,buffer);
    }).then ((mediaId) => {
      console.log(mediaId);
      this.twitter.send_tweet_to_timeline(context.rooms.remote,context.senders.remote,"",{media:[mediaId]});
    }).catch(err => {
      log.error("Handler.Timeline","Failed to send image to timeline.");
      console.error(error);
    });    
  }
}

TimelineHandler.prototype.processEvent = function (event, request, context) {
  //We do nothing yet with events
}

TimelineHandler.prototype.processAliasQuery = function(alias){
  //Create the room
  log.info("Handler.TimelineHandler","Looking up " + alias);
  return this.twitter.get_user(alias).then((tuser) => {
      if (tuser != null) {
          if (!tuser.protected) {
              return this._constructTimelineRoom(tuser, alias);
          }
          log.info("Handler.Timeline",tuser.screen_name + " is a protected account, so we can't read from it.");
      }
      log.info("Handler.Timeline",tuser.screen_name + " was not found.");
      
  });
}
/*
  This will create a stream room for one user's timeline.
  Users who are not authenticated via OAuth will receive the default power of 0
  Users who are authenticated via Oauth will receive a power level of 10
  The owner of this stream will receive a 75
  The bot will have 100
*/

TimelineHandler.prototype._constructTimelineRoom = function(user, alias) {
    console.log(user);
    var botID = this._bridge.getBot().getUserId();

    var roomOwner = "@twitter_" + user.id_str + ":" + this._bridge.opts.domain;
    var users = {};
    users[botID] = 100;
    users[roomOwner] = 75;
    var powers = roomPowers(users);
    var remote = new RemoteRoom("timeline_" + user.id_str);
    remote.set("twitter_type", "timeline");
    remote.set("twitter_user", roomOwner);
    this._bridge.getRoomStore().setRemoteRoom(remote);
    
    opts = {
        visibility: "public",
        room_alias_name: "twitter_@"+alias,
        name: "[Twitter] " + user.name,
        topic: user.description,
        invite: [roomOwner],
        initial_state: [
            powers, {
                "type": "m.room.join_rules",
                "content": {
                    "join_rule": "public"
                },
                "state_key": ""
            }, {
                "type": "org.matrix.twitter.data",
                "content": user,
                "state_key": ""
            }
        ]
    };
    return {
        creationOpts: opts,
        remote: remote
    };
}

//Download an image and return it's data.
TimelineHandler.prototype._downloadImage = function(url){
  return new Promise((resolve, reject) => {
      http.get((url), (res) => {
          var size = parseInt(res.headers["content-length_downloadImage"]);
          var buffer = Buffer.alloc(size);
          var bsize = 0;
          res.on('data', (d) => {
              d.copy(buffer, bsize);
              bsize += d.length;
          });
          res.on('error', () => {
              reject("Failed to download.");
          });
          res.on('end', () => {
              resolve(buffer);
          });
      })
  });
}

function roomPowers(users) {
    return {
        "content": {
            "ban": 50,
            "events": {
                "m.room.name": 100,
                "m.room.power_levels": 100,
                "m.room.topic": 100,
                "m.room.join_rules": 100,
                "m.room.avatar": 100,
                "m.room.aliases": 75,
                "m.room.canonical_alias": 75
            },
            "events_default": 10,
            "kick": 75,
            "redact": 75,
            "state_default": 0,
            "users": users,
            "users_default": 10
        },
        "state_key": "",
        "type": "m.room.power_levels"
    };
}


module.exports = {
    TimelineHandler: TimelineHandler
}
