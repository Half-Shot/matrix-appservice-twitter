const log  = require('../logging.js');
const Bridge = require("matrix-appservice-bridge");
const Promise = require('bluebird');

/**
  Handler class for sending and recieving DMs.
*/
class DirectMessage {
  constructor (twitter) {
    this.twitter = twitter;
    this._sent_dms = new Map();  //This will contain the body of the DM posted to a room to avoid reposting it.
  }

  can_use (user_id) {
    if(user_id == null) {
      return Promise.reject("User isn't known by the AS");
    }
    return this.twitter.storage.get_twitter_account(user_id).then((account) => {
      if(account == null) {
        throw "Matrix account isn't linked to any twitter account.";
      }
      else if (account.access_type !== "dm") {
        throw  {
          "notify": "Your account doesn't have the correct permission level to send tweets.",
          "error": `Account only has ${account.access_type} permissions.`
        }
      }
      else{
        return;
      }
    });
  }

  set_room (sender, recipient, room_id) {
    var users = [sender.id_str, recipient.id_str].sort().join(';');
    return this.twitter.storage.get_dm_room(users).then(room_id =>{
      if(room_id) {
        return this.twitter.storage.remove_dm_room(users);
      }
      return;
    }).then(() => {
      return this.twitter.storage.add_dm_room(room_id, users).then(() => {
        var mroom = new Bridge.MatrixRoom(room_id);
        var rroom = new Bridge.RemoteRoom("dm_"+users);
        rroom.set("twitter_type", "dm");
        this.twitter.bridge.getRoomStore().linkRooms(mroom, rroom);
        return room_id;
      });
    });
  }

  get_room (sender, recipient) {
    var users = [sender.id_str, recipient.id_str].sort().join(';');
    return this.twitter.storage.get_dm_room(users).then(room_id =>{
      if(room_id) {
        return room_id;
      }
      return this._create_dm_room(users).then(room => {
        return this.set_room(sender, recipient, room.room_id);
      });
    }).catch(reason =>{
      throw "Couldn't create/get new room. " + reason;
    });
  }

  process_dm (msg) {
    const users = [msg.sender.id_str, msg.recipient.id_str].sort().join(';');

    this.twitter.update_profile(msg.sender);
    this.twitter.update_profile(msg.recipient);

    if(this._sent_dms.get(users) === msg.id_str) {
      log.verbose("DM has already been processed, ignoring.");
      return;
    }

    return this.get_room(msg.sender, msg.recipient).then(room_id => {
      this._put_dm_in_room(room_id, msg);
    }).catch(reason =>{
      log.error("Couldn't process incoming DM: %s", reason);
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
        throw `User ${user_id} tried to send a DM to ${room_id} but the room was not found in
the DB. This shouldn't happen.`;
      }
      return this.twitter.client_factory.get_client(user_id);
    }).then(client => {
      var ausers = users.split(';');
      ausers.splice(ausers.indexOf(client.profile.id_str), 1);
      var otheruser = ausers[0];
      log.info(
        "Sending DM from %s(%s) => %s",
        client.profile.id_str,
        client.profile.screen_name,
        otheruser
      );

      return client.postAsync("direct_messages/new", {user_id: otheruser, text: text}).then(msg => {
        this._sent_dms.set(users, msg.id_str);

      }).catch( error => {
        throw "direct_messages/new failed. Reason: " + error;
      });
    }).catch(reason =>{
      log.error("Failed to send DM: %s", reason);
    });
  }

  _put_dm_in_room (room_id, msg) {
    var intent = this.twitter.get_intent(msg.sender.id_str);

    log.verbose(
      "Recieved DM from %s(%s) => %s(%s)",
      msg.sender.id_str, msg.sender.screen_name,
      msg.recipient.id_str,
      msg.recipient.screen_name
    );
    intent.sendMessage(room_id, {"msgtype": "m.text", "body": msg.text});
  }

  _create_dm_room (sender, recipient) {
    log.info(
      "Creating a new room for DMs from %s(%s) => %s(%s)",
      sender.id_str,
      sender.screen_name,
      recipient.id_str,
      recipient.screen_name
    );
    return Promise.all([
      this.twitter.storage.get_matrixid_from_twitterid(sender.id_str),
      this.twitter.storage.get_matrixid_from_twitterid(recipient.id_str)
    ]).then(user_ids =>{
      var invitees = new Set([
        "@_twitter_" + sender.id_str + ":" + this.twitter.bridge.opts.domain,
        "@_twitter_" + recipient.id_str + ":" + this.twitter.bridge.opts.domain
      ]);
      for(var user_id of user_ids) {
        if(user_id != null) {
          invitees.add(user_id);
        }
      }
      return [...invitees];
    }).then(invitees => {
      var intent = this.twitter.get_intent(sender.id_str);
      return intent.createRoom(
        {
          createAsClient: true,
          options: {
            invite: invitees,
            is_direct: true,
            name: "[Twitter] DM "+sender.screen_name+" : "+recipient.screen_name,
            visibility: "private",
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
