var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var Twitter    = require('twitter');
var log        = require('npmlog');
var OAuth      = require('oauth');


/**
 * Construct an AccountServices object.
 * This class is a handler for conversation between users and the bridge bot to
 * link accounts together
 *
 * @class
 * @extends {external:TwitterHandler}
 * @param  {object} opts
 * @param  {matrix-appservice-bridge.Bridge}   opts.bridge
 * @param  {TwitterDB}       opts.storage
 * @param  {MatrixTwitter}   opts.twitter
 * @param  {object} opts.app_auth OAuth authentication information
 * @param  {string} opts.app_auth.consumer_key Twitter consumer key
 * @param  {string} opts.app_auth.consumer_secret Twitter consumer secret
 */
var AccountServices = function (opts) {
  this._bridge = opts.bridge;
  this._app_auth = opts.app_auth;
  this._storage = opts.storage;
  this._twitter = opts.twitter;
  this._oauth = new OAuth.OAuth(
    'https://api.twitter.com/oauth/request_token',
    'https://api.twitter.com/oauth/access_token',
    this._app_auth.consumer_key,
    this._app_auth.consumer_secret,
    '1.0A',
    "oob",
    'HMAC-SHA1'
  );
};

/**
 * processInvite - Handler for invites from a matrix user to a (presumably)
 * empty room. This will join the room and send some help text.
 * @param  {MatrixEvent} event   The event data of the request.
 * @param  {Request} request The request itself.
 * @param  {Context} context Context given by the appservice.
 */
AccountServices.prototype.processInvite = function (event, request, context) {
  log.info("Handler.AccountServices", "Got invite for %s from %s", event.room_id, event.sender);
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
    log.error("Handler.AccountServices", "Couldn't join service room. %s", err)
  });
};

AccountServices.prototype.processLeave = function (event, request, context) {
  log.info("Handler.AccountServices", "User %s left %s. Leaving", event.sender, event.room_id);
  var intent = this._bridge.getIntent();
  intent.leave(event.room_id).then(() =>{
    var roomstore = this._bridge.getRoomStore();
    roomstore.removeEntriesByRemoteRoomData(context.rooms.remote.data);
  });
}

/**
 * processMessage - Processing incoming commands from the matrix user.
 * @param  {MatrixEvent} event   The event data of the request.
 */
AccountServices.prototype.processMessage = function (event) {
  if(event.content.body == "link account") {
    this._beginLinkAccount(event.sender, event.room_id);
  }
  else if(event.content.body == "unlink account") {
    this._unlinkAccount(event);
  }
  else if(isStrInteger(event.content.body)) {
    this._processPIN(event);
  }
};


/**
 * _beginLinkAccount - Processes a users request to link their twitter account
 * with the bridge. This should return a authorisation link.
 *
 * @param  {string} sender  The user ID of the sender.
 * @param  {string} room_id The service room id .
 */
AccountServices.prototype._beginLinkAccount = function (sender, room_id) {
  var intent = this._bridge.getIntent();
  log.info("Handler.AccountServices", `${sender} is requesting a twitter account link.`);
  this._oauth_getUrl(sender).then( (url) =>{
    intent.sendMessage(room_id, {
      "body": `Go to ${url} to receive your PIN, and then type it in below.`,
      "msgtype": "m.text"
    });
  }).catch(err => {
    log.error("Handler.AccountServices", `Couldn't get authentication URL: ${err}` );
    intent.sendMessage(room_id, {
      "body": "We are unable to process your request at this time.",
      "msgtype": "m.text"
    });
  });
}

/**
 * _unlinkAccount - Processes a users request to unlink their twitter account
 * from the bridge.
 *
 * @param  {string} sender  The user ID of the sender.
 * @param  {string} room_id The service room id .
 */
AccountServices.prototype._unlinkAccount = function (sender, room_id) {
  var intent = this._bridge.getIntent();
  this._storage.remove_client_data(sender);
  this._storage.remove_timeline_room(sender);
  this._twitter.detach_user_stream(sender);
  intent.sendMessage(room_id, {
    "body": "Your account (if it was linked) is now unlinked from Matrix.",
    "msgtype": "m.text"
  });
}

/**
 * _processPIN - The user has pasted a pin from the authorisation link we
 *  provided.
 *
 * @param  {object} event The Matrix Event from the requesting user.
 */
AccountServices.prototype._processPIN = function (event) {
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
      this._twitter.attach_user_stream(event.sender);
    }).catch(err => {
      intent.sendMessage(event.room_id, {
        "body": "We couldn't verify this PIN :(. Maybe you typed it wrong or you"
             + "might need to request it again.",
        "msgtype": "m.text"
      });
      log.error("Handler.AccountServices", "OAuth Access Token Failed:%s", err);
    });
  });
}

AccountServices.prototype._oauth_getAccessToken = function (pin, client_data, id) {
  return new Promise((resolve, reject) => {
    if (!client_data || client_data.oauth_token == "" || client_data.oauth_secret == "") {
      reject("User has no associated token request data");
      return;
    }
    this._oauth.getOAuthAccessToken( client_data.oauth_token, client_data.oauth_secret, pin,
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
};

/**
 * _oauth_getUrl - Start the process of connecting an account to Twitter.
 *
 * @param  {string} id    The matrix user id wishing to authenticate.
 * @return {Promise<string|Error>}  A promise that will return an auth url or reject with nothing.
 */
AccountServices.prototype._oauth_getUrl = function (id) {
  return new Promise((resolve, reject) => {
    this._oauth.getOAuthRequestToken(
       /* 'x_auth_access_type' is used to specify the access level.
        * Valid options are:
        * read - Read from the API
        * write - read + make changes
        * dm - read+write + be able to send/read direct messages
        * */
      {"x_auth_access_type": "dm"},
      (error, oAuthToken, oAuthTokenSecret) => {
        if(error) {
          reject(error);
        }
        var data = {
          oauth_token: oAuthToken,
          oauth_secret: oAuthTokenSecret,
          access_token: "",
          access_token_secret: ""
        };
        this._storage.set_twitter_account(id, "", data).then(()=>{
          var authURL = 'https://twitter.com/oauth/authenticate?oauth_token=' + oAuthToken;
          resolve(authURL);
        }).catch((err) => {
          reject({msg: "Failed to store account information.", inner_error: err});
        });
      });
  });
};


/**
 * isStrInteger - Checks a string is a integer
 *
 * @param  {string} str
 * @return {bool}
 */
function isStrInteger (str) {
  return str.match(/[0-9]+/);
}

module.exports = {
  AccountServices: AccountServices
};
