/**
 * ProcessedTweetList - Stores tweets/dms by room_id so we don't accidentally
 * repeat any messages. Please note that the cache and slice size values are
 * per room, not the total size of all stored rooms.
 */
class ProcessedTweetList {
  /**
   * @param  {number} [512] cacheSize How many messages to store before cleanup occurs
   * @param  {number} [64] sliceSize On cleanup, how many messages will be kept
   */
  constructor (cacheSize, sliceSize) {
    this._roomIdToTweetIds = new Map();
    this._cacheSize = cacheSize || 512;
    this._sliceSize = sliceSize || 64;
  }


  /**
   * Push a processed tweet onto the list.
   * @param  {string} room_id  The room to put the tweet in.
   * @param  {string} tweet_id Unique tweet identifier.
   */
  push (room_id, tweet_id) {
    if(!this._roomIdToTweetIds.has(room_id)) {
      this._roomIdToTweetIds.set(room_id, []);
    }
    this._roomIdToTweetIds.get(room_id).push(tweet_id);
    if(this._roomIdToTweetIds.get(room_id).length > this._cacheSize) {
      this._roomIdToTweetIds.get(room_id).splice(0, this._sliceSize);
    }
  }


  /**
   * Has the specifed tweet already been processed.
   *
   * @param  {string} room_id  The room to check.
   * @param  {string} tweet_id Unique tweet identifier
   * @return {boolean}         Has the tweet been processed.
   */
  contains (room_id, tweet_id) {
    if(!this._roomIdToTweetIds.has(room_id)) {
      return false;
    }
    return (this._roomIdToTweetIds.get(room_id).indexOf(tweet_id) != -1);
  }
}

module.exports = ProcessedTweetList;
