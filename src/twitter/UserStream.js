const log  = require('npmlog');

const STREAM_RETRY_INTERVAL = 15000;
const STREAM_LOCKOUT_RETRY_INTERVAL = 60*60*1000;
const TWEET_REPLY_MAX_DEPTH = 0;

class UserStream {
  constructor (twitter) {
    this.twitter = twitter;
    this._user_streams = new Map();
  }

  attach_all () {
    //TODO Write the code
    log.warn("STUB", "UserStream.attach_all");
  }

  /**
   * Start reading live updates from a Twitter User Stream.
   *
   * @param  {string} user_id The user's matrix ID.
   * @return {Promise}   A Promise that will resolve with the operation completes.
   */
  attach (user_id) {
    if(this.user_streams.has(user_id)) {
      log.warn("UserStream", "Not attaching stream since we already have one connected!");
      return;
    }

    return this.twitter.get_client(user_id).then((c) => {
      var stream = c.stream('user', {with: "followings"});
      log.info("UserStream", "Attached stream for " + user_id);
      stream.on('data',  (data) => { this._on_stream_data(data, user_id); });
      stream.on('error', function (error) {
        log.error("UserStream", "Stream gave an error %s", error);
        this.detach(user_id);
        setTimeout(() => {this.attach(user_id); }, STREAM_RETRY_INTERVAL);
      });
      this._user_streams.set(user_id, stream);
    }).catch(reason =>{
      log.warn("UserStream", "Couldn't attach user stream for %s : %s", user_id, reason);
    });
  }

  detach (user_id) {
    log.info("UserStream", "Detached stream for " + user_id);
    if(this._user_streams.has(user_id)) {
      this._user_streams.get(user_id).destroy();
      this._user_streams.delete(user_id);
    }
  }

  detach_all () {
    this._user_streams.forEach((item, i) =>{
      this.detach(i);
    });
  }

  _on_stream_data (user_id, data) {
    if(data.direct_message) {
      this.twitter.dm.process_dm(data.direct_message);
    }
    else if (data.warning) {
      log.warn("UserStream",
       "Got a warning from a User Stream.\n%s : %s",
        data.warning.code,
        data.warning.message
      );
    }
    else if (data.disconnect) {
      if(data.disconnect.code == 2) {
        log.error(
          "UserStream",
          "Disconnect error for too many duplicate streams. Bailing on this user.\n%s",
          data.warning.message
        );
        this.detach(user_id);
        setTimeout(() => {this.attach(user_id); }, STREAM_LOCKOUT_RETRY_INTERVAL);
        this.twitter.notify_matrix_user(
           user_id,
           "We had an issue connecting to your Twitter account. Services may be distrupted"
         );
      }
      else if(data.disconnect.code == 6 ) {
        log.error("UserStream", "Token revoked. We can't do any more here.\n%s",
         data.warning.message);
      }
      else
      {
        log.warn("UserStream", "Disconnect errorcode %s %s. Restarting stream.",
          data.warning.code,
          data.warning.message
        );
        this.detach(user_id);
        setTimeout(() => {this.attach(user_id); }, STREAM_RETRY_INTERVAL);
      }
    }
    else if (data.id) { //Yeah..the only way to know if it's a tweet is to check if the ID field is set at the root level.
      let client;
      this.twitter.get_client(user_id).then((c) =>{
        client = c;
        return this.twitter.storage.get_timeline_room(user_id);
      }).then((room_id) =>{
        this.twitter.processor.process_tweet(room_id, data, TWEET_REPLY_MAX_DEPTH, client);
      }).catch((err) =>{
        log.error("UserStream", "There was error sending a userstream tweet into a timeline room. %s", err);
      });
    }
  }


}

module.exports = UserStream;
