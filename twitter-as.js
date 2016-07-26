var log     = require('npmlog');
var yaml    = require("js-yaml");
var fs      = require("fs");

var Cli                    = require("matrix-appservice-bridge").Cli;
var Bridge                 = require("matrix-appservice-bridge").Bridge;
var RemoteUser             = require("matrix-appservice-bridge").RemoteUser;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var ClientFactory          = require("matrix-appservice-bridge").ClientFactory;

var MatrixTwitter        = require("./src/MatrixTwitter.js").MatrixTwitter;
var TwitterRoomHandler   = require("./src/TwitterRoomHandler.js").TwitterRoomHandler;
var AccountServices      = require("./src/AccountServices.js").AccountServices;
var TimelineHandler      = require("./src/TimelineHandler.js").TimelineHandler;
var HashtagHandler       = require("./src/HashtagHandler.js").HashtagHandler;
var DirectMessageHandler = require("./src/DirectMessageHandler.js").DirectMessageHandler;
var TwitterDB            = require("./src/TwitterDB.js").TwitterDB;
var util                 = require('./src/util.js');

var twitter;
var bridge;

new Cli({
  registrationPath: "twitter-registration.yaml",
  bridgeConfig: {
    affectsRegistration: true,
    schema: "./config/config.schema.yaml"
  },
  generateRegistration: function (reg, callback) {
    reg.setId(AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("twitbot");
    reg.addRegexPattern("users", "@twitter_.*", true);
    reg.addRegexPattern("aliases", "#twitter_@.*", true);
    reg.addRegexPattern("aliases", "#twitter_#.*", true);
        /* Currently not in use */
        //reg.addRegexPattern("aliases", "#twitter_DM.*", true);
    callback(reg);
  },
  run: function (port, config) {

        //Read registration file

    var regObj = yaml.safeLoad(fs.readFileSync("twitter-registration.yaml", 'utf8'));
    regObj = AppServiceRegistration.fromObject(regObj);
    if (regObj === null) {
      throw new Error("Failed to parse registration file");
    }

    var room_handler;

    var clientFactory = new ClientFactory({
      sdk: require("matrix-js-sdk"),
      url: config.bridge.homeserverUrl,
      token: regObj.as_token,
      appServiceUserId: "@" + regObj.sender_localpart + ":" + config.bridge.domain
    });

    bridge = new Bridge({
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
            if(line.indexOf("M_USER_IN_USE") == -1) {//QUIET!
              log.error("matrix-appservice-bridge", line);
            }
          }
        }
      },
            // Fix to use our own JS SDK due to a bug in 0.4.1
      clientFactory: clientFactory
    });
    log.info("AppServ", "Matrix-side listening on port %s", port);
        //Setup twitter

    var tstorage = new TwitterDB('twitter.db');
    tstorage.init();

    twitter = new MatrixTwitter(bridge, config, tstorage);
    var opt = {
      bridge: bridge,
      app_auth: config.app_auth,
      storage: tstorage,
      twitter: twitter
    }
    room_handler = new TwitterRoomHandler(bridge,
      {
        services: new AccountServices(opt),
        timeline: new TimelineHandler(bridge, twitter),
        hashtag: new HashtagHandler(bridge, twitter),
        directmessage: new DirectMessageHandler(bridge, twitter)
      }
    );

    var roomstore;
    twitter.start().then(() => {
      bridge.run(port, config);
      return bridge.loadDatabases();
    }).then(() => {
      roomstore = bridge.getRoomStore();//changed
      tstorage.get_linked_user_ids().then(ids =>{
        ids.forEach((value) => {
          twitter.attach_user_stream(value);
        });
      });
      return roomstore.getEntriesByMatrixRoomData({});
    }).then((entries) => {
      entries.forEach((entry) => {
        if (entry.remote.data.hasOwnProperty('twitter_type')) {
          var type = entry.remote.data.twitter_type;
          if(type == 'timeline') {
            twitter.add_timeline(entry.remote.data.twitter_user, entry);
          }
          else if(type == 'hashtag') {
            twitter.add_hashtag_feed(entry.remote.roomId.substr("hashtag_".length), entry);
          }
        }
      });
    });
  }
}).run();


/**
 * userQuery - Handler for user queries made by the homeserver.
 *
 * @param  {type}   The userid being queried.
 * @return {Promise}            Promise to be resolved by the appservice.
 */
function userQuery (queriedUser) {
  return twitter.get_profile_by_id(queriedUser.localpart.substr("twitter_".length)).then( (twitter_user) => {
    /* Even users with a default avatar will still have an avatar url set.
       This *should* always work. */
    return util.uploadContentFromUrl(bridge, twitter_user.profile_image_url_https, queriedUser.getId()).then((uri) => {
      return {
        name: twitter_user.name + " (@" + twitter_user.screen_name + ")",
        url: uri,
        remote: new RemoteUser(twitter_user.id_str)
      };
    });
  }).catch((error) => {
    log.error("UserQuery", "Couldn't find the user.\nReason: %s", error);
    return null;
  });
}
