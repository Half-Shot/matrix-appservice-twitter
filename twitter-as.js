global.Promise = require('bluebird');

const log = require('npmlog');
const yaml = require("js-yaml");
const fs = require("fs");

const AppService = require("matrix-appservice-bridge");

const Twitter = require("./src/twitter/Twitter.js");
const TwitterRoomHandler = require("./src/TwitterRoomHandler.js");
const RoomHandlers = require("./src/handlers/Handlers.js");
const TwitterDB = require("./src/TwitterDB.js");
const util = require('./src/util.js');
const Provisioner = require("./src/Provisioner.js");

var twitter;
var bridge;
var provisioner;

var cli = new AppService.Cli({
  registrationPath: "twitter-registration.yaml",
  bridgeConfig: {
    affectsRegistration: true,
    schema: "./config/config.schema.yaml"
  },
  generateRegistration: function (reg, callback) {
    reg.setId(AppService.AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppService.AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppService.AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("_twitter_bot");
    reg.addRegexPattern("users", "@_twitter_.*", true);
    reg.addRegexPattern("aliases", "#_twitter_@.*", true);
    reg.addRegexPattern("aliases", "#_twitter_#.*", true);
    callback(reg);
  },
  run: function (port, config) {
    log.level = config.logging.level || "info";
    if(config.logging.file) {
      var lrstream = require('logrotate-stream');
      log.stream = lrstream(config.logging);
    }

    //Read registration file
    var regObj = yaml.safeLoad(fs.readFileSync("twitter-registration.yaml", 'utf8'));
    regObj = AppService.AppServiceRegistration.fromObject(regObj);
    if (regObj === null) {
      throw new Error("Failed to parse registration file");
    }

    var room_handler;

    var clientFactory = new AppService.ClientFactory({
      sdk: require("matrix-js-sdk"),
      url: config.bridge.homeserverUrl,
      token: regObj.as_token,
      appServiceUserId: "@" + regObj.sender_localpart + ":" + config.bridge.domain
    });

    bridge = new AppService.Bridge({
      homeserverUrl: config.bridge.homeserverUrl,
      domain: config.bridge.domain,
      registration: regObj,
      controller: {
        onUserQuery: userQuery,
        onEvent: (request, context) => { room_handler.passEvent(request, context); },
        onAliasQuery: (alias, aliasLocalpart) => {
          return room_handler.processAliasQuery(alias, aliasLocalpart);
        },
        onAliasQueried: (alias, roomId) => { return room_handler.onRoomCreated(alias, roomId); },
        onLog: function (line, isError) {
          if(isError) {
            if(line.indexOf("M_USER_IN_USE") === -1) {//QUIET!
              log.warn("matrix-appservice-bridge", line);
            }
          }
        }
      },
      clientFactory: clientFactory
    });
    log.info("AppServ", "Started listening on port %s at %s", port, new Date().toUTCString() );

    var tstorage = new TwitterDB(config.bridge.database_file || "twitter.db");


    twitter = new Twitter(bridge, config, tstorage);
    var opt = {
      bridge: bridge,
      app_auth: config.app_auth,
      storage: tstorage,
      twitter: twitter,
      sender_localpart: regObj.sender_localpart
    }
    room_handler = new TwitterRoomHandler(bridge, config,
      {
        services: new RoomHandlers.AccountServices(opt),
        timeline: new RoomHandlers.TimelineHandler(bridge, twitter),
        hashtag: new RoomHandlers.HashtagHandler(bridge, twitter),
        directmessage: new RoomHandlers.DirectMessageHandler(bridge, twitter)
      }
    );
    var roomstore;
    tstorage.init().then(() => {
      return twitter.start();
    }).then(() => {
      bridge.run(port, config);

      // Setup provisioning - If not enabled it will still return an error code.
      if (config.provisioning) {
        provisioner = new Provisioner(bridge, twitter, config);
        provisioner.init();
      }

      // Setup twitbot profile (this is needed for some actions)
      bridge.getClientFactory().getClientAs().register(regObj.sender_localpart).then( () => {
        log.info("Init", "Created user '"+regObj.sender_localpart+"'.");
      }).catch( (err) => {
        if (err.errcode !== "M_USER_IN_USE") {
          log.info("Init", "Failed to create bot user '"+regObj.sender_localpart+"'. %s", err.errcode);
        }
      });

      return bridge.loadDatabases();
    }).then(() => {
      roomstore = bridge.getRoomStore();//changed
      return roomstore.getEntriesByMatrixRoomData({});
    }).then((entries) => {
      entries.forEach((entry) => {
        if (entry.remote.data.hasOwnProperty('twitter_type')) {
          var type = entry.remote.data.twitter_type;

          //Fix rooms that are alias rooms
          // Criteria: canonical_alias is #_twitter_@*+:domain
          if (type === "timeline" && entry.matrix.get("twitter_user") == null) {
            log.info("Init", `Checking ${entry.remote.getId()} to see if it's an alias room.`);
            var stateLookup = new AppService.StateLookup(
              {client: bridge.getIntent(), eventTypes: ["m.room.canonical_alias"]}
            );
            stateLookup.trackRoom(entry.matrix.getId()).then(() => {
              var evt = stateLookup.getState(entry.matrix.getId(), "m.room.canonical_alias", "");
              if(evt == null) {
                return;
              }
              if(!evt.content.alias) {
                return;
              }

              if(/^#_twitter_@(\w+):/.test(evt.content.alias)) {
                entry.matrix.set("twitter_user", entry.remote.data.twitter_user);
                roomstore.upsertEntry(entry);
              }
            });
          }

          if(type === 'timeline' && config.timelines.enable) {
            const exclude_replies = entry.remote.data.twitter_exclude_replies;
            twitter.timeline.add_timeline(entry.remote.data.twitter_user, entry.matrix.getId(), {exclude_replies});
          }
          else if(type === 'hashtag' && config.hashtags.enable) {
            twitter.timeline.add_hashtag(entry.remote.roomId.substr("hashtag_".length), entry.matrix.getId());
          }
          //Fix old user timeline rooms not being bidirectional.
          else if(type === 'user_timeline') {
            const bidrectional = entry.remote.get('twitter_bidirectional');
            if(!(bidrectional === false && bidrectional === true)) {
              entry.remote.set('twitter_bidirectional', true);
              roomstore.upsertEntry(entry);
            }
          }
        }
      });
    });
  }
})


try{
  cli.run();
}
catch(err) {
  log.error("Init", "Failed to start bridge.");
  log.error("Init", err);
}

/**
 * userQuery - Handler for user queries made by the homeserver.
 *
 * @param  {type}   The userid being queried.
 * @return {Promise}            Promise to be resolved by the appservice.
 */
function userQuery (queriedUser) {
  return twitter.get_profile_by_id(queriedUser.localpart.substr("_twitter_".length)).then( (twitter_user) => {
    /* Even users with a default avatar will still have an avatar url set.
       This *should* always work. */
    return util.uploadContentFromUrl(bridge, twitter_user.profile_image_url_https, queriedUser.getId()).then((obj) => {
      return {
        name: twitter_user.name + " (@" + twitter_user.screen_name + ")",
        url: obj.mxc_url,
        remote: new AppService.RemoteUser(twitter_user.id_str)
      };
    });
  }).catch((error) => {
    log.error("UserQuery", "Couldn't find the user.\nReason: %s", error);
    return null;
  });
}
