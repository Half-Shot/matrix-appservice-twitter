var https   = require('https');
var http   = require('http');

var Buffer  = require("buffer").Buffer;
var log     = require('npmlog');
var mime    = require('mime');

/**
  Utility module for regularly used functions.
*/

/**
 * downloadFile - This function will take a URL, upload it to Matrix and return
 * the corresponding MXC url in a Promise. The content will be uploaded on the
 * users behalf using the ID, or the AS bot if set to null.
 *
 * @param  {string} url      The URL to be downloaded from.
 * @return {Promise<Buffer>} A promise that will return a buffer with the data.
 */
function downloadFile(url){
  return new Promise((resolve, reject) => {

    if(url.startsWith("https")){
      var ht = https;
    }
    else {
      var ht = http;
    }

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
function uploadContentFromUrl(bridge, url, id, name) {
    var contenttype;
    id = id || null;
    name = name || null;
    return new Promise((resolve, reject) => {

        if(url.startsWith("https")){
          var ht = https;
        }
        else {
          var ht = http;
        }

        ht.get((url), (res) => {
            if(res.headers.hasOwnProperty("content-type")){
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
        if(typeof id == "string" || id == null){
            id = bridge.getIntent(id);
        }
        return id.getClient().uploadContent({
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

module.exports = {
    uploadContentFromUrl: uploadContentFromUrl,
    downloadFile: downloadFile
}
