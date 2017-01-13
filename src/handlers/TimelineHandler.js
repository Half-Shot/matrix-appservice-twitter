const log  = require('../logging.js');
const util  = require('../util.js');
const log  = util.logPrefix("Handler.Timeline");

const RemoteRoom  = require("matrix-appservice-bridge").RemoteRoom;

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
    entry.matrix.set("twitter_user", entry.remote.data.twitter_user);
    this._bridge.getRoomStore().upsertEntry(entry);
    this.twitter.timeline.add_timeline(
        entry.remote.data.twitter_user,
        entry.matrix.getId(),
        {is_new: true}
    );
  }

  processLeave (event, request, context) {
    var remote = context.rooms.remote;
    if( remote.data.twitter_type === "user_timeline" && remote.data.twitter_owner === event.sender ) {
      log.info("User %s left room. Leaving", event.sender);
      this.twitter.user_stream.detach(event.sender);
      var intent = this._bridge.getIntent();
      this.twitter.storage.remove_timeline_room(event.sender);
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
    this.twitter.status.send_matrix_event(
      event,
      context.senders.matrix,
      context.rooms.remotes
    ).catch(() => {
      log.info("Failed to send tweet.");
    });
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
    log.info("Looking up " + alias);
    var tuser;
    return this.twitter.get_profile_by_screenname(alias).then((tu) => {
      tuser = tu;
      if (tuser != null) {
        if (tuser.protected) {
          log.warn(tuser.screen_name + " is a protected account, so we can't read from it.");
          throw "User is protected, can't create timeline."
        }
        return;
      }
      log.warn(tuser.screen_name + " was not found.");
      throw "User not found";
    }).then(() => {
      log.info("User found, getting profile image");
      return util.uploadContentFromUrl(this._bridge, tuser.profile_image_url_https).then(obj =>{
        log.info("Got profile image, constructing room.");
        return this._constructTimelineRoom(tuser, alias, obj.mxc_url);
      })
    }).catch(reason =>{
      log.error("Couldn't create timeline room: ", reason);
    });
  }

  /*
    This will create a stream room for one user's timeline.
    The owner of this stream will receive a 75
    The bot will have 100
  */
  _constructTimelineRoom (user, alias, avatar) {
    var botID = this._bridge.getBot().getUserId();

    var roomOwner = "@_twitter_" + user.id_str + ":" + this._bridge.opts.domain;
    var users = {};
    users[botID] = 100;
    users[roomOwner] = 75;
    var powers = util.roomPowers(users);
    var remote = new RemoteRoom("timeline_" + user.id_str);
    remote.set("twitter_type", "timeline");
    remote.set("twitter_user", user.id_str);
    remote.set("twitter_exclude_replies", false);
    remote.set("twitter_bidirectional", true);
    var description = (user.description ? user.description : "") + ` | https://twitter.com/${user.screen_name}`;
    var opts = {
      visibility: "public",
      room_alias_name: "_twitter_@"+alias,
      name: "[Twitter] " + user.name,
      topic: description,
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
