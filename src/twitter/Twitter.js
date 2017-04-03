const log      = require('../logging.js');
const Bridge = require("matrix-appservice-bridge");

const TwitterClientFactory = require('./TwitterClientFactory.js');
const TweetProcessor = require("../TweetProcessor.js");
const DirectMessage = require('./DirectMessage.js');
const UserStream    = require('./UserStream.js');
const Timeline      = require('./Timeline.js');
const Status      = require('./Status.js');
const TwitterProfile = require("./TwitterProfile.js");
const util = require('../util.js');

/**
 * This class handles the connections between the Twitter API
 * and the bridge.
 */
class Twitter {

  /**
    * @param  {matrix-appservice-bridge.Bridge} bridge
    * @param  config. Bridge configuration
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

    this._timeline = new Timeline(this, this._config);

    this._userstream = new UserStream(this);
    this._status = new Status(this);
    this._client_factory = new TwitterClientFactory(this, config.app_auth, config.proxy);
    this._profile = new TwitterProfile(this, config);

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
      this._processor.start();

      if (this._config.timelines.enable) {
        this.timeline.start_timeline();
      }

      if (this._config.hashtags.enable) {
        this.timeline.start_hashtag();
      }

      if (this._config.hashtags.enable || this._config.timelines.enable) {
        this.timeline.startMemberChecker();
      }

      this._userstream.start();
      this._userstream.attach_all();

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
    this.timeline.stopMemberChecker();
    this._userstream.detach_all();
    this._userstream.stop();
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

  get profile () {
    return this._profile;
  }

  notify_matrix_user (user, message) {
    const roomstore = this._bridge.getRoomStore();
    roomstore.getEntriesByRemoteId("service_" + user).then((items) => {
      log.info('Sending %s "%s"', user, message);
      if(items.length === 0) {
        log.warn("Couldn't find service room for %s, so couldn't send notice.", user);
        return;
      }
      const latest_service = items[items.length - 1].matrix.getId();
      this._bridge.getIntent().sendMessage(latest_service, {"msgtype": "m.notice", "body": message});
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
      const intent = this._bridge.getIntent();
      const users = {};
      users["@_twitter_bot:" + this._bridge.opts.domain] = 100;
      users[user] = 100;
      const powers = util.roomPowers(users);
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
        const mroom = new Bridge.MatrixRoom(room.room_id);
        const rroom = new Bridge.RemoteRoom("tl_" + user);
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
