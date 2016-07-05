var ProcessedTweetList = function(cacheSize,sliceSize){
    this._internalArray = {};
    this._cacheSize = cacheSize;
    this._sliceSize = sliceSize;
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
