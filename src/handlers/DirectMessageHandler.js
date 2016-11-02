const log = require('npmlog');

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
  constructor (bridge, twitter, storage) {
    this._bridge = bridge;
    this._storage = storage;
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
  processInvite (event, request, context) {
    var user_id = context.senders.matrix.getId();
    var sender, recipient, intentS, intentR = null;
    return this.twitter.dm.can_use(context.senders.matrix.getId(user_id)).then(() =>{
      //Get the senders account.
      return this._storage.get_profile_from_mxid(user_id);
    }).then(profile => {
      if(profile == null) {
        throw "No profile found for sender";
      }
      sender = profile;
      var remote_id = event.state_key.substr(0, event.state_key.indexOf(':')).substr("@_twitter_".length);
      return this.twitter.get_profile_by_id(remote_id);
    }).then(profile =>{
      if(profile == null) {
        throw "No profile found for recipient";
      }
      recipient = profile;
      intentS = this.twitter.get_intent(sender.id_str);
      intentR = this.twitter.get_intent(recipient.id_str);
      return this.twitter.dm.set_room(sender, recipient, event.room_id);
    }).then(()=>{
      return intentR.join(event.room_id);
    }).then(()=>{
      return intentR.invite(event.room_id, intentS.client.credentials.userId);
    }).then(()=>{
      return intentS.join(event.room_id);
    }).catch(err => {
      log.error("Handler.DirectMessage", "Failed to process an invite for a DM. %s", err);
    })

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
