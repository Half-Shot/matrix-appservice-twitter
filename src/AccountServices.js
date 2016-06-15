var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;

var AccountServices = function (bridge) {
  this._bridge = bridge;
}

AccountServices.prototype.processInvite = function (request, context){
  var intent = this._bridge.getIntent();
  var event = request.getData();
  intent.join(event.room_id).then( () => {
    var rroom = new RemoteRoom("service_"+event.sender);
    this._bridge.getRoomStore().linkRooms(context.rooms.matrix,rroom);
    rroom.set("twitter_type", "service");
    intent.sendMessage(event.room_id,{"body":"This bot can help you link/unlink your twitter account with the Matrix Twitter Bridge. If this was not your intention, please kick the bot.","msgtype":"m.text"});
    //Add the room to the list.
  });
};

AccountServices.prototype.processMessage = function (request, context){
  var event = request.getData();
  console.log("Got Service Event: ", event);
}

module.exports = {
    AccountServices: AccountServices
}
