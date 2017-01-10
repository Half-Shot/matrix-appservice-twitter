const log  = require('../logging.js');
const Request  = require('request');
const FS       = require('fs');
const Buffer   = require('buffer').Buffer;
const Twitter  = require('twitter');
const Promise = require('bluebird');

const TWITTER_CLIENT_INTERVAL_MS    = 60000*10;

/**
  * Deals with authentication
  * and getting user clients
  */
class TwitterClientFactory {
  constructor (auth_config, twitter) {
    this._auth_config = auth_config;
    this._app_client = null;
    this._twitter = twitter;
    this._tclients = new Map(); // {'@userid':TwitterClient}
  }

  get_client (user_id) {
    return (user_id == null) ? this.get_application_client() : this._get_twitter_client(user_id);
  }

  get_application_client () {

    if(!this._app_client) {
      this._app_client = this._get_bearer_token().then((token) => {
        this._auth_config.bearer_token = token;
        log.info('TClientFactory', 'Retrieved bearer token');
        this._app_client = Promise.promisifyAll(new Twitter(this._auth_config));
      }).catch( err => {
        log.error("TClientFactory", "Error getting bearer token %s", err);
        this._app_client = null;
      })
    }

    return Promise.resolve(this._app_client);

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
          consumer_key: this._auth_config.consumer_key,
          consumer_secret: this._auth_config.consumer_secret,
          bearer_token: token
        };
        this.app_twitter = new Twitter(auth).get(
          'application/rate_limit_status',
          {},
          (error, status, response) => {
            if(error) {
              log.error("TClientFactory", error);
              reject(error);
              return;
            }
            if(response.statusCode === 401) {
              log.warn('TClientFactory', "Authentication with existing token failed. ");
              FS.unlink('bearer.tok', (err) => {
                if(err) {
                  log.warn('TClientFactory', "Couldn't delete bearer.tok");
                }
                resolve(this._get_bearer_http());
              });
            }
            else if (response.statusCode === 200) {
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
      var key = this._auth_config.consumer_key + ":" + this._auth_config.consumer_secret;
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
          if (jsonresponse.token_type === "bearer") {
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
    return this._twitter.storage.get_twitter_account(sender).then((creds) => {
      if(creds == null) {
        throw "No twitter account linked.";
      }

      var ts = new Date().getTime();
      var id = creds.user_id;
      var client = this._tclients.has(id) ? this._tclients.get(id) : this._create_twitter_client(creds);
      if(ts - client.last_auth < TWITTER_CLIENT_INTERVAL_MS) {
        return client;
      }

      log.info("TClientFactory", "Credentials for %s need to be reverified.", sender);
      return client.getAsync("account/verify_credentials").then(profile => {
        this._twitter.update_profile(profile);
        client.profile = profile;
        client.last_auth = ts;
        this._tclients.set(id, client);
        return client;
      }).catch(() => {
        log.info("TClientFactory", "Credentials for " + id + " are no longer valid.");
        //var returningUser = this._tclients.has(id);
        this._tclients.delete(id);//Invalidate it
        // return returningUser ? this._get_twitter_client(sender) : Promise.reject(
        //   `Couldn't authenticate with the supplied access token for ${id}. Look into this. ${error}`
        // );
      });
    });
  }

  /**
   * Remove a authenticated twitter client for a user from the cache.
   *
   * @param  {string} sender Matrix UserID of the user.
   */
  invalidate_twitter_client (sender) {
    if (!this._tclients.has(sender)) {
      return;
    }
    this._tclients.delete(sender);
  }

  _create_twitter_client (creds) {
    var client = new Twitter({
      consumer_key: this._auth_config.consumer_key,
      consumer_secret: this._auth_config.consumer_secret,
      access_token_key: creds.access_token,
      access_token_secret: creds.access_token_secret
    });
    /* Store a timestamp to track the point of login with the client. We do this
       to avoid having to keep track of auth timestamps in another map. */
    client.last_auth = 0;
    return Promise.promisifyAll(client);
  }

}

module.exports = TwitterClientFactory;
