var log  = require('npmlog');
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var TwitterHandler = require('./TwitterHandler.js').TwitterHandler;

var DirectMessage = function (bridge, twitter) {
  TwitterHandler.call(this,bridge);
  this.twitter = twitter;
}

DirectMessage.prototype.processMessage = function (event, request, context) {
    if(event.content.msgtype == "m.text"){
      this.twitter.send_dm(event.sender,event.room_id,event.content.body);
    }
}

DirectMessage.prototype.processAliasQuery = function(name){
  //TODO: Support initiating DMs to users.
  // We might decide to to this via directly PMing a user.
  log.info("Handler.DirectMessage","Got alias request");
  console.log(name);
  return null;
}

module.exports = {
    DirectMessageHandler: DirectMessage
}
