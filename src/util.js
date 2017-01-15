const https   = require('https');
const http   = require('http');

const Buffer  = require("buffer").Buffer;
const log     = require('./logging.js');
const mime    = require('mime');
const Promise = require('bluebird');

/**
  Utility module for regularly used functions.
*/

/**
 * downloadFile - This function will take a URL and store the resulting data into
 * a buffer.
 *
 * @param  {string} url      The URL to be downloaded from.
 * @return {Promise<Buffer>} A promise that will return a buffer with the data.
 */
function downloadFile (url) {
  return new Promise((resolve, reject) => {

    const ht = url.startsWith("https") ? https : http;
    const req = ht.get((url), (res) => {
      var buffer = Buffer.alloc(0);
      if(res.statusCode !== 200) {
        reject(`Non 200 status code (${res.statusCode}) `)
      }

      res.on('data', (d) => {
        buffer = Buffer.concat([buffer, d]);
      });

      res.on('end', () => {
        resolve(buffer);
      });
    });
    req.on('error', (err) =>{
      reject(`Failed to download. ${err.code}`);
    });
  });
}

function formatStringFromObject (fmtstring, obj) {
  Object.keys(obj).forEach(key => {
    fmtstring = fmtstring.replace(`%${key}`, obj[key]);
  });
  return fmtstring;
}


/**
 * uploadContentFromUrl - Upload content from a given URL to the homeserver
 * and return a MXC URL.
 *
 * @param  {type} bridge      The bridge object of this application
 * @param  {type} url         The URL to be downloaded from.
 * @param  {type} [id]        Either the ID of the uploader, or a Intent object
 * @param  {type} [name]      Name of the file. Will use the URL filename otherwise.
 * @return {Promise<string>}  Promise resolving with a MXC URL.
 */
function uploadContentFromUrl (bridge, url, id, name) {
  var contenttype;
  let size;
  id = id || null;
  name = name || null;
  return new Promise((resolve, reject) => {

    const ht = url.startsWith("https") ? https : http;
    const req = ht.get((url), (res) => {
      let buffer = Buffer.alloc(0);

      if(res.headers.hasOwnProperty("content-type")) {
        contenttype = res.headers["content-type"];
      }
      else{
        log.verbose("UploadContent", "No content-type given by server, guessing based on file name.");
        contenttype = mime.lookup(url);
      }

      if (name === null) {
        name = url.split("/");
        name = name[name.length - 1];
      }

      res.on('data', (d) => {
        buffer = Buffer.concat([buffer, d]);
      });

      res.on('end', () => {
        resolve(buffer);
      });
    });
    req.on('error', (err) =>{
      reject(`Failed to download. ${err.code}`);
    });
  }).then((buffer) => {
    size = buffer.length;
    if(id === null || typeof id === "string") {
      id = bridge.getIntent(id);
    }
    return id.getClient().uploadContent({
      stream: buffer,
      name,
      type: contenttype
    });
  }).then((response) => {
    var content_uri = JSON.parse(response).content_uri;
    log.verbose("UploadContent", "Media uploaded to %s", content_uri);
    return {
      mxc_url: content_uri,
      size
    };
  }).catch(function (reason) {
    log.error("UploadContent", "Failed to upload content:\n%s", reason);
    throw reason;
  });

}

function isRoomId (room_id) {
  return /^!(\w+):(\S+)$/.test(room_id)
}

function isUserId (user_id) {
  return /^@(\S+):(\S+)$/.test(user_id)
}


function isAlphanumeric (str) {
  return /^[a-z0-9]+$/i.test(str)
}

function roomPowers (users) {
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

/**
 * isStrInteger - Checks a string is a integer
 *
 * @param  {string} str
 * @return {bool}
 */
function isStrInteger (str) {
  return /^[0-9]+$/.test(str);
}

function isTwitterScreenName (str) {
  return /^[a-zA-Z0-9_]{1,15}$/.test(str);
}

function isTwitterHashtag (str) {
  return /^[a-zA-Z0-9_]+$/.test(str);
}

module.exports = {
  uploadContentFromUrl,
  downloadFile,
  isStrInteger,
  isRoomId,
  isUserId,
  isAlphanumeric,
  roomPowers,
  isTwitterScreenName,
  isTwitterHashtag,
  formatStringFromObject,
}
