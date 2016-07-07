/**
 * ProcessedTweetList - Stores tweets/dms by room_id so we don't accidentally
 * repeat any messages. Please note that the cache and slice size values ar
 * per room, not the total size of all the rooms.
 *
 * @class
 * @param  {number} cacheSize How many messages to store before cleanup occurs
 * @param  {number} sliceSize On cleanup, how many messages will be kept
 */
var ProcessedTweetList = function(cacheSize,sliceSize){
    this._internalArray = {};
    this._cacheSize = cacheSize || 128;
    this._sliceSize = sliceSize || 16;
}

ProcessedTweetList.prototype.push = function(room_id,tweet_id){
  if(!this._internalArray.hasOwnProperty(room_id)){
    this._internalArray[room_id] = [];
  }
  this._internalArray[room_id].push(tweet_id);
  if(this._internalArray[room_id].length > this._cacheSize){
    this._internalArray[room_id].splice(0,this._sliceSize);
  }
}

ProcessedTweetList.prototype.contains = function(room_id,tweet_id){
  if(!this._internalArray.hasOwnProperty(room_id)){
    return false;
  }
  return (this._internalArray[room_id].indexOf(tweet_id) != -1);
}

module.exports = ProcessedTweetList;
