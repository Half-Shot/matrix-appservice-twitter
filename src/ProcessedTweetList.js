/**
 * ProcessedTweetList - Stores tweets/dms by room_id so we don't accidentally
 * repeat any messages. Please note that the cache and slice size values are
 * per room, not the total size of all stored rooms.
 *
 * @class
 * @param  {number} [128] cacheSize How many messages to store before cleanup occurs
 * @param  {number} [16] sliceSize On cleanup, how many messages will be kept
 */
var ProcessedTweetList = function (cacheSize, sliceSize) {
  this._roomIdToTweetIds = new Map();
  this._cacheSize = cacheSize || 128;
  this._sliceSize = sliceSize || 16;
}

ProcessedTweetList.prototype.push = function (room_id, tweet_id) {
  if(!this._roomIdToTweetIds.has(room_id)) {
    this._roomIdToTweetIds[room_id] = [];
  }
  this._roomIdToTweetIds[room_id].push(tweet_id);
  if(this._roomIdToTweetIds[room_id].length > this._cacheSize) {
    this._roomIdToTweetIds[room_id].splice(0, this._sliceSize);
  }
}

ProcessedTweetList.prototype.contains = function (room_id, tweet_id) {
  if(!this._roomIdToTweetIds.has(room_id)) {
    return false;
  }
  return (this._roomIdToTweetIds[room_id].indexOf(tweet_id) != -1);
}

module.exports = ProcessedTweetList;
