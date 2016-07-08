var log = require('npmlog');


/**
 * TwitterHandler - A extendable class to handle incoming requests. Any
 * functions called without being defined will display a STUB message.
 * @class
 * @param  {matrix-appservice-bridge.Bridge}   bridge
 * @param  {string} roomType  The value as specified in a rooms remote data
 * (twitter_type) to identify the nature of the room.
 * @param  {string} aliasPrefix The prefix *after* '#twitter_' to identify alias
 * requests.
 */
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

/**
 * TwitterHandler.prototype.processInvite - Handler for invites belonging to
 * a room of this handlers type. The handler should accept or reject the invite
 * before completing.
 *
 * @param  {object} event   The event data of the request.
 * @param  {object} request The request itself.
 * @param  {object} context Context given by the appservice.
 */
TwitterHandler.prototype.processInvite = function (event, request, context){
  log.warn("Handler","STUB processInvite");
  return;
};

/**
 * TwitterHandler.prototype.processMessage - Handler for events of type
 * 'm.room.message'. The handler does not have to act on these.
 *
 * @param  {object} event   The event data of the request.
 * @param  {object} request The request itself.
 * @param  {object} context Context given by the appservice.
 */
TwitterHandler.prototype.processMessage = function (event, request, context) {
  log.warn("Handler","STUB processMessage");
  return;
}

/**
 * TwitterHandler.prototype.processEvent - Handler for events not of type
 * 'm.room.message'. The handler does not have to act on these.
 *
 * @param  {object} event   The event data of the request.
 * @param  {object} request The request itself.
 * @param  {object} context Context given by the appservice.
 */
TwitterHandler.prototype.processEvent = function (event, request, context) {
  log.warn("Handler","STUB processEvent");
  return;
}

/**
 * TwitterHandler.prototype.processAliasQuery - A request to this handler to
 * provision a room for the given name *after* the global alias prefix.
 *
 * @param  {type} name The requested name *after* '#twitter_'
 * @return {ProvisionedRoom | Promise<ProvisionedRoom,Error>, null}
 */
TwitterHandler.prototype.processAliasQuery = function(name){
  log.warn("Handler","STUB processAliasQuery");
  return;
}


/**
 * TwitterHandler.prototype.onRoomCreated - The is called once a room provisoned
 * by processAliasQuery has been created.

 * @param  {string} alias
 * @param  {external:RoomBridgeStore.Entry} entry description
 */
TwitterHandler.prototype.onRoomCreated = function(alias,entry){
  log.warn("Handler","STUB onRoomCreated");
  return;
}

module.exports = {
    TwitterHandler: TwitterHandler
}
