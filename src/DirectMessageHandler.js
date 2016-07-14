
/**
 * DirectMessageHandler - Handler for direct messages sent from users
 * to the appservice
 * @class
 * @extends {external:TwitterHandler}
 * @param  {MatrixTwitter}   twitter
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 */
var DirectMessageHandler = function (bridge, twitter) {
  this._bridge;
  this.twitter = twitter;
}

/**
 * processMessage - Handler for messages intended to
 * be sent to the linked- Twitter DM conversation.
 *
 * @param  {MatrixEvent} event   The event data of the request.
 */
DirectMessageHandler.prototype.processMessage = function (event) {
  if(event.content.msgtype == "m.text") {
    this.twitter.send_dm(event.sender, event.room_id, event.content.body);
  }
}

/*
* TODO: Support initiating DMs to users.
* We might decide to do this via directly PMing a bridge user.
*/

module.exports = {
  DirectMessageHandler: DirectMessageHandler
}
