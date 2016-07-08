var log  = require('npmlog');
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var TwitterHandler = require('./TwitterHandler.js').TwitterHandler;

/**
 * HashtagHandler - Handler for hashtag room creation and messaging
 * @class
 * @extends {external:TwitterHandler}
 *
 * @param  {MatrixTwitter}   twitter
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 */
var HashtagHandler = function (bridge, twitter) {
  TwitterHandler.call(this,bridge,"#","hashtag");
  this.twitter = twitter;
}

HashtagHandler.prototype.onRoomCreated = function (alias,entry){
  console.log(entry);
  this.twitter.add_hashtag_feed(
    entry.remote.getId().substr("hashtag_".length),
    entry
  );
}

HashtagHandler.prototype.processMessage = function (event, request, context) {
    this.twitter.send_matrix_event_as_tweet(event,context.senders.matrix,context.rooms.remote);
}

HashtagHandler.prototype.processAliasQuery = function(name){
  log.info("Handler.Hashtag","Got alias request ''%s'",name);
  var botID = this._bridge.getBot().getUserId();

  var remote = new RemoteRoom("hashtag_" + name);
  remote.set("twitter_type", "hashtag");

  opts = {
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
  };
  return {
      creationOpts: opts,
      remote: remote
  };
}

module.exports = {
    HashtagHandler: HashtagHandler
}
