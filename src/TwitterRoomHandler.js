/*
  Hander for the many different types of rooms this AS will support.
  Types are as follows (which are tracked in 'twitter_type' in the remote rooms):
  'timeline' -  A room that tracks a singular users activities
  'service' -   A room that can link/unlink twitter accounts from users and
                provide general assistance.

*/
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var log = require('npmlog');

var TwitterRoomHandler = function (bridge, config, handlers) {
  this._bridge = bridge;
  this.handlers = handlers; // 'service' handler
}

TwitterRoomHandler.prototype.processInvite = function (event,request, context){
  var remote = context.rooms.remote;
  var intent = this._bridge.getIntent();
  
  if(remote){
    var rtype = remote.data.twitter_type;
    if(rtype == "timeline"){
      this.handlers.timeline.processInvite(event,request, context);
      return;
    }
    //TODO: Deal with an invite to an existing room.
  }
  else if(event.state_key.startsWith("@twitter") && event.state_key.endsWith(":"+this._bridge.opts.domain)){
    return;//Invite to user that wasn't linked up. Ignoring.
  }
  else
  {
    //Services bot
    this.handlers.services.processInvite(event, request, context);
    return;
  }
  log.info("RoomHandler","Got an invite to something we cannot accept.");
  console.warn("Event data: ", event);
  //intent.leave(event.room_id);
}

TwitterRoomHandler.prototype.passEvent = function (request, context){
  var event = request.getData();
  var remote = context.rooms.remote;
  if (event.type == "m.room.member" && event.membership == "invite"){
    this.processInvite(event,request,context);
  }
  
  if(remote){
    if(event.type == "m.room.message"){
      console.log(remote.data);
      if(remote.data.twitter_type == "service"){
        this.handlers.services.processMessage(event,request,context);
        return;
      }
      else if(remote.data.twitter_type == "timeline"){
        this.handlers.timeline.processMessage(event,request,context);
        return;
      }
    }
    
    if(remote.data.twitter_type == "hashtag"){
      this.handlers.hashtag.processEvent(event,request,context);
    }
  }
  log.info("RoomHandler","Got message from a non-registered room.");
}

TwitterRoomHandler.prototype.processAliasQuery = function(alias, aliasLocalpart){
  var type = aliasLocalpart.substr("twitter_".length,1);
  var part = aliasLocalpart.substr("twitter_.".length);
  
  if(type == '@'){ //User timeline
    return this.handlers.timeline.processAliasQuery(part);
  }
  else if(type == '#') { //Hashtag
    return this.handlers.hashtag.processAliasQuery(part);
  }
  else {
    //Unknown
    return null;
  }
}

module.exports = {
    TwitterRoomHandler: TwitterRoomHandler
}
