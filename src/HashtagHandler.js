var log  = require('npmlog');
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;

/**
 * HashtagHandler - Handler for hashtag room creation and messaging
 * @class
 * @extends {external:TwitterHandler}
 *
 * @param  {MatrixTwitter}   twitter
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 */
var HashtagHandler = function (bridge, twitter) {
  this._bridge = bridge;
  this.twitter = twitter;
}

/**
 * onRoomCreated - This is called once a room provisoned by processAliasQuery
 * has been created.

 * @param  {string} alias
 * @param  {external:RoomBridgeStore.Entry} entry description
 */
HashtagHandler.prototype.onRoomCreated = function (alias, entry) {
  this.twitter.add_hashtag_feed(
    entry.remote.getId().substr("hashtag_".length),
    entry
  );
}

/**
 * processMessage - Handler for events of type 'm.room.message'. If an account
 * is linked, a tweet will be sent with the rooms hastag prepended.
 *
 * @param  {object} event   The event data of the request.
 * @param  {object} request The request itself.
 * @param  {object} context Context given by the appservice.
 */
HashtagHandler.prototype.processMessage = function (event, request, context) {
  this.twitter.send_matrix_event_as_tweet(
      event,
      context.senders.matrix,
      context.rooms.remote
    );
}


/**
 * processAliasQuery - A request to this handler to provision a room for the
 * given name *after* the global alias prefix.
 *
 * @param  {type} name The requested name *after* '#twitter_'
 * @return {ProvisionedRoom | Promise<ProvisionedRoom,Error>, null}
 */
HashtagHandler.prototype.processAliasQuery = function (name) {
  log.info("Handler.Hashtag", "Got alias request ''%s'", name);

  if(/^[a-z0-9]+$/i.test(name) == false) {
    return null; //Not alphanumeric
  }

  var remote = new RemoteRoom("hashtag_" + name);
  remote.set("twitter_type", "hashtag");

  return {
    creationOpts: {
      visibility: "public",
      room_alias_name: "twitter_#"+name,
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

module.exports = {
  HashtagHandler: HashtagHandler
}
