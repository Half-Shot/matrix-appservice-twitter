var TwitterHandler = require('./TwitterHandler.js').TwitterHandler;

/**
 * DirectMessage - Handler for direct messages sent from users to the appservice
 * @class
 * @extends {external:TwitterHandler}
 * @param  {MatrixTwitter}   twitter
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 */
var DirectMessage = function (bridge, twitter) {
  TwitterHandler.call(this, bridge);
  this.twitter = twitter;
}

DirectMessage.prototype.processMessage = function (event) {
    if(event.content.msgtype == "m.text"){
      this.twitter.send_dm(event.sender, event.room_id, event.content.body);
    }
}

/*
* TODO: Support initiating DMs to users.
* We might decide to to this via directly PMing a user.
*/

module.exports = {
    DirectMessageHandler: DirectMessage
}
