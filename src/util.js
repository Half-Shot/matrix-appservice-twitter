var https   = require('https');
var Buffer  = require("buffer").Buffer;
var log     = require('npmlog');

/*
  This function will take a URL, upload it to Matrix and return the corresponding
  MXC url in a Promise. The content will be uploaded on the users behalf using
  the ID, or the AS bot if set to null.
*/
function uploadContentFromUrl(bridge, url, id = null, name = null) {
    var contenttype;
    console.log(url);
    return new Promise((resolve, reject) => {
        https.get((url), (res) => {
            contenttype = res.headers["content-type"];
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
    uploadContentFromUrl: uploadContentFromUrl
}
