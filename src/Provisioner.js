/*eslint no-invalid-this: 0*/ // eslint doesn't understand Promise.coroutine wrapping
const log = require('npmlog');
const util = require('./src/util.js');

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
    this._config = config.provisioner;
  }

  init () {
    if (this._config.enabled && !(this._app.use && this._app.get && this._app.post)) {
      log.error('Could not start provisioning.');
      return;
    }

    if(!this._config.enabled) {
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

    this._app.post("/_matrix/provision/link", (req, res) => {
      Promise.coroutine(this._requestWrap(this._link, req, res));
    });
    this._app.post("/_matrix/provision/unlink", (req, res) => {
      Promise.coroutine(this._requestWrap(this._unlink, req, res));
    });
    this._app.get("/_matrix/provision/listlinks/:roomId", (req, res) => {
      Promise.coroutine(this._requestWrap(this._listLinks, req, res));
    });
    this._app.post("/_matrix/provision/querynetworks", (req, res) => {
      Promise.coroutine(this._requestWrap(this._queryLink, req, res));
    });
    this._app.get("/_matrix/provision/querylink", (req, res) => {
      Promise.coroutine(this._requestWrap(this._queryNetworks, req, res));
    });
  }

  *_requestWrap (func, req, res) {
    try {
      const result = yield func(req);
      if(result !== undefined) {
        res.json(result);
      }
      else {
        res.json({});
      }
    }
    catch (err) {
      res.status(500).json({error: err.message});
      log.error("Provisioner", "Error occured: %s", err);
    }
  }

  _link (req) {
    const body = req.body;
    const room_id = body.matrix_room_id;
    if(!util.isRoomId(room_id)) {
      throw new Error("Malformed matrix_room_id");
    }
    if(!body.user_id) {
      throw new Error("No user_id given.");
    }
    Promise.coroutine(this._userHasProvisioningPower)(body.user_id, room_id).then(has_power =>{
      if(!has_power) {
        throw new Error("User does not have power to create bridges.");
      }
      if (body.twitter_screenname) {
        this._linkTimeline(room_id, body.twitter_screenname);
      }
      else if(body.twitter_hashtag) {
        this._linkHashtag(room_id, body.twitter_hashtag);
      }
      else{
        throw new Error("Specify either a screename or a hashtag.");
      }
    });
  }

  _unlink (req) {
    const roomstore = this._bridge.roomstore.getRoomStore();
    const body = req.body;
    const room_id = body.matrix_room_id;
    if(!util.isRoomId(room_id)) {
      throw new Error("Malformed matrix_room_id");
    }
    if(!body.user_id) {
      throw new Error("No user_id given.");
    }
    Promise.coroutine(this._userHasProvisioningPower)(body.user_id, room_id).then(has_power =>{
      if(!has_power) {
        throw new Error("User does not have power to create bridges.");
      }

      if(!body.twitter_screenname && !body.twitter_hashtag) {
        throw new Error("Specify either a screename or a hashtag.");
      }

      const remote = Promise.filter(roomstore.getEntriesByMatrixId(room_id), item =>{
        if(item.remote) {
          if(body.twitter_screenname && item.remote.data.twitter_type == "timeline") {
            return this._twitter.get_profile_by_screenname(item.remote.data.twitter_user).then(profile =>{
              if(!profile) {
                return false;
              }
              return profile.screen_name == body.twitter_screenname;
            });
          }
          else if(body.twitter_hashtag && item.remote.data.twitter_type == "hashtag") {
            return item.remote.data.twitter_hashtag == body.twitter_hashtag;
          }
        }
      });

      remote.then(rooms =>{
        if(rooms.length == 0) {
          throw new Error("Bridged entry not found.");
        }

        //roomstore.removeEntriesByRemoteId(rooms[0].remote.getId());

        if (body.twitter_screenname) {
          this._twitter.timeline.remove_timeline(room_id, body.twitter_screenname);
        }
        else if(body.twitter_hashtag) {
          this._twitter.timeline.remove_hashtag(room_id, body.twitter_hashtag);
        }
      })



    });

  }


  /**
   * {
   *  matrix_room_id,
   *  twitter_profile:
   *    avatar,
   *    screen_name,
   *    description
   *  twitter_hashtag: hashtag
   * }
   */
  _listLinks (req) {
    const roomId = req.params.roomId;
    if(!util.isRoomId(roomId)) {
      throw new Error("Malformed userId");
    }

    const rooms = this._bridge.getRoomStore().getEntriesByMatrixId(roomId);
    return Promise.map(rooms).then(room =>{
      if(room.remote.data.twitter_type == "timeline") {
        return this._twitter.get_profile_by_id(room.remote.data.twitter_user).then(profile =>{
          return {
            matrix_room_id: roomId,
            twitter_profile: {
              avatar: profile.profile_image_url_https,
              name: profile.name,
              screen_name: profile.screen_name,
              description: profile.description
            }
          }
        });
      }
      else if (room.remote.data.twitter_type == "hashtag") {
        return {
          matrix_room_id: roomId,
          twitter_hashtag: room.remote.getId().substr("hashtag_".length)
        }
      }
      else {
        return null;
      }
    });
  }

  // Returns basic profile information if a timeline
  // or empty object for hashtags
  _queryLink (req) {
    const body = req.body;
    if (body.twitter_hashtag) {
      return Promise.resolve({});
    }
    else if(body.twitter_screenname) {
      return this._twitter.get_profile_by_screenname(body.twitter_screenname).then(profile =>{
        if (!profile) {
          throw new Error("User not found!");
        }
        else{
          return {
            avatar: profile.profile_image_url_https,
            name: profile.name,
            screen_name: profile.screen_name,
            description: profile.description
          }
        }
      });
    }
  }

  //TODO: What to do about this. Twitter is a silo, hence only one network.
  _queryNetworks (req) {
    //const body = req.body;
    return {};
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
    return req.url === '/_matrix/provision/unlink' ||
      req.url === '/_matrix/provision/link'||
      req.url.match(/^\/_matrix\/provision\/listlinks/) ||
      req.url === '/_matrix/provision/querynetworks' ||
      req.url === "/_matrix/provision/querylink"
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

  //Call with Promise.coroutine
  *_userHasProvisioningPower (userId, roomId) {
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
