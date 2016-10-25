const log      = require('npmlog');
const Bridge = require("matrix-appservice-bridge");

const TwitterClientFactory = require('./TwitterClientFactory.js');
const TweetProcessor = require("../TweetProcessor.js");
const DirectMessage = require('./DirectMessage.js');
const UserStream    = require('./UserStream.js');
const Timeline      = require('./Timeline.js');
const util = require('../util.js');
/**
 * This class handles the connections between the Twitter API
 * and the bridge.
 */
class Twitter {

  /**
    * @param  {matrix-appservice-bridge.Bridge} bridge
    * @param  config. Bridge configuration (currently only make use of the auth
    *  information)
    * @param  config.app_auth.consumer_key Twitter consumer key
    * @param  config.app_auth.consumer_secret Twitter consumer secret
    * @param  {TwitterDB}       storage
    */
  constructor (bridge, config, storage) {
    this._bridge = bridge;
    this._config = config;
    this._config.timelines.poll_if_empty = this._config.timelines.poll_if_empty || false;
    this._config.hashtags.poll_if_empty = this._config.hashtags.poll_if_empty || false;
    this._storage = storage;

    this._dm = new DirectMessage(this);
    this._timeline = new Timeline(this);
    this._userstream = new UserStream(this);
    this._client_factory = new TwitterClientFactory(config.app_auth, storage);

    this._processor = null;
    this._start_promise = null;
  }

  /**
   * Starts the timers for polling the API and
   * authenticates the application with Twitter.
   * @return {Promise}  A promise that returns when authentication succeeds.
   */
  start () {
    if(this._start_promise != null) {
      log.warn("Twitter",  "Attempted to call start() while having been started previously.");
      return this._start_promise;
    }

    this._start_promise = this._client_factory.get_application_client().then((client) =>{
      this._processor = new TweetProcessor({
        bridge: this._bridge,
        client,
        twitter: this,
        storage: this._storage,
        media: this._config.media
      });


      if (this._config.timelines.enable) {
        this.timeline.start_timeline();
      }

      if (this._config.hashtags.enable) {
        this.timeline.start_hashtag();
      }

      this._userstream.attach_all();

      this._processor.start();

    }).catch((error) => {
      log.error('Twitter', 'Error trying to retrieve bearer token:', error);
      throw error;
    });
    return this._start_promise;
  }

  get_intent (id) {
    return this._bridge.getIntentFromLocalpart("_twitter_" + id);
  }

  stop () {
    this.timeline.stop_timeline();
    this.timeline.stop_hashtag();
    this._userstream.detach_all();
  }

  get dm () {
    return this._dm;
  }

  get timeline () {
    return this._timeline;
  }

  get user_stream () {
    return this._userstream;
  }

  get storage () {
    return this._storage;
  }

  get bridge () {
    return this._bridge;
  }

  get processor () {
    return this._processor;
  }

  get client_factory () {
    return this._client_factory;
  }

  notify_matrix_user (user, message) {
    var roomstore = this._bridge.getRoomStore();//changed
    roomstore.getEntriesByRemoteId("service_@testuser:localhost").then((items) =>{
      if(items.length == 0) {
        log.warn("Twitter", "Couldn't find service room for %s, so couldn't send notice.", user);
        return;
      }
      this._bridge.getIntent().sendMessage(items[0].matrix.getId(), {"msgtype": "m.notice", "body": message});
    });
    log.info("Twitter", 'Sending %s "%s"', user, message);
  }

  update_profile (user_profile) {
    var ts = new Date().getTime();
    if(user_profile == null) {
      log.warn("Twitter", "Tried to preform a profile update with a null profile.");
      return;
    }

    return this._storage.get_profile_by_id(user_profile.id).then((old)=>{
      var update_name = true;
      var update_avatar = true;
      if(old) {
        //If either the real name (name) or the screen_name (handle) are out of date, update the screen name.
        update_name = (old.name != user_profile.name)
        update_name = update_name || (old.screen_name != user_profile.screen_name);
        update_avatar = (old.profile_image_url_https != user_profile.profile_image_url_https)
         && this._media_cfg.enable_profile_images;
      }

      var intent = this.get_intent(user_profile.id_str);
      if(update_name) {
        if(user_profile != null && user_profile.name != null && user_profile.screen_name != null ) {
          intent.setDisplayName(user_profile.name + " (@" + user_profile.screen_name + ")");
        }
        else {
          log.warn("Twitter", "Tried to preform a user display name update with a null profile.");
        }
      }

      if(update_avatar) {
        if(user_profile == null || user_profile.profile_image_url_https == null) {
          log.warn("Twitter", "Tried to preform a user avatar update with a null profile.");
          return;
        }
        util.uploadContentFromUrl(this._bridge, user_profile.profile_image_url_https, intent).then((uri) =>{
          return intent.setAvatarUrl(uri);
        }).catch(err => {
          log.error(
              'Twitter',
              "Couldn't set new avatar for @%s because of %s",
              user_profile.screen_name,
              err
            );
        });
      }
      return this._storage.cache_user_profile(user_profile.id, user_profile.screen_name, user_profile, ts);
    });
  }

  /**
   * Takes a message event from a room and tries
   * to identify the sender and the correct format before processing it
   * in {@see send_tweet}.
   *
   * @param  {MatrixEvent}         event Matrix event data
   * @param  {external:MatrixUser} user  The user who sent the event.
   * @param  {external:RemoteRoom} room  The remote room that got the message.
   */
  send_matrix_event_as_tweet (event, user, room) {
    if(user == null) {
      log.warn("Twitter", "User tried to send a tweet without being known by the AS.");
      return;
    }

    //Check the user can send tweets.
    this._storage.get_twitter_account(user.getId()).then((account) => {
      if(account == null) {
        throw "Matrix account isn't linked to any twitter account.";
      }
      else if (account.access_type == "read") {
        this.notify_matrix_user(
          user.getId(),
          "Your account doesn't have the correct access level to send tweets."
        );
        throw "Account only has read permissions.";
      }

    }).then(() =>{
      if(event.content.msgtype == "m.text") {
        log.info("Twitter", "Got message: %s", event.content.body);
        var text = event.content.body.substr(0, 140);
        return this.send_tweet(room, user, text);
      }
      else if(event.content.msgtype == "m.image") {
        log.info("Twitter", "Got image: %s", event.content.body);
        //Get the url
        var url = event.content.url;
        if(url.startsWith("mxc://")) {
          url = this._bridge.opts.homeserverUrl + "/_matrix/media/r0/download/" + url.substr("mxc://".length);
        }
        return util.downloadFile(url).then((buffer) => {
          return this.upload_media(user, buffer);
        }).then ((mediaId) => {
          return this.send_tweet(room, user, "", {media: [mediaId]});
        }).catch(err => {
          log.error("Twitter", "Failed to send image to timeline. %s", err);
        });
      }
    }).catch((err) => {
      log.error("Twitter", "Failed to send tweet. %s", err);
    });


  }

  send_tweet (remote, sender, body, extras) {
    var type = remote.get("twitter_type");
    if(!["timeline", "hashtag", "user_timeline"].includes(type)) {
      throw `Tried to send a tweet to a type of room not understood ${type}`;//Where am I meant to send it :(
    }

    var client;

    return this._client_factory.get_client(sender.getId()).then((c) => {
      client = c;
      if(type == "timeline") {
        var timelineID = remote.getId().substr("timeline_".length);
        log.info("Twitter", "Trying to tweet " + timelineID);
        return this.get_profile_by_id(timelineID);
      }
    }).then(tuser => {
      var status = {status: body};
      if(type == "timeline") {
        var name = "@"+tuser.screen_name;
        if(!body.startsWith(name) && client.profile.screen_name != tuser.screen_name) {
          status.status = (name + " " + body);
        }
      }
      else if(type == "hashtag") {
        var htag = "#" + remote.roomId.substr("hashtag_".length);
        if(!body.toLowerCase().includes(htag.toLowerCase())) {
          status.status = (htag + " " + body);
        }
      }

      if(extras !== undefined) {
        if(extras.hasOwnProperty("media")) {
          status.media_ids = extras.media.join(',');
        }
      }

      status.status = status.status.substr(0, 140);

      this._processor.push_processed_tweet(remote.roomId, status.status);
      client.post("statuses/update", status, (error) => {
        if(error) {
          log.error("Twitter", "Failed to send tweet. %s", error);
          return;
        }
        var id = sender.getId();
        log.info("Twitter", "Tweet sent from %s!", id);
      });
    }).catch(err =>{
      log.error("Twitter", "Failed to send tweet. %s", err);
    });
  }

  upload_media (user, media) {
    log.warn("STUB", "Twitter.upload_media");
    return Promise.reject("upload_media not implemented");
  }

  /**
   * Get a Twitter profile by a users Twitter ID.
   *
   * @param  {number} id Twitter Id
   * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
   * to be returned. See https://dev.twitter.com/rest/reference/get/users/show
   */
  get_profile_by_id (user_id) {
    log.info("Twitter", "Looking up T" + user_id);
    return this._storage.get_profile_by_id(user_id).then((profile)=>{
      if(profile != null || !profile._outofdate) {
        return profile;
      }
      return this._get_profile({user_id});
    });
  }

  /**
   * Get a Twitter profile by a users screen name.
   * @param  {number} id Twitter Screen name
   * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
   * to be returned. See {@link}
   *
   * @see {@link https://dev.twitter.com/rest/reference/get/users/show}
   */
  get_profile_by_screenname (screen_name) {
    log.info("Twitter", "Looking up T" + screen_name);
    return this._storage.get_profile_by_name(screen_name).then((profile)=>{
      if(profile != null || !profile._outofdate) {
        return profile;
      }
      return this._get_profile({screen_name});
    });
  }

  _get_profile (data) {
    this._client_factory.get_client().then(client => {
      return client.getAsync('users/show', data);
    }).then(user => {
      return this.update_profile(user).thenReturn(user);
    }).catch(error => {
      if(Array.isArray(error)) {
        error = error[0];
      }
      log.error(
        'Twitter',
        "_get_profile: GET /users/show returned: %s %s",
        error.code,
        error.message
      );
      return null;
    });
  }

  /**
   * create_user_timeline - If a room does not exist for
   * a matrix user's personal timeline, it will be created here.
   *
   * @param  {string} user The user's matrix ID.
   * @param  {object}      The user's Twitter profile.
   * @return {Promise}     A promise that returns once the operation has completed.
   */
  create_user_timeline (user, profile) {
    //Check if room exists.
    return this._storage.get_timeline_room(user).then(troom =>{
      if(troom != null) {
        return;
      }
      var intent = this.get_intent(profile.id_str);
      //Create the room
      return intent.createRoom(
        {
          createAsClient: true,
          options: {
            invite: [user],
            name: "[Twitter] Your Timeline",
            visibility: "private",
            initial_state: [
              {
                "type": "m.room.join_rules",
                "content": {
                  "join_rule": "public"
                },
                "state_key": ""
              }
            ]
          }
        }
      ).then(room =>{
        var mroom = new Bridge.MatrixRoom(room.room_id);
        var rroom = new Bridge.RemoteRoom("tl_"+user);
        rroom.set("twitter_type", "user_timeline");
        rroom.set("twitter_owner", user);
        this._bridge.getRoomStore().linkRooms(mroom, rroom);
        this._storage.set_timeline_room(user, room.room_id, 'user', 'all');
      });
    });
  }

}

module.exports = Twitter;
