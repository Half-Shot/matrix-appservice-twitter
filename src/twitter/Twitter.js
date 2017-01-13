const log      = require('../logging.js');
const Bridge = require("matrix-appservice-bridge");

const TwitterClientFactory = require('./TwitterClientFactory.js');
const TweetProcessor = require("../TweetProcessor.js");
const DirectMessage = require('./DirectMessage.js');
const UserStream    = require('./UserStream.js');
const Timeline      = require('./Timeline.js');
const Status      = require('./Status.js');
const util = require('../util.js');
const Promise = require('bluebird');
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
    this._storage = storage;

    this._dm = new DirectMessage(this);
    this._config.timelines.poll_if_empty = this._config.timelines.poll_if_empty || false;
    this._config.hashtags.poll_if_empty = this._config.hashtags.poll_if_empty || false;
    this._timeline = new Timeline(this, this._config.timelines, this._config.hashtags);

    this._userstream = new UserStream(this);
    this._client_factory = new TwitterClientFactory(config.app_auth, this);
    this._status = new Status(this);

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
      log.warn("Attempted to call start() while having been started previously.");
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
      log.error('Error trying to retrieve bearer token:', error);
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

  get status () {
    return this._status;
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
    const roomstore = this._bridge.getRoomStore();
    roomstore.getEntriesByRemoteId("service_"+user).then((items) => {
      log.info('Sending %s "%s"', user, message);
      if(items.length === 0) {
        log.warn("Couldn't find service room for %s, so couldn't send notice.", user);
        return;
      }
      const latest_service = items[items.length-1].matrix.getId();
      this._bridge.getIntent().sendMessage(latest_service, {"msgtype": "m.notice", "body": message});
    });
  }

  update_profile (user_profile) {
    var ts = new Date().getTime();
    if(user_profile == null) {
      log.warn("Tried to preform a profile update with a null profile.");
      return Promise.resolve();
    }

    return this._storage.get_profile_by_id(user_profile.id_str).then((old)=>{
      let update_name = user_profile.name != null;
      let update_avatar = user_profile.profile_image_url_https != null;
      let update_description = user_profile.description != null; //Update if exists.
      if(old) { //Does an older profile exist. If not, update everything!
        update_name = update_name &&
         (old.name !== user_profile.name) ||
         (old.screen_name !== user_profile.screen_name);

        //Has the avatar changed.
        update_avatar = update_avatar &&
         (old.profile_image_url_https !== user_profile.profile_image_url_https) &&
         this._config.media.enable_profile_images; // Do we care?

        update_description = update_description &&
         (old.description !== user_profile.description);
      }

      const intent = this.get_intent(user_profile.id_str);
      var url;
      if(update_avatar) {
        if(user_profile == null || user_profile.profile_image_url_https == null) {
          log.warn("Tried to preform a user avatar update with a null profile.");
        }
        else{
          //We have to replace _normal because it gives us a bad quality image
          // E.g https://pbs.twimg.com/profile_images/796729706318012418/VdozW4mO_normal.jpg
          // becomes https://pbs.twimg.com/profile_images/796729706318012418/VdozW4mO.jpg
          const image_url = user_profile.profile_image_url_https.substr("_normal", "");
          util.uploadContentFromUrl(this._bridge, image_url, intent).then((obj) =>{
            url = obj.mxc_url;
            return intent.setAvatarUrl(obj.mxc_url);
          }).catch(err => {
            log.error("Couldn't set new avatar for @%s because of %s",
                user_profile.screen_name,
                err
              );
          });
        }
      }

      if(update_description || update_avatar || update_name) {
        //Update any rooms with this
        var description = user_profile.description + ` | https://twitter.com/${user_profile.screen_name}`;
        this._bridge.getRoomStore().getEntriesByMatrixRoomData(
          {"twitter_user": user_profile.id_str}
        ).each(entry => {
          if(update_description) {
            intent.setRoomTopic(entry.matrix.getId(), description);
          }
          if(update_avatar && url) {
            intent.setRoomAvatar(entry.matrix.getId(), url);
          }
          if(old.name !== user_profile.name) {
            intent.setRoomName(entry.matrix.getId(), "[Twitter] " + user_profile.name);
          }
        })
      }

      if(update_name) {
        if(user_profile != null && user_profile.name != null && user_profile.screen_name != null ) {
          intent.setDisplayName(user_profile.name + " (@" + user_profile.screen_name + ")");
        }
        else {
          log.warn("Tried to preform a user display name update with a null profile.");
        }
      }

      return this._storage.cache_user_profile(user_profile.id_str, user_profile.screen_name, user_profile, ts);
    });
  }

  /**
   * Get a Twitter profile by a users Twitter ID.
   *
   * @param  {number} id Twitter Id
   * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
   * to be returned. See https://dev.twitter.com/rest/reference/get/users/show
   */
  get_profile_by_id (user_id) {
    log.info("Looking up T" + user_id);
    return this._storage.get_profile_by_id(user_id).then((profile)=>{
      if(profile != null) {
        if(!profile._outofdate) {
          return profile;
        }
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
    log.info("Looking up T" + screen_name);
    return this._storage.get_profile_by_name(screen_name).then((profile)=>{
      if(profile != null) {
        if(!profile._outofdate) {
          return profile;
        }
      }
      return this._get_profile({screen_name});
    });
  }

  _get_profile (data) {
    return this._client_factory.get_client().then(client => {
      return client.getAsync('users/show', data);
    }).then(user => {
      return this.update_profile(user).thenReturn(user);
    }).catch(error => {
      if(Array.isArray(error)) {
        error = error[0];
      }
      log.error(
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
   * @return {Promise}     A promise that returns once the operation has completed.
   */
  create_user_timeline (user) {
    //Check if room exists.
    return this._storage.get_timeline_room(user).then(troom =>{
      if(troom != null) {
        return;
      }
      var intent = this._bridge.getIntent();
      var users = {};
      users["@_twitter_bot:"+this._bridge.opts.domain] = 100;
      users[user] = 100;
      var powers = util.roomPowers(users);
      //Create the room
      return intent.createRoom(
        {
          createAsClient: true,
          options: {
            invite: [user],
            name: "[Twitter] Your Timeline",
            visibility: "private",
            initial_state: [
              powers,
              {
                "type": "m.room.join_rules",
                "content": {
                  "join_rule": "invite"
                },
                "state_key": ""
              }
            ]
          }
        }
      ).then(room =>{
        log.verbose("Created new user timeline room %s", room.room_id);
        var mroom = new Bridge.MatrixRoom(room.room_id);
        var rroom = new Bridge.RemoteRoom("tl_"+user);
        rroom.set("twitter_type", "user_timeline");
        rroom.set("twitter_bidirectional", true);
        rroom.set("twitter_owner", user);
        this._bridge.getRoomStore().linkRooms(mroom, rroom);
        this._storage.set_timeline_room(user, room.room_id, 'user', 'all');
      });
    });
  }

}

module.exports = Twitter;
