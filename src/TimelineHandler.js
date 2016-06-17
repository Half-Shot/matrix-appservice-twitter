var log = require('npmlog');

var TimelineHandler = function (bridge, twitter) {
  this._bridge = bridge;
  this.twitter = twitter;
}

TimelineHandler.prototype.processInvite = function (event, request, context) {
  var event = request.getData();
  console.log("Got invite for a timeline");
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
                  console.error("User", event.state_key, "does not have an avatar set. This is unexpected.");
                  console.log(content);
                  return;
              }

              console.log("Set Room Avatar:", content.avatar_url);
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
          console.log("Couldn't find the remote room for this timeline.");
      }
      else if(event.membership == "leave"){
        log.warn("Timeline", event.sender + " left " + event.room_id);
        
        //var users = getRoomMembers(event.room_id);
        //for(var user of users){
        //  console.log(user);
        //}
      }
    }
}

TimelineHandler.prototype.processMessage = function (event, request, context) {
  if(context.senders.remote == null){
    log.warn("Timeline","User tried to send a tweet without being known by the AS.");
    return;
  }
  log.info("Timeline","Got message: %s",event.content.body);
  var text = event.content.body.substr(0,140);
  this.twitter.send_tweet_to_timeline(context.rooms.remote,context.senders.remote,text);
}

TimelineHandler.prototype.passEvent = function (event, request, context) {
  
}

module.exports = {
    TimelineHandler: TimelineHandler
}
