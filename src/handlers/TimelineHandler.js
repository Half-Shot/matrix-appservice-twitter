const log  = require('npmlog');
const util  = require('../util.js');
const RemoteRoom  = require("matrix-appservice-bridge").RemoteRoom;

function roomPowers (users) {
  return {
    "content": {
      "ban": 50,
      "events": {
        "m.room.name": 100,
        "m.room.power_levels": 100,
        "m.room.topic": 100,
        "m.room.join_rules": 100,
        "m.room.avatar": 100,
        "m.room.aliases": 75,
        "m.room.canonical_alias": 75
      },
      "events_default": 10,
      "kick": 75,
      "redact": 75,
      "state_default": 0,
      "users": users,
      "users_default": 10
    },
    "state_key": "",
    "type": "m.room.power_levels"
  };
}

/**
 * TimelineHandler - Handler for timeline room creation and messaging
 */
class TimelineHandler {
  /**
  * @param  {MatrixTwitter}   twitter
  * @param  {matrix-appservice-bridge.Bridge}   bridge
  */
  constructor (bridge, twitter) {
    this._bridge = bridge;
    this.twitter = twitter;
  }

  /**
   * onRoomCreated - The is called once a room provisoned
   * by processAliasQuery has been created.

   * @param  {string} alias
   * @param  {external:RoomBridgeStore.Entry} entry description
   */
  onRoomCreated (alias, entry) {
    this.twitter.timeline.add_timeline(
        entry.remote.data.twitter_user,
        entry.matrix.getId()
    );
  }

  processLeave (event, request, context) {
    var remote = context.rooms.remote;
    if( remote.data.twitter_type == "user_timeline" && remote.data.twitter_owner == event.sender ) {
      log.info("Handler.AccountServices", "User %s left room. Leaving", event.sender);
      this.twitter.user_stream.detach(event.sender);
      var intent = this._bridge.getIntent();
      intent.leave(event.room_id).then(() =>{
        var roomstore = this._bridge.getRoomStore();
        roomstore.removeEntriesByRemoteRoomData(context.rooms.remote.data);
      });
    }
  }

  /**
   * TwitterHandler.prototype.processMessage - Handler for events of type
   * 'm.room.message'. The handler does not have to act on these.
   *
   * @param  {object} event   The event data of the request.
   * @param  {object} request The request itself.
   * @param  {object} context Context given by the appservice.
   */
  processMessage (event, request, context) {
    this.twitter.send_matrix_event_as_tweet(event, context.senders.matrix, context.rooms.remote);
  }

  /**
   * TwitterHandler.prototype.processAliasQuery - A request to this handler to
   * provision a room for the given name *after* the global alias prefix.
   *
   * @param  {type} name The requested name *after* '#twitter_'
   * @return {ProvisionedRoom | Promise<ProvisionedRoom,Error>, null}
   */
  processAliasQuery (alias) {
    //Create the room
    log.info("Handler.TimelineHandler", "Looking up " + alias);
    var tuser;
    return this.twitter.get_user_by_screenname(alias).then((tu) => {
      tuser = tu;
      if (tuser != null) {
        if (tuser.protected) {
          log.warn("Handler.Timeline", tuser.screen_name + " is a protected account, so we can't read from it.");
          throw "User is protected, can't create timeline."
        }
        return;
      }
      log.warn("Handler.Timeline", tuser.screen_name + " was not found.");
      throw "User not found";
    }).then(() => {
      log.info("Handler.TimelineHandler", "User found, getting profile image");
      return util.uploadContentFromUrl(this._bridge, tuser.profile_image_url_https).then(mxc_url =>{
        log.info("Handler.TimelineHandler", "Got profile image, constructing room.");
        return this._constructTimelineRoom(tuser, alias, mxc_url);
      })
    }).catch(reason =>{
      log.error("Twitter", "Couldn't create timeline room: ", reason);
    });
  }

  /*
    This will create a stream room for one user's timeline.
    The owner of this stream will receive a 75
    The bot will have 100
  */
  _constructTimelineRoom (user, alias, avatar) {
    var botID = this._bridge.getBot().getUserId();

    var roomOwner = "@twitter_" + user.id_str + ":" + this._bridge.opts.domain;
    var users = {};
    users[botID] = 100;
    users[roomOwner] = 75;
    var powers = roomPowers(users);
    var remote = new RemoteRoom("timeline_" + user.id_str);
    remote.set("twitter_type", "timeline");
    remote.set("twitter_user", roomOwner);

    var opts = {
      visibility: "public",
      room_alias_name: "twitter_@"+alias,
      name: "[Twitter] " + user.name,
      topic: user.description,
      invite: [roomOwner],
      initial_state: [
        powers, {
          "type": "m.room.join_rules",
          "content": {
            "join_rule": "public"
          },
          "state_key": ""
        }, {
          "type": "org.matrix.twitter.data",
          "content": user,
          "state_key": ""
        }, {
          "type": "m.room.avatar",
          "state_key": "",
          "content": {
            "url": avatar
          }
        }
      ]
    };
    return {
      creationOpts: opts,
      remote: remote
    };
  }
}

module.exports = TimelineHandler;
