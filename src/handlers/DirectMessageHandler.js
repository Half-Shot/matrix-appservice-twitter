/**
 * Handler for direct messages sent from users
 * to the appservice
 */
class DirectMessageHandler {

  /**
   * DirectMessageHandler - Handler for direct messages sent from users
   * to the appservice
   * @class
   * @param  {MatrixTwitter}   twitter
   * @param  {matrix-appservice-bridge.Bridge}   bridge
   */
  constructor (bridge, twitter) {
    this._bridge;
    this.twitter = twitter;
  }

  /**
   * processInvite - Handler for invites from a matrix user to a
   * empty room.
   * This will join the room and set up the appropriate DM.
   * @param  {MatrixEvent} event   The event data of the request.
   * @param  {Request} request The request itself.
   * @param  {Context} context Context given by the appservice.
   */
  processInvite () {//event, request, context) {

  }

  /**
   * processMessage - Handler for messages intended to
   * be sent to the linked- Twitter DM conversation.
   *
   * @param  {MatrixEvent} event   The event data of the request.
   */
  processMessage  (event) {
    if(event.content.msgtype == "m.text") {
      this.twitter.dm.send(event.sender, event.room_id, event.content.body);
    }
  }

}


module.exports = DirectMessageHandler;
