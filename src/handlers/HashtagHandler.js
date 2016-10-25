const log  = require('npmlog');
const RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;

/**
 * Handler for hashtag room creation and messaging
 */
class HashtagHandler {

  /**
  * @param  {MatrixTwitter}   twitter
  * @param  {matrix-appservice-bridge.Bridge}   bridge
  */
  constructor (bridge, twitter) {
    this._bridge = bridge;
    this.twitter = twitter;
  }

  /**
   * This is called once a room provisoned by processAliasQuery
   * has been created.

   * @param  {string} alias
   * @param  {external:RoomBridgeStore.Entry} entry description
   */
  onRoomCreated (alias, entry) {
    this.twitter.timeline.add_hashtag(
      entry.remote.getId().substr("hashtag_".length),
      entry.matrix.getId(),
      true
    );
  }

  /**
   * Handler for events of type 'm.room.message'. If an account
   * is linked, a tweet will be sent with the rooms hastag prepended.
   *
   * @param  {object} event   The event data of the request.
   * @param  {object} request The request itself.
   * @param  {object} context Context given by the appservice.
   */
  processMessage (event, request, context) {
    this.twitter.send_matrix_event_as_tweet(
        event,
        context.senders.matrix,
        context.rooms.remote
      );
  }

  /**
   * A request to this handler to provision a room for the
   * given name *after* the global alias prefix.
   *
   * @param  {type} name The requested name *after* '#twitter_'
   * @return {?ProvisionedRoom}
   */
  processAliasQuery (name) {
    log.info("Handler.Hashtag", "Got alias request '%s'", name);

    if(/^[a-z0-9]+$/i.test(name) == false) {
      return null; //Not alphanumeric
    }

    var remote = new RemoteRoom("hashtag_" + name);
    remote.set("twitter_type", "hashtag");
    remote.set("twitter_bidirectional", true);

    return {
      creationOpts: {
        visibility: "public",
        room_alias_name: "_twitter_#"+name,
        name: "[Twitter] #"+name,
        topic: "Twitter feed for #"+name,
        initial_state: [
          {
            "type": "m.room.join_rules",
            "content": {
              "join_rule": "public"
            },
            "state_key": ""
          }
        ]
      },
      remote: remote
    };
  }
}








module.exports = HashtagHandler;
