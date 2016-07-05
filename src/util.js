var https   = require('https');
var http   = require('http');

var Buffer  = require("buffer").Buffer;
var log     = require('npmlog');
var mime    = require('mime');


/*
  This function will take a URL, upload it to Matrix and return the corresponding
  MXC url in a Promise. The content will be uploaded on the users behalf using
  the ID, or the AS bot if set to null.
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

function uploadContentFromUrl(bridge, url, id = null, name = null) {
    var contenttype;
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
