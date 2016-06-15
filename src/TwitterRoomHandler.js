/*
  Hander for the many different types of rooms this AS will support.
  Types are as follows (which are tracked in 'twitter_type' in the remote rooms):
  'timeline' -  A room that tracks a singular users activities
  'service' -   A room that can link/unlink twitter accounts from users and
                provide general assistance.

*/

var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;

var AccountServices = require("./AccountServices.js").AccountServices;

var TwitterRoomHandler = function (bridge) {
  this._bridge = bridge;
  this._service_handler = new AccountServices(bridge); // 'service' handler
}

TwitterRoomHandler.prototype.processInvite = function (request, context){
  var remote = context.rooms.remote;
  var intent = this._bridge.getIntent();
  var event = request.getData();
  if(remote){
    var rtype = remote.data.extras.twitter_type;
    if(rtype == "timelime"){
      this._timeline_handler.processInvite(request, context);
      return;
    }
    //TODO: Deal with an invite to an existing room.
  }
  else
  {
    //Services bot
    this._service_handler.processInvite(request, context);
  }
  console.warn("Got an invite to something we cannot accept.");
  console.warn("Event data: ", event);
  intent.leave(event.room_id);
}

TwitterRoomHandler.prototype.passEvent = function (request, context){
  var event = request.getData();
  var remote = context.rooms.remote;
  if (event.type == "m.room.member" && event.membership == "invite"){
    this.processInvite(request,context);
  }
  
  if(remote){
    if(event.type == "m.room.message"){
      if(remote.data.extras.twitter_type == "service"){
        
      }
    }
  }
  else {
    console.log("Got message from a non-registered room.");
  }
  
  
}

module.exports = {
    TwitterRoomHandler: TwitterRoomHandler
}
