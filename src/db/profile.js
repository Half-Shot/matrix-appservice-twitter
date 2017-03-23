const log = require('../logging.js');
const TWITTER_PROFILE_INTERVAL_MS   = 300000;

module.exports = {
  /**
   * Get a twitter profile by a twitter id
   * @param {integer} id A twitter id
   * @returns {Promise<object>} A Twitter profile
   */
  get_profile_by_id: function (id) {
    log.silly("SQL", "get_profile_by_id => %s", id);
    return this.db.getAsync(
      `
      SELECT profile, timestamp
      FROM user_cache
      WHERE user_cache.id = $id;
      `
    , {
      $id: id
    }).then((profile) =>{
      if(profile !== undefined) {
        const ts = new Date().getTime();
        const pro = JSON.parse(profile.profile);
        pro._outofdate =(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS);
        return pro;
      }
      else {
        return null;
      }
    }).catch( err  => {
      log.error("TwitDB", "Error retrieving profile: %s", err.Error);
      throw err;
    });
  },

  /**
   * Get a Twitter profile by the screenname of a user.
   * @param {string} name A twitter screen name.
   * @returns {Promise<object>} A Twitter profile
   */
  get_profile_by_name: function (name) {
    log.silly("SQL", "get_profile_by_name => %s", name);
    return this.db.getAsync(
      `
      SELECT profile, timestamp
      FROM user_cache
      WHERE user_cache.screenname = $name;
      `
    , {
      $name: name
    }).then((profile) =>{
      if(profile !== undefined) {
        const ts = new Date().getTime();
        const pro = JSON.parse(profile.profile);
        pro._outofdate =(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS);
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

  get_profile_from_mxid: function (user_id) {
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
        pro._outofdate =(ts - profile.timestamp >= TWITTER_PROFILE_INTERVAL_MS);
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

  /**
   * Insert/Update a Twitter profile into the database.
   * @param  {string} id        Twitter ID of the profile.
   * @param  {string} screenname      screenname of the profile.
   * @param  {object} data      The profile data.
   * @param  {number} timestamp The time when this data was recieved.
   */
  cache_user_profile: function (id, screenname, data, timestamp) {
    log.silly("SQL", "cache_user_profile => %s", id);
    return this.db.runAsync(
      `
      REPLACE INTO user_cache (id,screenname,profile,timestamp) VALUES ($id,$screenname,$data,$timestamp);
      `
    , {
      $id: id,
      $screenname: screenname,
      $data: JSON.stringify(data),
      $timestamp: timestamp
    }).catch( err => {
      log.error("TwitDB", "Error storing profile: %s", err);
      throw err;
    });
  }
}
