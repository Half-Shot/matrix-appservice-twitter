var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var Twitter    = require('twitter');
var log        = require('npmlog');
var OAuth      = require('oauth');



var AccountServices = function (bridge, app_auth) {
  this._bridge = bridge;
  this._app_auth = app_auth;
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
  var event = request.getData();
  if(event.content.body == "link account"){
    log.info("Handler.AccountServices",event.sender + " is requesting a twitter account link.");
    var remoteSender = context.senders.remote;
    if(!remoteSender){
      remoteSender = new RemoteUser("twitter_M"+event.sender);
      remoteSender.set("twitter_oauth",null);
      this._bridge.getUserStore().linkUsers(context.senders.matrix,remoteSender);
    }
    
    //Stage 1- Get a URL
    var oauthState = remoteSender.get("twitter_oauth");
    this._oauth_getUrl(event,remoteSender).then( (url) =>{
      var intent = this._bridge.getIntent();
      intent.sendMessage(event.room_id,{"body":"Go to "+url+" to receive your PIN, and then type it in below.","msgtype":"m.text"});
    }).catch(err => {
      log.error("Handler.AccountServices",err[0],err[1]);
      intent.sendMessage(event.room_id,{"body":"We are unable to process your request at this time.","msgtype":"m.text"});
    });
  }
  else if(isNumber(event.content.body)){
    var pin = event.content.body;
    log.info("Handler.AccountServices","User sent a pin in to auth with.");
    var remoteSender = context.senders.remote;
    if(!remoteSender){
      intent.sendMessage(event.room_id,{"body":"You must request access with 'link account' first.","msgtype":"m.text"});
      return;
    }
    var intent = this._bridge.getIntent();
    this._oauth_getAccessToken(pin,remoteSender).then(() => {
      intent.sendMessage(event.room_id,{"body":"All good. You should now be able to use your twitter account on matrix.","msgtype":"m.text"});
    }).catch(err => {
      intent.sendMessage(event.room_id,{"body":"We couldn't verify this PIN :(. Maybe you typed it wrong or you might need to request it again.","msgtype":"m.text"});
      log.error("Handler.AccountServices","OAuth Access Token Failed:%s", err);
    });
  }
}

AccountServices.prototype._oauth_getAccessToken = function (pin,remoteUser) {
  return new Promise((resolve,reject) => {
    var data = remoteUser.get("twitter_oauth");
    if(data && data.oauth_token != "" && data.oauth_secret != ""){
      this._oauth.getOAuthAccessToken(data.oauth_token, data.oauth_secret, pin, (error,access_token,access_token_secret) =>{
        if(error){
          reject(error);
        }
        data.access_token = access_token;
        data.access_token_secret = access_token_secret;
        remoteUser.set("twitter_oauth",data);
        this._bridge.getUserStore().setRemoteUser(remoteUser);
        resolve();
      });
    }
    reject("User has no associated token request data");
  });
}

AccountServices.prototype._oauth_getUrl = function(event,remoteUser){
  return new Promise((resolve,reject) => {
    this._oauth.getOAuthRequestToken({"x_auth_access_type":"write"},(error, oAuthToken, oAuthTokenSecret, results) => {
      if(error){
        reject(["Couldn't get token for user.\n%s",error]);
      }
      remoteUser.set("twitter_oauth",{"oauth_token":oAuthToken,"oauth_secret":oAuthTokenSecret});
      this._bridge.getUserStore().setRemoteUser(remoteUser);
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
