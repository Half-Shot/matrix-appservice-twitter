const log  = require('npmlog');
const ProcessedTweetList = require("./ProcessedTweetList.js");
const Bridge = require("matrix-appservice-bridge");

/**
  Handler class for sending and recieving DMs.
*/
class DirectMessage {
  constructor (twitter) {
    this.twitter = twitter;
    this._sent_dms = new ProcessedTweetList(1, 1);  //This will contain the body of the DM posted to a room to avoid reposting it.
  }

  process_dm (msg) {
    var users = [msg.sender_id_str, msg.recipient_id_str].sort().join('');

    this.twitter.update_profile(msg.sender);
    this.twitter.update_profile(msg.recipient);

    if(this._sent_dms.contains(users, msg.text)) {
      log.info("DirectMessage", "DM has already been processed, ignoring.");
      return;
    }

    this.twitter.storage.get_dm_room(users).then(room_id =>{
      if(room_id) {
        this._put_dm_in_room(room_id, msg);
        return;
      }
      //Create a new room.
      return this._create_dm_room(msg).then(room => {
        return this.twitter.storage.add_dm_room(room.room_id, users).then(() =>{
          var mroom = new Bridge.MatrixRoom(room.room_id);
          var rroom = new Bridge.RemoteRoom("dm_"+users);
          rroom.set("twitter_type", "dm");
          this.twitter.bridge.getRoomStore().linkRooms(mroom, rroom);
          this._put_dm_in_room(room.room_id, msg);
        });
      });
    }).catch(reason =>{
      log.error("DirectMessage", "Couldn't create room. Reason: " + reason);
    });
  }

  /**
   * Send a DM on the users behalf. The room_id should be a DM room which has
   * been set up for the user in advance.
   * @param  {string} user_id    The user trying to send the message.
   * @param  {string} room_id    The DM room that the message was sent from.
   * @param  {string} text       The body text of the message.
   * @return {Promise}           A promise that will resolve when the operation
   * completes
   */
  send (user_id, room_id, text) {
    //Get the users from the room
    var users = "";
    return this.twitter.storage.get_users_from_dm_room(room_id).then(u =>{
      users = u;
      if(users == null) {
        log.error(
          "DirectMessage",
          ("User (%s) tried to send a DM to (%s) but the room was not found in" +
           + "the DB. This shouldn't happen."),
          user_id, room_id
        );
      }
      return this.twitter.client_factory.get_client(user_id);
    }).then(client => {
      var otheruser = users.replace(client.profile.id_str, "");
      log.info(
        "DirectMessage",
        "Sending DM from %s(%s) => %s",
        client.profile.id_str,
        client.profile.screen_name,
        otheruser
      );
      this._sent_dms.push(users, text);
      client.post("direct_messages/new", {user_id: otheruser, text: text}, (error) =>{
        if(error) {
          log.error("DirectMessage", "direct_messages/new failed. Reason: %s", error);
        }
      });
    }).catch(reason =>{
      log.error("DirectMessage", "Failed to send DM: %s", reason);
    });
  }

  _put_dm_in_room (room_id, msg) {
    var intent = this.twitter.get_intent(msg.sender_id_str);
    log.info(
      "DirectMessage",
      "Recieved DM from %s(%s) => %s(%s)",
      msg.sender_id_str, msg.sender_screen_name,
      msg.recipient_id_str,
      msg.recipient_screen_name
    );
    intent.sendMessage(room_id, {"msgtype": "m.text", "body": msg.text});
  }

  _create_dm_room (msg) {
    log.info(
      "DirectMessage",
      "Creating a new room for DMs from %s(%s) => %s(%s)",
      msg.sender_id_str,
      msg.sender_screen_name,
      msg.recipient_id_str,
      msg.recipient_screen_name
    );
    return Promise.all([
      this.twitter.storage.get_matrixid_from_twitterid(msg.sender_id_str),
      this.twitter.storage.get_matrixid_from_twitterid(msg.recipient_id_str)
    ]).then(user_ids =>{
      var invitees = new Set([
        "@_twitter_" + msg.recipient_id_str + ":" + this._bridge.opts.domain
      ]);
      for(var user_id of user_ids) {
        if(user_id != null) {
          invitees.add(user_id);
        }
      }
      return [...invitees];
    }).then(invitees => {
      var intent = this.twitter.get_intent(msg.sender_id_str);
      return intent.createRoom(
        {
          createAsClient: true,
          options: {
            invite: invitees,
            name: "[Twitter] DM "+msg.sender_screen_name+":"+msg.recipient_screen_name,
            visibility: "private",
            //topic: "Twitter feed for #"+name,
            initial_state: [
              {
                "type": "m.room.join_rules",
                "content": {
                  "join_rule": "invite"
                },
                "state_key": ""
              }
            ]
          }
        }
      );
    });
  }

}

module.exports = DirectMessage;
