var log     = require('npmlog');

var Cli         = require("matrix-appservice-bridge").Cli;
var Bridge      = require("matrix-appservice-bridge").Bridge;
var RemoteUser  = require("matrix-appservice-bridge").RemoteUser;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;

var MatrixTwitter = require("./src/MatrixTwitter.js").MatrixTwitter;
var TwitterRoomHandler = require("./src/TwitterRoomHandler.js").TwitterRoomHandler;
var AccountServices = require("./src/AccountServices.js").AccountServices;
var TimelineHandler = require("./src/TimelineHandler.js").TimelineHandler;
var HashtagHandler = require("./src/HashtagHandler.js").HashtagHandler;
var DirectMessageHandler = require("./src/DirectMessageHandler.js").DirectMessageHandler;

var TwitterDB = require("./src/TwitterDB.js").TwitterDB;

var util    = require('./src/util.js');

var twitter;
var troomstore;


new Cli({
    registrationPath: "twitter-registration.yaml",
    bridgeConfig: {
        schema: "config.yaml",
        defaults: {
            test: "ABC"
        }
    },
    generateRegistration: function(reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("twitbot");
        reg.addRegexPattern("users", "@twitter_.*", true);
        reg.addRegexPattern("aliases", "#twitter_@.*", true);
        reg.addRegexPattern("aliases", "#twitter_#.*", true);
        reg.addRegexPattern("aliases", "#twitter_DM.*", true);
        callback(reg);
    },
    run: function(port, config) {
        bridge = new Bridge({
            homeserverUrl: config.bridge.homeserverUrl,
            domain: config.bridge.domain,
            registration: "twitter-registration.yaml",
            controller: {
                onUserQuery: userQuery,
                onEvent: (request, context) => { troomstore.passEvent(request,context); },
                onAliasQuery: (alias, aliasLocalpart) => { return troomstore.processAliasQuery(alias,aliasLocalpart); },
                onLog: function(line, isError){
                  if(isError){
                    if(line.indexOf("M_USER_IN_USE") == -1){//QUIET!
                        log.error("matrix-appservice-bridge",line);
                    }
                  }
                  /*else{
                    console.log(line);
                  }*/
                }
            }
        });
        log.info("AppServ","Matrix-side listening on port %s", port);
        //Setup twitter

        var tstorage = new TwitterDB('twitter.db');
        tstorage.init();

        twitter = new MatrixTwitter(bridge, config, tstorage);
        troomstore = new TwitterRoomHandler(bridge, config,
          {
            services: new AccountServices(bridge, config.app_auth, tstorage, twitter),
            timeline: new TimelineHandler(bridge, twitter),
            hashtag: new HashtagHandler(bridge, twitter),
            directmessage: new DirectMessageHandler(bridge,twitter)
          }
        );

        var roomstore;
        twitter.start().then(() => {
          bridge.run(port, config);
          return bridge.loadDatabases();
        }).then(() => {
          roomstore = bridge.getRoomStore();

          tstorage.get_linked_user_ids().then(ids =>{
            ids.forEach((value) => {
              twitter.attach_user_stream(value);
            });
          });

          return roomstore.getRemoteRooms({});
        }).then((rooms) => {
          rooms.forEach((rroom, i, a) => {
            if (rroom.data.twitter_type) {
                roomstore.getLinkedMatrixRooms(rroom.roomId).then((room) => {
                  if(room.length > 0){
                    if(rroom.data.twitter_type == 'timeline'){
                      twitter.add_timeline(rroom.data.twitter_user, room[0], rroom);
                    }
                    else if(rroom.data.twitter_type == 'hashtag') {
                      twitter.add_hashtag_feed(rroom.roomId.substr("hashtag_".length),room[0],rroom);
                    }
                  }
                  else{
                    log.error("Orphan remote timeline room with no matrix link :(");
                  }
                    //Send the userid and roomid to the twitter stack for processing.
                });
            }
          });
        });
    }
}).run();

function userQuery(queriedUser) {
  return twitter.get_user_by_id(queriedUser.localpart.substr("twitter_".length)).then( (twitter_user) => {
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
      log.error("UserQuery","Couldn't find the user.\nReason: %s",error);
  });
}
