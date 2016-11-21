/*eslint no-invalid-this: 0*/ // eslint doesn't understand Promise.coroutine wrapping
const log = require('npmlog');
const util = require('./util.js');
const Promise = require('bluebird');

const RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
const MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;

const LEAVE_UNPROVIS_AFTER_MS = 10*60*1000;
const ROOM_JOIN_TIMEOUT_MS = 1*60*1000;
const DEFAULT_POWER_REQ = 50;

class Provisioner {
  constructor (bridge, twitter, config) {
    this._bridge = bridge;
    this._as = bridge.appService;
    this._app = bridge.appService.app;
    this._twitter = twitter;
    this._config = config.provisioning;
    if(this._config.required_power_level === undefined) {
      this._config.required_power_level = DEFAULT_POWER_REQ;
    }
  }

  init () {
    if (this._config.enable && !(this._app.use && this._app.get && this._app.post)) {
      log.error('Could not start provisioning.');
      return;
    }

    if(!this._config.enable) {
      log.info("Provisioner", "Disabled provisoning");
      this._app.use((req, res, next) => {
        // Disable all provision endpoints by not calling 'next' and returning an error instead
        if (this.isProvisionRequest(req)) {
          res.header("Access-Control-Allow-Origin", "*");
          res.header("Access-Control-Allow-Headers",
                "Origin, X-Requested-With, Content-Type, Accept");
          res.status(503);
          res.json({message: "The provisioning service is currently disabled."});
        }
        else {
          next();
        }
      });
      return;
    }

    log.info("Provisioner", "Enabled provisoning");

    this._app.use((req, res, next) => {
      //Forward the request onwards!
      if (this.isProvisionRequest(req)) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers",
            "Origin, X-Requested-With, Content-Type, Accept");
      }
      next();
    });

    const manageLink = (req, res) => {
      Promise.coroutine(this._requestWrap)(this, this._manageLink, req, res);
    };

    this._app.put("/_matrix/provision/:roomId/:type/:name", manageLink);
    this._app.delete("/_matrix/provision/:roomId/:type/:name", manageLink);
    this._app.get("/_matrix/provision/:roomId/links", (req, res) => {
      Promise.coroutine(this._requestWrap)(this, this._listLinks, req, res);
    });
    this._app.get("/_matrix/provision/show/:screenName", (req, res) => {
      Promise.coroutine(this._requestWrap)(this, this._queryProfile, req, res);
    });
  }

  * _requestWrap (self, func, req, res) {
    try {
      const result = yield Promise.coroutine(func)(self, req);
      if(result !== undefined) {
        if(result.err) {
          res = res.status(result.err);
        }
        if(result.body) {
          res.json(result.body);
        }
      }
    }
    catch (err) {
      res.status(500).json({message: "An internal error occured."});
      log.error("Provisioner", "Error occured: ", err.message, err.stack);
    }
  }

  * _manageLink (self, req) {
    const user_id = req.query.userId;
    const room_id = req.params.roomId;
    const type = req.params.type; //Type of link to create/remove (one of timeline, hashtag)
    const name = req.params.name; //Name of the timeline/hashtag to use.
    const opts = req.body;
    const createLink = req.method === "PUT";

    if(type === "timeline") {
      if(!util.isTwitterScreenName(name)) {
        return {err: 400, body: {message: "No/malformed screenname given."}};
      }
    }
    else if(type === "hashtag") {
      if(!util.isTwitterHashtag(name)) {
        return {err: 400, body: {message: "No/malformed hashtag given."}};
      }
    }
    else {
      return {err: 400, body: {message: "'type' was not a timeline or a hashtag."}};
    }


    if(!util.isRoomId(room_id)) {
      return {err: 400, body: {message: "No/malformed roomId given."}};
    }

    if(!util.isUserId(user_id)) {
      return {err: 400, body: {message: "No/malformed userId given."}};
    }
    if(opts.exclude_replies !== undefined) {
      if(typeof(opts.exclude_replies) !== 'boolean') {
        return {err: 400, body: {message: "Invalid exclude_replies given. Must be boolean"}};
      }
    }
    else {
      opts.exclude_replies = false;
    }

    const has_power = yield Promise.coroutine(self._userHasProvisioningPower)(self, user_id, room_id);
    if(has_power === false) {
      return {err: 401, body: {message: "User does not have power to create bridges"}}
    }
    else if(has_power !== true) {
      return has_power;// Detailed error message;
    }

    // PUT
    if(createLink) {
      if (type === "timeline") {
        return yield Promise.coroutine(self._linkTimeline)(self, room_id, name, opts);
      }
      return yield Promise.coroutine(self._linkHashtag)(self, room_id, name, opts);
    }

    // DELETE
    return yield Promise.coroutine(self._unlink)(self, type, room_id, name);

  }

  * _listLinks (self, req) {
    const roomId = req.params.roomId;
    if(!util.isRoomId(roomId)) {
      return {err: 400, body: {message: "Malformed roomId."}};
    }

    const body = {
      "timelines": [],
      "hashtags": []
    }

    yield self._bridge.getRoomStore().getEntriesByMatrixId(roomId).then(rooms => {
      return rooms;
    }).each(room =>{
      if(room.remote.data.twitter_type === "timeline") {
        return self._twitter.get_profile_by_id(room.remote.data.twitter_user).then(profile =>{
          body.timelines.push({
            twitterId: profile.id_str,
            avatarUrl: profile.profile_image_url_https,
            name: profile.name,
            screenName: profile.screen_name,
            description: profile.description
          });
        });
      }
      else if (room.remote.data.twitter_type === "hashtag") {
        body.hashtags.push(room.remote.getId().substr("hashtag_".length));
      }
    });
    return { body: body };
  }

  // Returns basic profile information if a timeline
  // or empty object for hashtags
  * _queryProfile (self, req) {
    const profile = yield self._twitter.get_profile_by_screenname(req.params.screenName);
    if (!profile) {
      return {err: 404, body: {message: "User not found."}}
    }
    else{
      return {
        body: {
          twitterId: profile.id_str,
          avatarUrl: profile.profile_image_url_https,
          name: profile.name,
          screenName: profile.screen_name,
          description: profile.description
        }
      }
    }
  }

  * _unlink (self, type, room_id, name) {
    const roomstore = self._bridge.getRoomStore();
    const rooms = yield Promise.filter(roomstore.getEntriesByMatrixId(room_id), item =>{
      if(item.remote) {
        if(type === "timeline" && item.remote.data.twitter_type === "timeline") {
          return self._twitter.get_profile_by_screenname(item.remote.data.twitter_user).then(profile =>{
            if(!profile) {
              return false;
            }
            return profile.screen_name === name;
          });
        }
        else if(type === "hashtag" && item.remote.data.twitter_type === "hashtag") {
          return item.remote.data.twitter_hashtag === name;
        }
      }
    });


    if(rooms.length === 0) {
      return {err: 404, body: {message: "Link not found."}};
    }


    if (type === "timeline") {
      self._twitter.timeline.remove_timeline(name, room_id);
    }
    else {
      self._twitter.timeline.remove_hashtag(name, room_id);
    }

    roomstore.removeEntriesByRemoteRoomId(rooms[0].remote.getId());

    return {body: {message: "Bridged entry removed."}};
  }

  * _linkTimeline (self, room_id, screenname, opts) {
    const roomstore = self._bridge.getRoomStore();
    const profile = yield self._twitter.get_profile_by_screenname(screenname);

    if (!profile) {
      return {err: 404, body: {message: "Twitter profile not found!"}};
    }

    const rooms = yield roomstore.getEntriesByRemoteRoomData({
      twitter_type: "timeline",
      twitter_user: profile.id_str
    })

    if(rooms.err) {
      return rooms;
    }

    const isLinked = rooms.filter(item => {return item.matrix.getId() === room_id}).length > 0;

    if(isLinked) {
      log.info("Provisioner", "Reconfiguring %s %s", profile.id_str, room_id);
      //Reconfigure and bail.
      this._twitter.timeline.remove_timeline(profile.id_str, room_id);
      var entry = rooms[0];
      entry.remote.set("twitter_exclude_replies", opts.exclude_replies);
      roomstore.upsertEntry(entry);
      this._twitter.timeline.add_timeline(profile.id_str, room_id, {
        is_new: true,
        exclude_replies: opts.exclude_replies
      });
      return {err: 201, body: {message: "Link updated."}};
    }

    var remote = new RemoteRoom("timeline_" + profile.id_str);
    remote.set("twitter_type", "timeline");
    remote.set("twitter_user", profile.id_str);
    remote.set("twitter_exclude_replies", opts.exclude_replies);
    roomstore.linkRooms(new MatrixRoom(room_id), remote);
    this._twitter.timeline.add_timeline(profile.id_str, room_id, {
      is_new: true,
      exclude_replies: opts.exclude_replies
    });
    return {err: 201, body: {message: "Linked successfully"}};
  }

  * _linkHashtag (self, room_id, hashtag) {
    const roomstore = this._bridge.getRoomStore();
    hashtag = hashtag.replace("#", "");
    const rooms = yield roomstore.getEntriesByRemoteRoomData({
      twitter_type: "hashtag",
      twitter_hashtag: hashtag
    })

    const isLinked = rooms.filter(item => {return item.matrix.getId() === room_id}).length > 0;

    if(isLinked) {
      return {body: {message: "Hashtag already bridged!"}};
    }

    var remote = new RemoteRoom("hashtag_" + hashtag);
    remote.set("twitter_type", "hashtag");
    remote.set("twitter_hashtag", hashtag);
    roomstore.linkRooms(new MatrixRoom(room_id), remote);

    this._twitter.timeline.add_hashtag(hashtag, room_id, {is_new: true} );
    return {err: 201, body: {message: "Linked successfully"}};
  }

  isProvisionRequest (req) {
    return req.url.match(/^\/_matrix\/provision\/(\S+)\/(link|links|timeline)/)
      || req.url.startsWith("/_matrix/provision/show");
  }

  _updateBridgingState (roomId, userId, status, skey) {
    const intent = this._bridge.getIntent();
    try {
      intent.client.sendStateEvent(roomId, 'm.room.bridging', {
        user_id: userId,
        status: status // pending, success, failure
      }, skey);
    }
    catch (err) {
      log.error("Provisioning", "Couldn't update bridging state for %s", roomId );
      throw new Error(`Could not update m.room.bridging state in this room`);
    }
  }

  * _userHasProvisioningPower (self, userId, roomId) {
    log.info("Provisioning", `Check power level of ${userId} in room ${roomId}`);
    const matrixClient = self._bridge.getClientFactory().getClientAs();

    // Try to join a room, or timeout after 1 min
    try {
      yield matrixClient.joinRoom(roomId).timeout(ROOM_JOIN_TIMEOUT_MS);
    } catch (e) {
      log.error("Provisoning", `Couldn't join room. ${e.message}`);
      return Promise.reject({err: 403, body: {message: "Couldn't join room. Perhaps room permissions are not set to public?"}});
    }
    var powerState;
    try{
      powerState = yield matrixClient.getStateEvent(roomId, 'm.room.power_levels');
    }
    catch(err) {
      log.error("Provisioning", `Error retrieving power levels (${err.data.error})`);
    }

    if (!powerState) {
      return Promise.reject({err: 403, body: 'Could not retrieve your power levels for the room'});
    }

    //Leave if not setup within LEAVE_UNPROVIS_AFTER_MS.
    setTimeout(() => {
      self._leaveIfUnprovisioned(roomId);
    }, LEAVE_UNPROVIS_AFTER_MS);

    let actualPower = 0;
    if (powerState.users[userId] !== undefined) {
      actualPower = powerState.users[userId];
    }
    else if (powerState.users_default !== undefined) {
      actualPower = powerState.users_default;
    }
    else {
      log.error("Provisioning", `Error getting power level of ${userId} in ${roomId}`);
      return Promise.reject({err: 403, body: 'Could not determine power level of the user.'});
    }

    let requiredPower = self._config.required_power_level;
    if (powerState.events["m.room.power_levels"] !== undefined) {
      requiredPower = powerState.events["m.room.power_levels"]
    }
    else if (powerState.state_default !== undefined) {
      requiredPower = powerState.state_default;
    }

    return Promise.resolve(actualPower >= requiredPower);
  }

  _leaveIfUnprovisioned (roomId) {
    const roomstore = this._bridge.getRoomStore();
    if(roomstore.getEntriesByMatrixId(roomId).length === 0) {
      const matrixClient = this._bridge.getClientFactory().getClientAs();
      matrixClient.leaveRoom(roomId);
    }
  }


}

module.exports = Provisioner;
