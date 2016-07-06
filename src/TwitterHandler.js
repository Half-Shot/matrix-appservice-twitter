var log = require('npmlog');

var TwitterHandler = function (bridge, roomType, aliasPrefix) {
  this._bridge = bridge;
  this.aliasPrefix = "";
  this.roomType = "";
  if(typeof aliasPrefix == "string"){
    this.aliasPrefix = aliasPrefix;
  }
  if(typeof roomType == "string"){
    this.roomType = roomType;
  }
}

TwitterHandler.prototype.processInvite = function (event, request, context){
  log.warn("Handler","STUB processInfo");
  return;
};

TwitterHandler.prototype.processMessage = function (event, request, context) {
  log.warn("Handler","STUB processMessage");
  return;//No invites
}

TwitterHandler.prototype.processEvent = function (event, request, context) {
  log.warn("Handler","STUB processEvent");
  return;//No invites
}

TwitterHandler.prototype.processAliasQuery = function(name){
  log.warn("Handler","STUB processAliasQuery");
  return;//No invites
}

module.exports = {
    TwitterHandler: TwitterHandler
}
