var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var Twitter    = require('twitter');
var log        = require('npmlog');
var OAuth      = require('oauth');
var TwitterHandler = require('./TwitterHandler.js').TwitterHandler;



/**
 * Construct a AccountServices.
 * This class is a handler for conversation between users and the bridge bot to
 * link accounts together
 *
 * @class
 * @extends {external:TwitterHandler}
 *
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 * @param  app_auth OAuth authentication information
 * @param  app_auth.consumer_key Twitter consumer key
 * @param  app_auth.consumer_secret Twitter consumer secret
 * @param  {TwitterDB}       storage
 * @param  {MatrixTwitter}   twitter
 */
var AccountServices = function (bridge, app_auth, storage, twitter) {
  TwitterHandler.call(this,bridge,null,"service");
  this._app_auth = app_auth;
  this._storage = storage;
  this._twitter = twitter;
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

AccountServices.prototype.processInvite = function (event, request, context){
  var intent = this._bridge.getIntent();
  var event = request.getData();
  intent.join(event.room_id).then( () => {
    var rroom = new RemoteRoom("service_"+event.sender);
    rroom.set("twitter_type", "service");
    this._bridge.getRoomStore().linkRooms(context.rooms.matrix,rroom);
    intent.sendMessage(event.room_id,{"body":"This bot can help you link/unlink your twitter account with the Matrix Twitter Bridge. If this was not your intention, please kick the bot.","msgtype":"m.text"});
    //Add the room to the list.
  });
};

AccountServices.prototype.processMessage = function (event, request, context){
  var intent = this._bridge.getIntent();
  if(event.content.body == "link account"){
    log.info("Handler.AccountServices",event.sender + " is requesting a twitter account link.");
    this._oauth_getUrl(event,event.sender).then( (url) =>{
      intent.sendMessage(event.room_id,{"body":"Go to "+url+" to receive your PIN, and then type it in below.","msgtype":"m.text"});
    }).catch(err => {
      log.error("Handler.AccountServices",err[0],err[1]);
      intent.sendMessage(event.room_id,{"body":"We are unable to process your request at this time.","msgtype":"m.text"});
    });
  }
  else if(event.content.body == "unlink account"){
    this._storage.remove_client_data(event.sender);
    this._storage.remove_timeline_room(event.sender);
    this._twitter.detach_user_stream(event.sender);
    intent.sendMessage(event.room_id,{"body":"Your account (if it was linked) is now unlinked from Matrix.","msgtype":"m.text"});
  }
  else if(isNumber(event.content.body)){
    this._storage.get_client_data(event.sender).then((client_data) => {
      var pin = event.content.body;
      log.info("Handler.AccountServices","User sent a pin in to auth with.");
      if(client_data == null){
        intent.sendMessage(event.room_id,{"body":"You must request access with 'link account' first.","msgtype":"m.text"});
        return;
      }
      this._oauth_getAccessToken(pin,client_data,event.sender).then((profile) => {
        intent.sendMessage(event.room_id,{"body":"All good. You should now be able to use your Twitter account on Matrix.","msgtype":"m.text"});
        this._twitter.create_user_timeline(event.sender,profile);
        this._twitter.attach_user_stream(event.sender);
      }).catch(err => {
        intent.sendMessage(event.room_id,{"body":"We couldn't verify this PIN :(. Maybe you typed it wrong or you might need to request it again.","msgtype":"m.text"});
        log.error("Handler.AccountServices","OAuth Access Token Failed:%s", err);
      });
    });
  }
}

AccountServices.prototype._oauth_getAccessToken = function (pin,client_data,id) {
  return new Promise((resolve,reject) => {
    if(client_data && client_data.oauth_token != "" && client_data.oauth_secret != ""){
      this._oauth.getOAuthAccessToken(client_data.oauth_token, client_data.oauth_secret, pin, (error,access_token,access_token_secret) =>{
        if(error){
          reject(error.statusCode + ": " + error.data);
        }
        client_data.access_token = access_token;
        client_data.access_token_secret = access_token_secret;
        client = new Twitter({
          consumer_key: this._app_auth.consumer_key,
          consumer_secret: this._app_auth.consumer_secret,
          access_token_key: client_data.access_token,
          access_token_secret: client_data.access_token_secret
        });
        client.get("account/verify_credentials",(error,profile) =>{
          if(error){
            log.error("Handler.AccountServices","We couldn't authenticate with the supplied access token for "+ id +". Look into this.");
            reject("Twitter account could not be authenticated.");
            return;
          }
          this._storage.set_client_data(id,profile.id,client_data);
          resolve(profile);
        });
      });
    }
    else {
      reject("User has no associated token request data");
    }
  });
}

AccountServices.prototype._oauth_getUrl = function(event,id){
  return new Promise((resolve,reject) => {
    this._oauth.getOAuthRequestToken({"x_auth_access_type":"dm"},(error, oAuthToken, oAuthTokenSecret, results) => {
      if(error){
        reject(["Couldn't get token for user.\n%s",error]);
      }
      var data = {
        oauth_token: oAuthToken,
        oauth_secret: oAuthTokenSecret,
        access_token: "",
        access_token_secret: ""
      }
      this._storage.set_client_data(id,"",data);
      var authURL = 'https://twitter.com/oauth/authenticate?oauth_token=' + oAuthToken;
      resolve(authURL);
    });
  });
}

function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

module.exports = {
    AccountServices: AccountServices
}
