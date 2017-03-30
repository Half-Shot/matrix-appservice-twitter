const log = require('../logging.js');
const TWITTER_PROFILE_INTERVAL_MS = 10 * 60000;
module.exports = {
  get_twitter_account: function (user_id) {
    log.silly("SQL", "get_twitter_account => %s", user_id);
    return this.db.getAsync(
      `
      SELECT *
      FROM twitter_account
      WHERE twitter_account.user_id = $id;
      `
    , {
      $id: user_id
    }).then( row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error retrieving client data: %s", err.Error);
      throw err;
    });
  },

  get_twitter_account_by_oauth_token: function (oauth_token) {
    log.silly("SQL", "get_twitter_account_by_oauth_token => %s", oauth_token);
    return this.db.getAsync(
      `
      SELECT *
      FROM twitter_account
      WHERE twitter_account.oauth_token = $ot;
      `
    , {
      $ot: oauth_token
    }).then( row => {
      return row !== undefined ? row : null;
    }).catch( err => {
      log.error("TwitDB", "Error retrieving client data: %s", err.Error);
      throw err;
    });
  },

  get_profile_from_userid: function (user_id) {
    return this.db.getAsync(
    `
    SELECT profile
    FROM user_cache, twitter_account
    WHERE user_cache.id == twitter_account.twitter_id
    AND twitter_account.user_id = $id
    `
    , {
      $id: user_id
    }).then((profile) => {
      if(profile !== undefined) {
        const ts = new Date().getTime();
        const pro = JSON.parse(profile.profile);
        pro._outofdate = (ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS);
        return pro;
      }
      else {
        return null;
      }
    }).catch( err => {
      log.error("TwitDB", "Error retrieving profile: %s", err.Error);
      throw err;
    });
  },

  get_matrixid_from_twitterid: function (twitter_id) {
    log.silly("SQL", "get_matrixid_from_twitterid => %s", twitter_id);
    return this.db.getAsync(
      `
      SELECT user_id
      FROM twitter_account
      WHERE twitter_id = $id
      `
      , {
        $id: twitter_id
      }).then( row =>{
        return row !== undefined ? row.user_id : null;
      }).catch( err => {
        log.error("TwitDB", "Error retrieving linked userid: %s", err.Error);
        throw err;
      });
  },

  get_linked_user_ids: function () {
    log.silly("SQL", "get_linked_user_ids");
    return this.db.allAsync(
      `
      SELECT user_id
      FROM twitter_account
      WHERE access_token IS NOT NULL
      `
    ).then(rows => {
      if(rows !== undefined) {
        rows.forEach(function (val, i, arr) { arr[i] = val.user_id; });
        return rows;
      }
      else {
        return [];
      }
    }).catch(err => {
      log.error("TwitDB", "Error retrieving linked ids: %s", err.Error);
      throw err;
    });
  },

  set_twitter_account: function (user_id, twitter_id, data) {
    log.silly("SQL", "set_twitter_account => %s", twitter_id);
    return this.db.runAsync(
      `
      REPLACE INTO twitter_account (
        user_id,
        oauth_token,
        oauth_secret,
        access_token,
        access_token_secret,
        access_type,
        twitter_id
      ) VALUES (
        $user_id,
        $oauth_token,
        $oauth_secret,
        $access_token,
        $access_token_secret,
        $access_type,
        $twitter_id
      );
      `
    , {
      $user_id: user_id,
      $twitter_id: twitter_id,
      $oauth_token: data.oauth_token,
      $oauth_secret: data.oauth_secret,
      $access_token: data.access_token,
      $access_token_secret: data.access_token_secret,
      $access_type: data.access_type
    }).then(() => {
      log.info("TwitDB", "Stored client data for %s", user_id);
    }).catch(err => {
      log.error("TwitDB", "Error storing client data: %s", err);
      throw err;
    });
  },

  remove_twitter_account: function (user_id) {
    log.silly("SQL", "remove_client_data => %s", user_id);
    return this.db.runAsync(
      `
      DELETE FROM twitter_account
      WHERE twitter_account.user_id = $user_id;
      `
    , {
      $user_id: user_id
    }).catch(err =>{
      log.error("TwitDB", "Error deleting client data for user: %s", err);
      throw err;
    });
  }
}
