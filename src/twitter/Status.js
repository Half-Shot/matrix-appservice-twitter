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

const log = require('../util.js').logPrefix("Status");
const TWEET_SIZE = 140;
const CONSECUTIVE_TWEET_MAX = 3;

class Status {
  constructor (twitter) {
    this._twitter = twitter;
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
    let context;
    let client;
    return this._can_send(user.userId).then( () => {
      return this._twitter.client_factory.get_client(user.userId);
    }).then(cli => {
      client = cli;
      return this._get_room_context(rooms);
    }).then(room_context => {
      context = this._get_tweet_context(event.content.body);
      context.hashtags = context.hashtags.filter( item => {return room_context.hashtags.includes(item);} );
      context.screennames = context.screennames.filter( item => {return room_context.screennames.includes(item);} );
      if(context.hashtags.length + context.screennames.length === 0 && !room_context.pass) {
        return Promise.reject("No context given.");
      }
      return this._twitter.storage.get_profile_from_userid(user.userId);
    }).then(profile => {
      return this._build_tweets(event, context, profile);
    }).then(tweets => {
      return this._send_tweets(client, tweets, null);
    }).catch(err =>{
      if(err.notify) {
        this._twitter.notify_matrix_user(user.userId, err.notify);
        log.info("Couldn't send tweet: ", err.error);
      }
      else {
        log.info("Couldn't send tweet: ", err);
      }
      throw err;
    });
  }

  _can_send (user_id) {
    if(user_id == null) {
      return Promise.reject("User isn't known by the AS");
    }
    return this._twitter.storage.get_twitter_account(user_id).then((account) => {
      if(account === null) {
        return Promise.reject("Matrix account isn't linked to any twitter account.");
      }
      else if (account.access_type === "read") {
        return Promise.reject({
          "notify": "Your account doesn't have the correct permission level to send tweets.",
          "error": `Account only has ${account.access_type} permissions.`
        });
      }
      return true;
    });
  }

  _get_tweet_context (msg) {
    const regex = /(?:^|\s|[^\w|@|#])(@[a-zA-Z0-9_]{1,15}(?=#|\s|$)|#[a-zA-Z0-9_]+(?=@|\s|$))/ig;
    const result = {screennames: [], hashtags: []};
    let m;
    while ((m = regex.exec(msg)) !== null) {
      const tag = m[1];
      if(tag.startsWith('#')) {
        result.hashtags.push(tag.substr(1));
      }
      else { //@
        result.screennames.push(tag.substr(1));
      }
    }
    return result;
  }

  _get_room_context (rooms) {
    const context = {screennames: [], hashtags: [], pass: false};
    const promises = [];
    for(var room of rooms) {
      const isbi = (room.data.twitter_bidirectional === true) ;
      if(room.data.twitter_type === "user_timeline" && isbi) {
        context.pass = true;
        promises.push(this._twitter.storage.get_profile_from_userid(room.data.twitter_owner).then(profile =>{
          context.screennames.push(profile.screen_name);
        }));
      }
      else if(room.data.twitter_type === "hashtag" && isbi) {
        context.hashtags.push(room.data.twitter_hashtag);
      }
      else if(room.data.twitter_type === "timeline" && isbi) {
        promises.push(this._twitter.get_profile_by_id(room.data.twitter_user).then(profile =>{
          context.screennames.push(profile.screen_name);
        }));
      }
    }
    return Promise.all(promises).then(() => {
      return context;
    })
  }

  _build_tweets (event, context, profile) {
    //TODO: Get context for REPLYING
    var content = [];
    if(event.content.msgtype === "m.text" || event.content.msgtype === "m.emote") {
      let body = event.content.body;
      if(event.content.msgtype === "m.emote") {
        body = "*" + body + "*";
      }
      let i = 0;
      const sname = "@" + profile.screen_name + " ";
      const tweet_length = TWEET_SIZE - (sname).length;
      while(i<CONSECUTIVE_TWEET_MAX && body.length > 0) {
        let tweet;
        if(i === 0) {
          tweet = body.slice(0, TWEET_SIZE);
        }
        else {
          tweet = sname + body.slice(0, tweet_length);
        }
        body = body.slice(i === 0 ? TWEET_SIZE: tweet_length);
        content.push({status: tweet, in_reply_to_status_id: i > 0 ? "previous" : null});
        i++;
      }

      if (body.length > 0) {
        return Promise.reject(
          {
            "notify": `The tweet was over the limit the bridge supports.
We support ${CONSECUTIVE_TWEET_MAX*(TWEET_SIZE-(sname.length))} characters (or ${CONSECUTIVE_TWEET_MAX} tweets.) `,
            "error": `Tweet was too large.`
          }
        );
      }

    }
    else if(event.content.msgtype === "m.image") {
      return Promise.reject(
        {
          "notify": `Images are not supported yet.`,
          "error": `Images are not supported yet.`
        }
      );
    }
    return Promise.resolve(content);
  }

  _send_tweets (client, tweets, previous) {
    if(tweets.length === 0) {
      return Promise.resolve();
    }
    const tweet = tweets.shift();
    if(tweet.in_reply_to_status_id === "previous") {
      tweet.in_reply_to_status_id = previous.id_str;
    }
    return client.postAsync("statuses/update", tweet).then(res => {
      return this._send_tweets(client, tweets, res);
    }).catch(err =>{
      log.error("Failed to send tweet. %s", err);
      throw err;
    });
  }

}

module.exports = Status;
