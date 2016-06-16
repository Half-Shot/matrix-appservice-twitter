var https   = require('https');
var Buffer  = require("buffer").Buffer;
var log     = require('npmlog');

var Cli         = require("matrix-appservice-bridge").Cli;
var Bridge      = require("matrix-appservice-bridge").Bridge;
var RemoteUser  = require("matrix-appservice-bridge").RemoteUser;
var RemoteRoom  = require("matrix-appservice-bridge").RemoteRoom;
var MatrixRoom  = require("matrix-appservice-bridge").MatrixRoom;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;

var MatrixTwitter = require("./src/MatrixTwitter.js").MatrixTwitter;
var TwitterRoomHandler = require("./src/TwitterRoomHandler.js").TwitterRoomHandler;
var AccountServices = require("./src/AccountServices.js").AccountServices;
var TimelineHandler = require("./src/TimelineHandler.js").TimelineHandler;


var twitter;
var troomstore;

function roomPowers(users) {
    return {
        "content": {
            "ban": 50,
            "events": {
                "m.room.name": 100,
                "m.room.power_levels": 100,
                "m.room.topic": 100,
                "m.room.join_rules": 100,
                "m.room.avatar": 100,
                "m.room.aliases": 75,
                "m.room.canonical_alias": 75
            },
            "events_default": 10,
            "kick": 75,
            "redact": 75,
            "state_default": 0,
            "users": users,
            "users_default": 10
        },
        "state_key": "",
        "type": "m.room.power_levels"
    };
}

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
        callback(reg);
    },
    run: function(port, config) {
        bridge = new Bridge({
            homeserverUrl: "http://localhost:8008",
            domain: "localhost",
            registration: "twitter-registration.yaml",
            controller: {
                onUserQuery: userQuery,
                onEvent: (request, context) => { troomstore.passEvent(request,context); },
                onAliasQuery: roomQuery,
                onLog: function(line, isError){
                  if(isError){ // Make logging less verbose
                    console.error(line);
                  }
                  /*else{
                    console.log(line);
                  }*/
                }
            }
        });
        log.info("AppServ","Matrix-side listening on port %s", port);
        //Setup twitter
        twitter = new MatrixTwitter(bridge, config);
        troomstore = new TwitterRoomHandler(bridge, config,
          {
            services: new AccountServices(bridge, config.app_auth),
            timeline: new TimelineHandler(bridge, twitter)
          }
        );
        
        var roomstore;
        twitter.start().then(() => {
          bridge.run(port, config);
          return bridge.loadDatabases();
        }).then(() => {
          roomstore = bridge.getRoomStore();
          return roomstore.getRemoteRooms({});
        }).then((rooms) => {
          rooms.forEach((rroom, i, a) => {
            if (rroom.data.extras.twitter_type == 'timeline') {
                roomstore.getLinkedMatrixRooms(rroom.roomId).then(function(room) {
                    //Send the userid and roomid to the twitter stack for processing.
                    twitter.add_timeline(rroom.data.extras.twitter_user, room[0], rroom);
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
    return uploadContentFromUrl(bridge, twitter_user.profile_image_url_https, queriedUser.getId()).then((uri) => {
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

function roomQuery(alias, aliasLocalpart) {
    console.log(aliasLocalpart);
    return twitter.get_user(aliasLocalpart.substr("@twitter_".length)).then((tuser) => {
        if (tuser != null) {
            if (!tuser.protected) {
                return constructTimelineRoom(tuser, aliasLocalpart);
            }
        }
    });
}

/*
  This will create a stream room for one user's timeline.
  Users who are not authenticated via OAuth will receive the default power of 0
  Users who are authenticated via Oauth will receive a power level of 10
  The owner of this stream will receive a 75
  The bot will have 100
*/
function constructTimelineRoom(user, aliasLocalpart) {
    var botID = bridge.getBot().getUserId();

    var roomOwner = "@twitter_" + user.id_str + ":" + bridge.opts.domain;
    var users = {};
    users[botID] = 100;
    users[roomOwner] = 75;
    var powers = roomPowers(users);
    var remote = new RemoteRoom("timeline_" + user.id_str);
    remote.set("twitter_type", "timeline");
    remote.set("twitter_user", roomOwner);
    opts = {
        visibility: "public",
        room_alias_name: aliasLocalpart,
        name: "[Twitter] " + user.name,
        topic: user.description,
        invite: [roomOwner],
        initial_state: [
            powers, {
                "type": "m.room.join_rules",
                "content": {
                    "join_rule": "public"
                },
                "state_key": ""
            }, {
                "type": "org.matrix.twitter.data",
                "content": user,
                "state_key": ""
            }
        ]
    };
    return {
        creationOpts: opts,
        remote: remote
    };
}

/*
  This function will take a URL, upload it to Matrix and return the corresponding
  MXC url in a Promise. The content will be uploaded on the users behalf using
  the ID, or the AS bot if set to null.
*/
function uploadContentFromUrl(bridge, url, id = null, name = null) {
    var contenttype;
    return new Promise((resolve, reject) => {
        https.get((url), (res) => {
            contenttype = res.headers["content-type"];
            if (name == null) {
                name = url.split("/");
                name = name[name.length - 1];
            }
            var size = parseInt(res.headers["content-length"]);
            var buffer = Buffer.alloc(size);
            var bsize = 0;
            res.on('data', (d) => {
                d.copy(buffer, bsize);
                bsize += d.length;
            });
            res.on('error', () => {
                reject("Failed to download.");
            });
            res.on('end', () => {
                resolve(buffer);
            });
        })
    }).then((buffer) => {
        return bridge.getIntent(id).getClient().uploadContent({
            stream: buffer,
            name: name,
            type: contenttype
        });
    }).then((response) => {
        var content_uri = JSON.parse(response).content_uri;
        return content_uri;
        log.info("UploadContent","Media uploaded to %s", content_uri);
    }).catch(function(reason) {
        log.error("UploadContent","Failed to get image from url:\n%s", reason)
    })

}
