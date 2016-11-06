var https   = require('https');
var http   = require('http');

var Buffer  = require("buffer").Buffer;
var log     = require('npmlog');
var mime    = require('mime');

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

    var ht = url.startsWith("https") ? https : http;

    ht.get((url), (res) => {
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
    });
  });
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
  id = id || null;
  name = name || null;
  var size;
  return new Promise((resolve, reject) => {

    var ht = url.startsWith("https") ? https : http;

    ht.get((url), (res) => {
      if(res.headers.hasOwnProperty("content-type")) {
        contenttype = res.headers["content-type"];
      }
      else{
        log.info("No content-type given by server, guessing based on file name.");
        contenttype = mime.lookup(url);
      }

      if (name == null) {
        name = url.split("/");
        name = name[name.length - 1];
      }
      size = parseInt(res.headers["content-length"]);
      if(isNaN(size)) {
        reject("Content-Length was not an integer, which is weird.");
        return;
      }
      var buffer;
      if(Buffer.alloc) {//Since 5.10
        buffer = Buffer.alloc(size);
      }
      else {//Deprecated
        buffer = new Buffer(size);
      }

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
    if(id == null || typeof id == "string") {
      id = bridge.getIntent(id);
    }
    return id.getClient().uploadContent({
      stream: buffer,
      name: name,
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
    log.error("UploadContent", "Failed to upload content:\n%s", reason)
  })

}

function isRoomId (room_id) {
  return /^!(\w+):(\S+)$/.test(room_id)
}

function isUserId (user_id) {
  return /^@(\w+):(\S+)$/.test(user_id)
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

module.exports = {
  uploadContentFromUrl,
  downloadFile,
  isStrInteger,
  isRoomId,
  isUserId,
  isAlphanumeric,
  roomPowers
}
