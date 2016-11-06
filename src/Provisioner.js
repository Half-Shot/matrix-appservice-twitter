/*eslint no-invalid-this: 0*/ // eslint doesn't understand Promise.coroutine wrapping
const log = require('npmlog');
const util = require('./util.js');

const RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
const MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;

const LEAVE_UNPROVIS_AFTER_MS = 10*60*1000;
const ROOM_JOIN_TIMEOUT_MS = 1*60*1000;

class Provisioner {
  constructor (bridge, twitter, config) {
    this._bridge = bridge;
    this._as = bridge.appService;
    this._app = bridge.appService.app;
    this._twitter = twitter;
    this._config = config.provisioning;
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
          res.status(500);
          res.json({error: 'Provisioning is not enabled.'});
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
        res.json(result);
      }
    }
    catch (err) {
      res.status(500).json({error: "An internal error occured."});
      log.error("Provisioner", "Error occured: %s", err);
    }
  }

  * _manageLink (req) {
    const user_id = req.query.user_id;
    const room_id = req.params.roomid;
    const type = req.params.type;
    const name = req.params.name;
    const createLink = req.method = "PUT";

    if(!util.isRoomId(room_id)) {
      return {err: 400, body: "No/malformed room_id given."};
    }
    if(!util.isUserId(user_id)) {
      return {err: 400, body: "No/malformed user_id given."};
    }
    const has_power = yield this._userHasProvisioningPower(user_id, room_id);
    if(!has_power) {
      return {err: 401, body: "User does not have power to create bridges"}
    }
    if(!["timeline", "hashtag"].contains(type)) {
      return {err: 400, body: "'type' was not a timeline or a hashtag."};
    }

    // PUT
    if(createLink) {
      if (type == "timeline") {
        return this._linkTimeline(room_id, name);
      }
      else if(type == "hashtag") {
        return this._linkHashtag(room_id, name);
      }
    }

    // DELETE
    const roomstore = this._bridge.roomstore.getRoomStore();
    const rooms = yield Promise.filter(roomstore.getEntriesByMatrixId(room_id), item =>{
      if(item.remote) {
        if(type == "timeline" && item.remote.data.twitter_type == "timeline") {
          return this._twitter.get_profile_by_screenname(item.remote.data.twitter_user).then(profile =>{
            if(!profile) {
              return false;
            }
            return profile.screen_name == name;
          });
        }
        else if(type == "hashtag" && item.remote.data.twitter_type == "hashtag") {
          return item.remote.data.twitter_hashtag == name;
        }
      }
    });

    if(rooms.length == 0) {
      return {err: 404, body: "Bridged entry not found."};
    }

    roomstore.removeEntriesByRemoteId(rooms[0].remote.getId());

    if (type == "timeline") {
      this._twitter.timeline.remove_timeline(room_id, name);
    }
    else if(type == "hashtag") {
      this._twitter.timeline.remove_hashtag(room_id, name);
    }


  }

  * _listLinks (req) {
    const roomId = req.params.roomId;
    if(!util.isRoomId(roomId)) {
      throw new Error("Malformed userId");
    }

    const rooms = this._bridge.getRoomStore().getEntriesByMatrixId(roomId);
    const body = {
      "timelines": [],
      "hashtags": []
    }
    yield Promise.each(rooms).then(room =>{
      if(room.remote.data.twitter_type == "timeline") {
        return this._twitter.get_profile_by_id(room.remote.data.twitter_user).then(profile =>{
          body.timelines.push({
            twitterId: profile.id_str,
            avatarUrl: profile.profile_image_url_https,
            name: profile.name,
            screenName: profile.screen_name,
            description: profile.description
          });
        });
      }
      else if (room.remote.data.twitter_type == "hashtag") {
        body.hashtags.push(room.remote.getId().substr("hashtag_".length));
      }
    });
    return body;
  }

  // Returns basic profile information if a timeline
  // or empty object for hashtags
  * _queryProfile (self, req) {
    const name = req.params.screenName;
    return self._twitter.get_profile_by_screenname(name).then(profile =>{
      if (!profile) {
        return {err: 404, body: "User not found."}
      }
      else{
        return {
          twitterId: profile.id_str,
          avatarUrl: profile.profile_image_url_https,
          name: profile.name,
          screenName: profile.screen_name,
          description: profile.description
        }
      }
    });
  }

  _linkTimeline (room_id, screenname) {
    const roomstore = this._bridge.roomstore.getRoomStore();
    this._twitter.get_profile_by_screenname(screenname).then(profile =>{
      if (!profile) {
        throw new Error("User not found!");
      }

      const rooms = roomstore.getEntriesByRemoteRoomData({
        twitter_type: "timeline",
        twitter_user: profile.id_str
      });
      const isLinked = rooms.every(item => {return item.matrix.getId() != room_id});

      if(isLinked) {
        throw new Error("Timeline already bridged!");
      }

      var remote = new RemoteRoom("timeline_" + profile.id_str);
      remote.set("twitter_type", "timeline");
      remote.set("twitter_user", profile.id_str);
      roomstore.linkRooms(MatrixRoom(room_id), remote);

      this._twitter.timeline.add_timeline(profile.id_str, room_id, true);
    });
  }

  _linkHashtag (room_id, hashtag) {
    const roomstore = this._bridge.roomstore.getRoomStore()
    hashtag = hashtag.replace("#", "");
    const isLinked = roomstore.getEntriesByRemoteId("hashtag_"+hashtag).length > 0;

    if(isLinked) {
      throw new Error("Hashtag already bridged!");
    }

    var remote = new RemoteRoom("hashtag_" + hashtag);
    remote.set("twitter_type", "hashtag");
    remote.set("twitter_hashtag", hashtag);
    roomstore.linkRooms(MatrixRoom(room_id), remote);

    this._twitter.timeline.add_hashtag(hashtag, room_id, true);
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

  * _userHasProvisioningPower (userId, roomId) {
    log.info(`Check power level of ${userId} in room ${roomId}`);
    const matrixClient = this._bridge.getClientFactory().getClientAs();

    // Try 100 times to join a room, or timeout after 1 min
    try {
      yield matrixClient.joinRoom(roomId).timeout(ROOM_JOIN_TIMEOUT_MS);
    } catch (e) {
      throw new Error("Couldn't join room. Perhaps room permissions are not set to public?");
    }

    try{
      var powerState = yield matrixClient.getStateEvent(roomId, 'm.room.power_levels');
    }
    catch(err) {
      log.error("Provisioning", `Error retrieving power levels (${err.data.error})`);
    }

    if (!powerState) {
      throw new Error('Could not retrieve your power levels for the room');
    }

    //Leave if not setup within 10 minutes.
    setTimeout(() => {
      this._leaveIfUnprovisioned(roomId);
    }, LEAVE_UNPROVIS_AFTER_MS);

    let actualPower = 0;
    if (powerState.users[userId] !== undefined) {
      actualPower = powerState.users[userId];
    }
    else if (powerState.users_default !== undefined) {
      actualPower = powerState.users_default;
    }

    let requiredPower = 50;
    if (powerState.events["m.room.power_levels"] !== undefined) {
      requiredPower = powerState.events["m.room.power_levels"]
    }
    else if (powerState.state_default !== undefined) {
      requiredPower = powerState.state_default;
    }

    return actualPower >= requiredPower;
  }

  _leaveIfUnprovisioned (roomId) {
    const roomstore = this._bridge.getRoomStore();
    if(roomstore.getEntriesByMatrixId(roomId).length == 0) {
      const matrixClient = this._bridge.getClientFactory().getClientAs();
      matrixClient.leaveRoom(roomId);
    }
  }


}

module.exports = Provisioner;
