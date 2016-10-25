const RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
const MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;
const Twitter = require('twitter');
const log = require('npmlog');
const OAuth = require('oauth');
const util = require('../util.js');

/**
  * This class is a handler for conversation between users and the bridge bot to
  * link accounts together
  */
class AccountServices {
  /**
   * @param  {object} opts
   * @param  {matrix-appservice-bridge.Bridge}   opts.bridge
   * @param  {TwitterDB}       opts.storage
   * @param  {MatrixTwitter}   opts.twitter
   * @param  {object} opts.app_auth OAuth authentication information
   * @param  {string} app_auth.consumer_key Twitter consumer key
   * @param  {string} app_auth.consumer_secret Twitter consumer secret
   */
  constructor (opts) {
    this._bridge = opts.bridge;
    this._app_auth = opts.app_auth;
    this._storage = opts.storage;
    this._twitter = opts.twitter;
    this._sender_localpart = opts.sender_localpart;
    this._oauth = new OAuth.OAuth(
      'https://api.twitter.com/oauth/request_token',
      'https://api.twitter.com/oauth/access_token',
      this._app_auth.consumer_key,
      this._app_auth.consumer_secret,
      '1.0A',
      "oob",
      'HMAC-SHA1'
    );
  }

  /**
   * Handler for invites from a matrix user to a (presumably)
   * empty room. This will join the room and send some help text.
   * @param  {MatrixEvent} event   The event data of the request.
   * @param  {Request} request The request itself.
   * @param  {Context} context Context given by the appservice.
   */
  processInvite (event, request, context) {
    log.info("Handler.AccountServices", "Got invite");
    var intent = this._bridge.getIntent();
    intent.join(event.room_id).then( () => {
      var rroom = new RemoteRoom("service_"+event.sender);
      rroom.set("twitter_type", "service");
      this._bridge.getRoomStore().linkRooms(context.rooms.matrix, rroom);
      intent.sendMessage(event.room_id,
        {
          "body": "This bot can help you link/unlink your twitter account with the " +
          "Matrix Twitter Bridge. If this was not your intention, please kick the bot.",
          "msgtype": "m.text"
        }
      );
      //Add the room to the list.
    }).catch(err => {
      log.error("Handler.AccountServices", "Couldn't join service room. %s", err);
    })
  }

  processLeave (event, request, context) {
    log.info("Handler.AccountServices", "User %s left room. Leaving", event.sender);
    var intent = this._bridge.getIntent();
    intent.leave(event.room_id).then(() =>{
      var roomstore = this._bridge.getRoomStore();
      roomstore.removeEntriesByRemoteRoomData(context.rooms.remote.data);
    });
  }

  /**
   * Processing incoming commands from the matrix user.
   * @param  {MatrixEvent} event   The event data of the request.
   */
  processMessage (event) {
    const body = event.content.body.toLowerCase();
    if (event.sender == "@"+this._sender_localpart+":" + this._bridge.opts.domain) {
      return;//Don't talk to ourselves.
    }
    if (body.startsWith("account.link")) {
      this._beginLinkAccount(event);
    }
    else if (body == "account.unlink") {
      this._unlinkAccount(event);
    }
    else if (body == "account.list") {
      this._listAccountDetails(event);
    }
    else if(body.startsWith("bridge.room")) {
      this._bridgeRoom(event);
    }
    else if(body.startsWith("bridge.unbridge")) {

    }
    else if(body.startsWith("bridge.unbridge_all")) {

    }
    else if(body.startsWith("timeline.filter")) {
      this._setFilter(event);
    }
    else if(body.startsWith("timeline.replies")) {
      this._setReplies(event);
    }
    else if (event.content.body == "help") {
      this._helpText(event.room_id);
    }
    else if (util.isStrInteger(event.content.body)) {
      this._processPIN(event);
    }
  }

  _helpText (room_id) {
    var intent = this._bridge.getIntent();
    intent.sendMessage(room_id, {
      "msgtype": "m.text",
      "body":
`Matrix Twitter Bridge Help
account.link [type]  Link your Twitter account to your Matrix Account
'read' Read-only access to your account. Reading your Timeline.
'write' Read and Write such as sending Tweets from rooms.
'dm' Read and Write to 1:1 DM rooms. This is the god mode.

account.unlink   Removes your account from the bridge. All personal rooms will cease to function.

account.list     List details about your account.

bridge.room [room_id] [twitter_feed]    Bridge an existing room to a @ or #. The room *must* be public.

bridge.unbridge [room_id] [twitter_feed]

bridge.unbridge_all [room_id]

timeline.filter [option] Filter the type of tweets coming in. Defaults to 'followings'
'followings' - gives data about the user and about the user’s followings.
'user' - events only about the user, not about their followings.

timeline.replies [option]
'all'
'mutual'
help  This help text.`
    });
  }

  _listAccountDetails (event) {
    const account = {
      timeline_settings: "[Not implemented yet]"
    };
    const intent = this._bridge.getIntent();
    this._storage.get_twitter_account(event.sender).then(a => {
      if(a == null) {
        throw "No account linked.";
      }
      account.access_type = a.access_type;
      return this._twitter.get_profile_by_id(a.twitter_id);
    }).then(profile => {
      if(profile) {
        account.screenname = profile.screen_name;
      }
      else {
        account.screename = "[Unknown]";
      }
      return this._storage.get_timeline_room(event.sender);
    }).then(room => {
      account.timeline_room = room.room_id;
      return Promise.resolve("[Not implemented yet]");
    }).then(dm_rooms => {
      intent.sendMessage(event.room_id, {
        "msgtype": "m.text",
        "body":
`Linked Twitter Account: ${account.screenname}
Access Type: ${account.access_type}
Timeline Room: ${account.timeline_room}
Timeline Settings: ${account.timeline_settings}
DM Rooms:
${dm_rooms}`
      });
    }).catch(err => {
      log.warn("Handler.AccountServices", "Encountered an error trying to get profile information. %s", err);
      intent.sendMessage(event.room_id, {
        "msgtype": "m.text",
        "body": err
      });
    })
  }

  /**
   * Processes a users request to link their twitter account
   * with the bridge. This should return a authorisation link.
   *
   * @param  {object} event The Matrix Event from the requesting user.
   */
  _beginLinkAccount (event) {
    var intent = this._bridge.getIntent();
    var access_type = event.content.body.substr("link account ".length);
    access_type = access_type.length > 0 ? access_type : "read";
    log.info("Handler.AccountServices",
    `${event.sender} is requesting a twitter account link (${access_type} access).`
    );
    this._oauth_getUrl(event.sender, access_type).then( (url) =>{
      intent.sendMessage(event.room_id, {
        "body": `Go to ${url} to receive your PIN, and then type it in below.`,
        "msgtype": "m.text"
      });
    }).catch(err => {
      log.error("Handler.AccountServices", `Couldn't get authentication URL: ${err}` );
      intent.sendMessage(event.room_id, {
        "body": "We are unable to process your request at this time. Make sure you entered the command correctly.",
        "msgtype": "m.text"
      });
    });
  }

  /**
   * Processes a users request to unlink their twitter account
   * from the bridge.
   *
   * @param  {object} event The Matrix Event from the requesting user.
   */
  _unlinkAccount (event) {
    var intent = this._bridge.getIntent();
    this._storage.remove_client_data(event.sender);
    this._storage.remove_timeline_room(event.sender);
    this._twitter.user_stream.detach(event.sender);
    intent.sendMessage(event.room_id, {
      "body": "Your account (if it was linked) is now unlinked from Matrix.",
      "msgtype": "m.text"
    });
  }

  /**
   * The user has given a pin from the authorisation link we
   * provided.
   *
   * @param  {object} event The Matrix Event from the requesting user.
   */
  _processPIN (event) {
    var intent = this._bridge.getIntent();
    this._storage.get_twitter_account(event.sender).then((client_data) => {
      var pin = event.content.body;
      log.info("Handler.AccountServices", `${event.sender} sent a pin (${pin}) to auth with.`);
      if(client_data == null) {
        intent.sendMessage(event.room_id, {
          "body": "You must request access with 'link account' first.",
          "msgtype": "m.text"
        });
        return;
      }
      this._oauth_getAccessToken(pin, client_data, event.sender).then((profile) => {
        intent.sendMessage(event.room_id, {
          "body": "All good. You should now be able to use your Twitter account on Matrix.",
          "msgtype": "m.text"
        });
        this._twitter.create_user_timeline(event.sender, profile);
        this._twitter.user_stream.attach(event.sender);
      }).catch(err => {
        intent.sendMessage(event.room_id, {
          "body": "We couldn't verify this PIN :(. Maybe you typed it wrong or you"
              + " might need to request it again.",
          "msgtype": "m.text"
        });
        log.error("Handler.AccountServices", "OAuth Access Token Failed:%s", err);
      });
    });
  }


  /**
   * description Verify the pin with Twitter and get an access token.
   *
   * @param  {string} pin         User supplied pin code.
   * @param  {object} client_data OAuth data for the user.
   * @param  {int} id          Twitter profile ID
   * @return {Promise<object>}             description
   */
  _oauth_getAccessToken (pin, client_data, id) {
    return new Promise((resolve, reject) => {
      if (!client_data || client_data.oauth_token == "" || client_data.oauth_secret == "") {
        reject("User has no associated token request data");
        return;
      }
      this._oauth.getOAuthAccessToken(
        client_data.oauth_token,
        client_data.oauth_secret,
        pin,
        (error, access_token, access_token_secret) =>{
          if(error) {
            reject(error.statusCode + ": " + error.data);
            return;
          }
          client_data.access_token = access_token;
          client_data.access_token_secret = access_token_secret;
          var client = new Twitter({
            consumer_key: this._app_auth.consumer_key,
            consumer_secret: this._app_auth.consumer_secret,
            access_token_key: client_data.access_token,
            access_token_secret: client_data.access_token_secret
          });
          client.get("account/verify_credentials", (error, profile) =>{
            if(error) {
              log.error("Handler.AccountServices", `We couldn't authenticate with `
            +`the supplied access token for ${id}. ${error}`);
              reject("Twitter account could not be authenticated.");
              return;
            }
            this._storage.set_twitter_account(id, profile.id, client_data).then(() =>{
              resolve(profile);
            }).catch(() => {
              reject("Failed to store account information.")
            })
          });
        });
    });
  }

  /**
   * _oauth_getUrl - Start the process of connecting an account to Twitter.
   *
   * @param  {type}   id    The matrix user id wishing to authenticate.
   * @param  {string} access_type The type of access to register for. One of read, write, dm
   * @return {Promise<string>}  A promise that will return an auth url or reject with nothing.
   */
  _oauth_getUrl (id, access_type) {
    if(!['read', 'write', 'dm'].includes(access_type)) {
      throw "None or invalid access_type given to OAuth.";
    }
    return new Promise((resolve, reject) => {
      this._oauth.getOAuthRequestToken(
          /* 'x_auth_access_type' is used to specify the access level.
           * Valid options are:
           * read - Read from the API
           * write - read + make changes
           * dm - read+write + be able to send/read direct messages
           * */
         {"x_auth_access_type": access_type},
         (error, oAuthToken, oAuthTokenSecret) => {
           if(error) {
             reject(error);
             return;
           }
           //We are modifying the data. So make sure to detach the rooms first.
           this._twitter.user_stream.detach(id);
           var data = {
             oauth_token: oAuthToken,
             oauth_secret: oAuthTokenSecret,
             access_token: null,
             access_token_secret: null,
             access_type: access_type
           };
           this._storage.set_twitter_account(id, "", data).then(()=>{
             var authURL = 'https://twitter.com/oauth/authenticate?oauth_token=' + oAuthToken;
             resolve(authURL);
           }).catch(() => {
             reject("Failed to store account information.");
           });
         });
    });
  }

  _bridgeRoom (event) {
    var args = event.content.body.split(" ");
    if(args.length < 3) {
      return;//Not enough args.
    }

    const room_id = args[1];
    const feed_id = args[2];
    const intent = this._bridge.getIntent();
    const get_room = new Promise(() => {
      if(!util.isRoomId(room_id)) {
        throw "RoomID was in the wrong format";
      }
      return intent.join(room_id).catch(err =>{
        log.warn("Handler.AccountServices", "Couldn't verify a room exists for bridging %s", err);
        throw "Unable to verify that the room exists."
      })

    });

    const get_twitter_feed = new Promise((resolve, reject) => {
      if(feed_id[0] === '#' && util.isAlphanumeric(feed_id.substr(1))) {
        resolve(feed_id.substr(1));//hashtag
      }
      else if(feed_id[0] === '@') {
        resolve(this._twitter.get_profile_by_screenname(feed_id.substr(1)));
      }
      else{
        reject("You need to specify a valid Twitter username or hashtag.");
      }
    }).then(item => {
      var remote;
      if(typeof item == "string") {
        remote = new RemoteRoom("hashtag_" + item);
        remote.set("twitter_type", "hashtag");
        this._twitter.timeline.add_hashtag(item, room_id);
      }
      else if(typeof item == "object") {
        console.log(item);
        remote = new RemoteRoom("timeline_" + item.id_str);
        remote.set("twitter_type", "timeline");
        remote.set("twitter_user", item.id);
        this._twitter.timeline.add_timeline(item.id, room_id);
      }
      else {
        throw "Unable to find Twitter feed.";
      }
      this._bridge.getRoomStore().linkRooms(new MatrixRoom(room_id), remote);

    })

    return Promise.all([get_room, get_twitter_feed]).then(() => {
      intent.sendMessage(event.room_id, {
        "msgtype": "m.notice",
        "body": "The room is now bridged to " + feed_id
      });
    }).catch(err => {
      intent.sendMessage(event.room_id, {
        "msgtype": "m.text",
        "body": err
      });
    });

  }

  _setFilter (event) {
    const intent = this._bridge.getIntent();
    var option = event.content.body.substr("timeline.filter ".length);
    if(['followings', 'user'].indexOf(option) == -1) {
      intent.sendMessage(event.room_id, {
        "msgtype": "m.text",
        "body": "Please select one of: followings, user."
      });
      return;
    }
    this._storage.get_timeline_room(event.sender).then(room => {
      if(room == null) {
        intent.sendMessage(event.room_id, {
          "msgtype": "m.text",
          "body": "Your account isn't linked yet."
        });
        return;
      }
      this._storage.set_timeline_with_option(room.room_id, option ).then(() => {
        this._twitter.user_stream.detach(event.sender);
        this._twitter.user_stream.attach(event.sender);
      });
    });
  }

  _setReplies (event) {
    const intent = this._bridge.getIntent();
    var option = event.content.body.substr("timeline.replies ".length);
    if(['all', 'mutual'].indexOf(option) == -1) {
      intent.sendMessage(event.room_id, {
        "msgtype": "m.text",
        "body": "Please select one of: followings, user."
      });
      return;
    }
    this._storage.get_timeline_room(event.sender).then(room => {
      if(room == null) {
        intent.sendMessage(event.room_id, {
          "msgtype": "m.text",
          "body": "Your account isn't linked yet."
        });
        return;
      }
      this._storage.set_timeline_replies_option(room.room_id, option ).then(() => {
        this._twitter.user_stream.detach(event.sender);
        this._twitter.user_stream.attach(event.sender);
      });
    });
  }
}

module.exports = AccountServices;
