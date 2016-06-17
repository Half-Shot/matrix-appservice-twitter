var ProcessedTweetList = function(cacheSize,sliceSize){
    this._internalArray = [];
    this._cacheSize = cacheSize;
    this._sliceSize = sliceSize;
}

ProcessedTweetList.prototype.push = function(tweet_id){
  this._internalArray.push(tweet_id);
  if(this._internalArray.length > this._cacheSize){
    this._internalArray.splice(0,this._sliceSize);
  }
}

ProcessedTweetList.prototype.contains = function(tweet_id){
  return (this._internalArray.indexOf(tweet_id) != -1);
}

module.exports = ProcessedTweetList;
