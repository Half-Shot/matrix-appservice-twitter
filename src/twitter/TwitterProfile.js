const log  = require('../logging.js');
const Promise  = require('bluebird');
const util = require("../util.js");
const DISPLAYNAME_FORMAT = "%name (@%screen_name)";
const ROOMNAME_FORMAT = "[Twitter] %name";
const ROOMTOPIC_FORMAT = "%description | https://twitter.com/%screen_name";

class TwitterProfile {
  constructor (twitter, config) {
    this._twitter = twitter;
    this._config = config;
  }

  update (new_profile) {
    return Promise.coroutine(this._update_profile.bind(this))(new_profile);
  }

  * _update_profile (new_profile) {
    var ts = new Date().getTime();
    if(new_profile == null) {
      throw Error("Tried to preform a profile update with a null profile.");
    }

    const old_profile = yield this._twitter.storage.get_profile_by_id(new_profile.id_str);
    if (!this._config.media.enable_profile_images) {
      new_profile.profile_image_url_https = null;
    }

    let update_name = new_profile.name != null;
    let update_avatar = new_profile.profile_image_url_https != null;
    let update_description = new_profile.description != null;
    if(old_profile) { //Does an older profile exist. If not, update everything!
      log.silly(
        `Old profile
        SN:${old_profile.screen_name}
        Name:${old_profile.screen_name}
        Avatar:${old_profile.profile_image_url_https}
        Description:${old_profile.description}`);
      update_name = update_name &&
        this.format_displayname(old_profile) !== this.format_displayname(new_profile);

      //Has the avatar changed.
      update_avatar = update_avatar &&
       (old_profile.profile_image_url_https !== new_profile.profile_image_url_https)

      update_description = update_description &&
       (old_profile.description !== new_profile.description);
    }

    log.silly(
      `New profile
      SN:${new_profile.screen_name}
      Name:${new_profile.screen_name}
      Avatar:${new_profile.profile_image_url_https}
      Description:${new_profile.description}`);

    if(update_description || update_avatar || update_name) {
      log.verbose(`Updating profile for @${new_profile.screen_name}`);
    } else {
      log.verbose(`NOT updating profile for @${new_profile.screen_name}`);
      return Promise.resolve();
    }

    const intent = this._twitter.bridge.getIntentFromLocalpart(`_twitter_${new_profile.id_str}`);

    const rooms = yield this._twitter.bridge.getRoomStore().getEntriesByMatrixRoomData(
      {"twitter_user": new_profile.id_str}
    );


    if(update_name) {
      log.verbose(`Updating displayname for @${new_profile.screen_name}`);
      intent.setDisplayName(this.format_displayname(new_profile));
      rooms.forEach(entry => {
        intent.setRoomName(entry.matrix.getId(), util.formatStringFromObject(ROOMNAME_FORMAT, new_profile));
      });
    }

    if(update_description) {
      log.verbose(`Updating description for @${new_profile.screen_name}`);
      rooms.forEach(entry => {
        intent.setRoomTopic(entry.matrix.getId(), util.formatStringFromObject(ROOMTOPIC_FORMAT, new_profile));
      });
    }

    var url = null;
    if(update_avatar) {
      log.verbose(`Updating avatar for @${new_profile.screen_name}`);
      //We have to replace _normal because it gives us a bad quality image
      // E.g https://pbs.twimg.com/profile_images/796729706318012418/VdozW4mO_normal.jpg
      // becomes https://pbs.twimg.com/profile_images/796729706318012418/VdozW4mO.jpg
      const image_url = new_profile.profile_image_url_https.replace("_normal", "");
      log.verbose(`Updating avatar for @${new_profile.screen_name} with @${image_url}.`);
      url = yield util.uploadContentFromUrl(this._twitter.bridge, image_url);
      url = url.mxc_url;
      intent.setAvatarUrl(url);
      rooms.forEach(entry => {
        intent.setRoomAvatar(entry.matrix.getId(), url);
      });
    }

    return this._twitter.storage.cache_user_profile(new_profile.id_str, new_profile.screen_name, new_profile, ts);
  }

  format_displayname (profile) {
    let fmt = DISPLAYNAME_FORMAT;
    if (this._config.formatting) {
      if (this._config.formatting.user_displayname) {
        fmt = this._config.formatting.user_displayname;
      }
    }
    return util.formatStringFromObject(fmt, profile);
  }

  /**
   * Get a Twitter profile by a users Twitter ID.
   *
   * @param  {number} id Twitter Id
   * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
   * to be returned. See https://dev.twitter.com/rest/reference/get/users/show
   */
  get_by_id (twitter_id) {
    log.info("Looking up T" + twitter_id);
    return this._twitter.storage.get_profile_by_id(twitter_id).then((profile)=>{
      if(profile != null) {
        if(!profile._outofdate) {
          return profile;
        }
      }
      return this._get_profile({user_id: twitter_id});
    });
  }

  /**
   * Get a Twitter profile by a users screen name.
   * @param  {number} id Twitter Screen name
   * @return {Promise<TwitterProfile>} A promise containing the Twitter profile
   * to be returned. See {@link}
   *
   * @see {@link https://dev.twitter.com/rest/reference/get/users/show}
   */
  get_by_screenname (screen_name) {
    log.info("Looking up T" + screen_name);
    return this._twitter.storage.get_profile_by_name(screen_name).then((profile)=>{
      if(profile != null) {
        if(!profile._outofdate) {
          return profile;
        }
      }
      return this._get_profile({screen_name});
    });
  }

  _get_profile (data) {
    return this._twitter.client_factory.get_client().then(client => {
      return client.getAsync('users/show', data).catch(error => {
        if(Array.isArray(error)) {
          error = error[0];
        }
        log.error(
          "_get_profile: GET /users/show returned: %s %s",
          error.code,
          error.message
        );
        return null;
      });
    }).then(user => {
      return this.update(user).thenReturn(user);
    }).catch(err => {
      log.error(
        "_get_profile failed: %s",
        err
      );
    })
  }
}

module.exports = TwitterProfile;
