var http = require("http");

var MTwitter = require("./mtwitter.js").MatrixTwitter;

var Cli = require("matrix-appservice-bridge").Cli;
var Bridge = require("matrix-appservice-bridge").Bridge;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;

var Twitter;

function roomPowers(users){
  return {
    "content": {
        "ban": 50,
        "events": {
            "m.room.name": 100,
            "m.room.power_levels": 100,
            "m.room.topic": 100,
            "m.room.join_rules": 100,
            "m.room.avatar":100,
            "m.room.aliases":75,
            "m.room.canonical_alias":75
        },
        "events_default": 10,
        "kick": 75,
        "redact": 75,
        "state_default": 0,
        "users": users,
        "users_default": 0
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
        test:"ABC"
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
              onUserQuery: function(queriedUser) {
                  console.log("User:",queriedUser);
                  return {}; // auto-provision users with no additonal data
              },
              onEvent: function(request, context) {
                  var event = request.getData();
                  console.log(event);
                  
                  //console.log("Request:",request);
                  //console.log("Context:",context);
                  return; // we will handle incoming matrix requests later
              },
              onAliasQuery : function(alias, aliasLocalpart) {
                  return new Promise((resolve,reject) => {
                    Twitter.get_user(aliasLocalpart.substr(9),function(tuser){
                      if(tuser != null){
                        resolve(constructTimelineRoom(tuser,aliasLocalpart));
                      }
                      else {
                        reject();
                      }
                    });
                  });
                  
                  /*
                    This will create a stream room for one users timeline.
                    Users who are not authenticated via OAuth will recieve the default power of 0
                    Users who are authenticated via Oauth will recieve a power level of 10
                    The owner of this stream will recieve a 75
                    The bot will have 100
                  */
                  console.log(streamdata);
              }
          }
      });
      console.log("Matrix-side listening on port %s", port);
      //Setup twitter
      Twitter = new MTwitter(config);
      
      bridge.run(port, config);
    }
}).run();

function constructTimelineRoom(user,aliasLocalpart){
    var botID = bridge.getBot().getUserId();
    var roomOwner = "@twitter_"+user.id_str;
    var users = {};
    users[botID] = 100;
    //users["@twitter_"+user.id_str] = 100;
    var powers = roomPowers(users);
    console.log(powers);
    opts = {
      visibility: "public",
      room_alias_name: aliasLocalpart,
      name: "[Twitter] " + user.name,
      topic: user.description,
      //invite:[roomOwner],
      initial_state: [
        powers,
        {
          "type": "m.room.join_rules",
          "content": {
              "join_rule": "public"
          },
          "state_key":""
        },
        {
          "type": "org.twitter.data",
          "content":user,
          "state_key":""
        }
      ]
    };
    console.log("New Room:",opts);
    return {
      creationOpts: opts
    };
}
