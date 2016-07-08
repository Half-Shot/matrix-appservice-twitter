var log  = require('npmlog');
var Buffer  = require("buffer").Buffer;

var RemoteRoom  = require("matrix-appservice-bridge").RemoteRoom;
var MatrixRoom  = require("matrix-appservice-bridge").MatrixRoom;
var TwitterHandler = require('./TwitterHandler.js').TwitterHandler;

/**
 * TimelineHandler - Handler for timeline room creation and messaging
 * @class
 * @extends {external:TwitterHandler}
 *
 * @param  {MatrixTwitter}   twitter
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 */
var TimelineHandler = function (bridge, twitter) {
  TwitterHandler.call(this,bridge,"@","timeline");
  this.twitter = twitter;
}


TimelineHandler.prototype.onRoomCreated = function(alias,entry){
    var owner = entry.remote.data.twitter_user;
    var intent = this._bridge.getIntent(owner);
    intent.getClient().getProfileInfo(owner, 'avatar_url').then((content) =>
    {
        if (typeof content.avatar_url != "string")
        {
            log.error("Handler.Timeline","User", owner, "does not have an avatar set. This is unexpected.");
            return;
        }
        log.info("Handler.Timeline","Set Room Avatar:", content.avatar_url);
        intent.sendStateEvent(entry.matrix.getId(), "m.room.avatar", "",
        {
            "url": content.avatar_url
        });
    });

    this.twitter.add_timeline(
      entry.remote.data.twitter_user,
      entry
    );
}

TimelineHandler.prototype.processMessage = function (event, request, context) {
  this.twitter.send_matrix_event_as_tweet(event,context.senders.matrix,context.rooms.remote);
}

TimelineHandler.prototype.processAliasQuery = function(alias){
  //Create the room
  log.info("Handler.TimelineHandler","Looking up " + alias);
  return this.twitter.get_user_by_screenname(alias).then((tuser) => {
      if (tuser != null) {
          if (!tuser.protected) {
              return this._constructTimelineRoom(tuser, alias);
          }
          log.warn("Handler.Timeline",tuser.screen_name + " is a protected account, so we can't read from it.");
      }
      log.warn("Handler.Timeline",tuser.screen_name + " was not found.");

  }).catch(reason =>{
    log.error("Twitter","Couldn't create timeline room: ",reason);
  });
}

/*
  This will create a stream room for one user's timeline.
  Users who are not authenticated via OAuth will receive the default power of 0
  Users who are authenticated via Oauth will receive a power level of 10
  The owner of this stream will receive a 75
  The bot will have 100
*/
TimelineHandler.prototype._constructTimelineRoom = function(user, alias) {
    var botID = this._bridge.getBot().getUserId();

    var roomOwner = "@twitter_" + user.id_str + ":" + this._bridge.opts.domain;
    var users = {};
    users[botID] = 100;
    users[roomOwner] = 75;
    var powers = roomPowers(users);
    var remote = new RemoteRoom("timeline_" + user.id_str);
    remote.set("twitter_type", "timeline");
    remote.set("twitter_user", roomOwner);

    opts = {
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
            }
        ]
    };
    return {
        creationOpts: opts,
        remote: remote
    };
}

function roomPowers(users) {
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


module.exports = {
    TimelineHandler: TimelineHandler
}
