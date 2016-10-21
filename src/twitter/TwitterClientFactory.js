const log  = require('npmlog');
const Request  = require('request');
const FS       = require('FS');
const Buffer   = require('buffer').Buffer;
const Twitter  = require('twitter');

const TWITTER_CLIENT_INTERVAL_MS    = 60000;

/**
  * Deals with authentication
  * and getting user clients
  */
class TwitterClientFactory {
  constructor (auth_config, storage) {
    this._auth_config = auth_config;
    this._app_client = null;
    this._storage = storage;
    this._app_twitter_promise = null;
    this._tclients = new Map(); // {'@userid':TwitterClient}
  }

  get_client (user_id) {
    if(user_id == null) {
      return this.get_application_client();
    }
    return this.get_user_client(user_id);
  }

  get_application_client () {
    if(this._app_client) {
      return this._app_client;
    }
    if(this._app_twitter_promise) {
      return this._app_twitter_promise;
    }
    else {
      this._app_twitter_promise = this._get_bearer_token().then((token) => {
        this._auth_config.bearer_token = token;
        log.info('TClientFactory', 'Retrieved bearer token');
        this._app_client = new Twitter(this.app_auth);
      }).then( ()=>{
        this._app_twitter_promise = null;
        return this._app_client;
      });
      return this._app_twitter_promise;
    }
  }

  get_user_client (user_id) {
    return this._tclients.has(user_id) ? Promise.resolve(this._tclients[user_id]) : this.get_twitter_client(user_id);
  }

  _get_bearer_token () {
    return new Promise((resolve) => {
      FS.readFile('bearer.tok', {encoding: 'utf-8'}, (err, content) => {
        if(err) {
          log.warn('TClientFactory', "Token file not found or unreadable. Requesting new token.");
          log.error("TClientFactory", err);
          resolve(this._get_bearer_http());
        }
        resolve(content);
      });
    }).then(token => {
      //Test the token
      return new Promise((resolve, reject) =>{
        var auth = {
          consumer_key: this.app_auth.consumer_key,
          consumer_secret: this.app_auth.consumer_secret,
          bearer_token: token
        };
        this.app_twitter = new Twitter(auth).get(
          'application/rate_limit_status',
          {},
          (error, status, response) => {
            if(response.statusCode == 401) {
              log.warn('TClientFactory', "Authentication with existing token failed. ");
              FS.unlink('bearer.tok', (err) => {
                if(err) {
                  log.warn('TClientFactory', "Couldn't delete bearer.tok");
                }
                resolve(this._get_bearer_http());
              });
            }
            else if (response.statusCode == 200) {
              log.info('TClientFactory', "Existing token OK.");
              resolve(token);
            }
            else {
              log.error("TClientFactory", error);
              reject("Unexpected response to application/rate_limit_status " +
                "during bearer token validation. Bailing.");
            }
          });
      });
    });
  }

  _get_bearer_http () {
    return new Promise( (resolve, reject) => {
      var key = this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret;
      key = Buffer.from(key, 'ascii').toString('base64');
      var options = {
        url: "https://api.twitter.com/oauth2/token",
        headers: {
          'Authorization': "Basic " + key
        },
        form: "grant_type=client_credentials",
        contentType: "application/x-www-form-urlencoded;charset=UTF-8"
      };
      Request.post(options, function (error, response, body) {
        if (error) {
          reject(error);
        } else if (response.statusCode !== 200) {
          reject("Response to bearer token request returned non OK")
          log.error("Twitter",
                "Body of response:%s\nStatuscode of respnse:%s",
                body,
                response.statusCode
              );
        } else {
          try {
            var jsonresponse = JSON.parse(body);
          } catch (e) {
            reject(e);
          }
          if (jsonresponse.token_type == "bearer") {
            FS.writeFile("bearer.tok", jsonresponse.access_token, (err) => {
              if (err) {
                //This error is unfortunate, but not a failure to retrieve a token so the bridge can run fine.
                log.error("Twitter", "Couldn't write bearer token to file. Reason:", err);
              }
            });
            //Not waiting for callback since it is trivial to get a new token, and can be done async
            resolve(jsonresponse.bearer_token);
          } else {
            reject({msg: "Request to oauth2/post did not return the correct" +
                    "token type ('bearer'). This is weeeird."});
            log.error("Twitter", "Body of response:%s", body);
          }
        }
      });
    });
  }


  /**
   * Get a authenticated twitter client for a user.
   *
   * @param  {string} sender Matrix UserID of the user.
   * @return {Twitter}     The client.
   */
  _get_twitter_client (sender) {
    //Check if we have the account in the cache
    return this._storage.get_twitter_account(sender).then((creds) => {
      return new Promise( (resolve, reject) => {
        if(creds == null) {
          reject("No twitter account linked.");
          return;
        }

        var ts = new Date().getTime();
        var id = creds.user_id;
        var client;
        if(this._tclients.has(id)) {
          client = this._tclients[id];
          if(ts - client.last_auth < TWITTER_CLIENT_INTERVAL_MS) {
            resolve(client);
            return;
          }

          log.info("TClientFactory", "Credentials for %s need to be reevaluated.", sender);
          client.get("account/verify_credentials", (error, profile) => {
            if(error) {
              log.info("TClientFactory", "Credentials for " + id + " are no longer valid.");
              log.error("TClientFactory", error);
              delete this._tclients[id];//Invalidate it
              resolve(this._get_twitter_client(sender));
              return;
            }
            client.profile = profile;
            this._processor.update_user_timeline_profile(profile);
            resolve(client);
          });
        }
        else {
          client = this._create_twitter_client(creds);
          this._tclients[id] = client;
          client.get("account/verify_credentials", (error, profile) => {
            if(error) {
              delete this._tclients[id];//Invalidate it
              log.error(
                "TClientFactory",
                "We couldn't authenticate with the supplied access token for %s. Look into this. %s",
                id,
                error
              );
              reject(error);
              return;
              //TODO: Possibly find a way to get another key.
            }
            client.profile = profile;
            client.last_auth = ts;
            this._processor.update_user_timeline_profile(profile);
            resolve(client);
          });
        }
      });
    });
  }

  _create_twitter_client (creds) {
    var ts = new Date().getTime();
    var client = new Twitter({
      consumer_key: this.app_auth.consumer_key,
      consumer_secret: this.app_auth.consumer_secret,
      access_token_key: creds.access_token,
      access_token_secret: creds.access_token_secret
    });
    /* Store a timestamp to track the point of login with the client. We do this
       to avoid having to keep track of auth timestamps in another map. */
    client.last_auth = ts;
    return client;
  }

}

module.exports = TwitterClientFactory;
