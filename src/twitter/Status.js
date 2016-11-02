/**
- Does the user exist Tick
- Can the user send tweets. Tick
- Get context of tweet Tick
    - Does the tweet have a context tag Tick
    - Is the room single context & is bidirectional Tick
      - Is the tweet formatted correctly.
- Is the tweet formatted correctly.
- Set Tweet Content
- Send
*/

const log      = require('npmlog');
const REPLY_TIMEOUT = 60*5000;

class Status {
  constructor (twitter) {
    this._twitter = twitter;
  }

  _can_send (user_id) {
    if(user_id == null) {
      return Promise.reject("User isn't known by the AS");
    }
    return this._twitter._storage.get_twitter_account(user_id).then((account) => {
      if(account == null) {
        throw "Matrix account isn't linked to any twitter account.";
      }
      else if (account.access_type == "read") {
        throw  {
          "notify": "Your account doesn't have the correct permission level to send tweets.",
          "error": `Account only has ${account.access_type} permissions.`
        }
      }
      else{
        return;
      }
    });
  }

  /**
   * Takes a message event from a room and tries
   * to identify the sender and the correct format before processing it
   * in {@see send_tweet}.
   *
   * @param  {MatrixEvent}         event Matrix event data
   * @param  {external:MatrixUser} user  The user who sent the event.
   * @param  {external:RemoteRoom} rooms  The remote room that got the message.
   */
  send_matrix_event (event, user, rooms) {
    return this._can_send(user).then( () => {
      return this._get_event_context(event, rooms);
    }).catch(err =>{
      if(err.notify) {
        this._twitter.notify_matrix_user(user, err.notify);
        log.info("Status", "Couldn't send tweet: %s", err.error);
      }
      else {
        log.info("Status", "Couldn't send tweet: %s", err);
      }
    })
  }

  _get_event_context (event, rooms) {
    var room = null;
    if (rooms.length > 1) {
      
    }
    else if (rooms.length == 1) {
      room = rooms[1];
    }
    else{
      return Promise.reject("No remotes associated with room.");
    }
  }

  _get_tag (remote, user, own_id, tweet) {
    var type = remote.get("twitter_type");
    if(!["timeline", "hashtag", "user_timeline"].includes(type)) {
      return Promise.reject(`Tried to send a tweet to a type of room not understood ${type}`);
    }

    if(type == "timeline" || type == "user_timeline") {
      var timeline = remote.getId().substr("timeline_".length);
      log.info("Twitter", "Trying to tweet " + timeline);
      return this.get_profile_by_id(timeline).then(profile =>{
        var tag = "@"+profile.screenname;
        if(tweet.startsWith(tag) && own_id == profile.twitter_id) {
          return tag;
        }
        else {
          return "";
        }
      });
    }
    else if(type == "hashtag") {
      var tag = "#"+remote.getId().substr("hashtag_".length);
      if(tweet.startsWith(tag)) {
        return Promise.resolve(tag);
      }
    }
  }

  _get_matrix_event_context (event) {
    const result = /^@(\w+)/.exec(event.content.body);
    var context_promise = null;
    if(result == null) {
      context_promise = new Promise.resolve(null);
    }
    else{
      context_promise = this._storage.get_profile_by_name(result[1]).then(profile => {
        if(profile) {
          var sender = "@_twitter_"+profile.id+":"+this._bridge.opts.domain;
          return this._storage.get_best_guess_reply_target(
            event.room_id,
            sender,
            event.origin_server_ts,
            REPLY_TIMEOUT
          );
        }
        else{
          return null;
        }
      });
    }
    return context_promise;
  }

  _prepare_contextless_tweet (remote, user, tweet, own_id) {
    var type = remote.get("twitter_type");
    if(!["timeline", "hashtag", "user_timeline"].includes(type)) {
      return Promise.reject(`Tried to send a tweet to a type of room not understood ${type}`);
    }

    if(type == "timeline" || type == "user_timeline") {
      var timeline = remote.getId().substr("timeline_".length);
      log.info("Twitter", "Trying to tweet " + timeline);
      return this.get_profile_by_id(timeline).then(profile =>{
        var tag = "@"+profile.screenname;
        if(tweet.startsWith(tag) && own_id == profile.twitter_id) {
          return Promise.resolve(tag + " " + tweet);
        }
      });
    }
    else if(type == "hashtag") {
      var tag = "#"+remote.getId().substr("hashtag_".length);
      if(tweet.startsWith(tag)) {
        return Promise.resolve(tag + " " + tweet);
      }
    }
  }
  _upload_media () { //(user, media) {
    log.warn("STUB", "Twitter.upload_media");
    return Promise.reject("upload_media not implemented");
  }


}

module.exports = Status;
