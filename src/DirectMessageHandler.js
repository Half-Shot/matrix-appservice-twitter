var log  = require('npmlog');
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var TwitterHandler = require('./TwitterHandler.js').TwitterHandler;

var DirectMessage = function (bridge, twitter) {
  TwitterHandler.call(this,bridge);
  this.twitter = twitter;
}


DirectMessage.prototype.processInvite = function (event, request, context) {
  return;//No invites
}

DirectMessage.prototype.processMessage = function (event, request, context) {
    //this.twitter.send_matrix_event_as_tweet(event,context.senders.remote,context.rooms.remote);
    if(event.content.msgtype == "m.text"){
      this.twitter.send_dm(event.sender,event.room_id,event.content.body);
    }
}

DirectMessage.prototype.processEvent = function (event, request, context) {
  // if(event.type == "m.room.aliases" && event.sender.startsWith("@twitbot")){
  //   this.twitter.add_hashtag_feed(
  //     context.rooms.remote.roomId.substr("hashtag_".length),
  //     context.rooms.matrix,
  //     context.rooms.remote
  //   );
  // }
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
