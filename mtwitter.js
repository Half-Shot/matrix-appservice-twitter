var Twitter = require('twitter');
var Request = require('request');
var fs = require('fs');
var Buffer = require('buffer').Buffer;

var mtwitter = function(config){
  this.app_auth = config.app_auth;
  this.app_twitter = null;
  
  this.get_bearer_token = function(cb){
    
    try{
      fs.accessSync('bearer.tok',fs.R_OK);
      var tok = fs.readFileSync('bearer.tok', 'utf8');
      cb(tok);
      return;
    }
    catch(e){
      console.log("Bearer token either does not exist or cannot be read, getting a new token.")
    }
    
    var key = this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret;
    key = Buffer.from(this.app_auth.consumer_key + ":" + this.app_auth.consumer_secret,'ascii').toString('base64');
    var options = {
      url: "https://api.twitter.com/oauth2/token",
      headers: {
        'Authorization': "Basic " +  key
      },
      form: "grant_type=client_credentials",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8"
    };
    Request.post(options,function (error,response,body){
      if(error){
          console.log("Error",error);
          return false;
      } else {
          try{
            var jsonresponse = JSON.parse(body);
            if(jsonresponse.token_type == "bearer"){
              fs.writeFile("bearer.tok",jsonresponse.access_token, (err) => {
                if(err){
                  console.console.error("Couldn't write bearer token to file.");
                }
              });
              cb(jsonresponse.bearer_token);
            } 
            else {
              console.error("Error getting bearer token: Unexpected response");
              cb(null);
            }
          }
          catch(e){
            console.error("Error getting bearer token:",e);
            cb(null);
          }

      }
    });
  }
  
  this.get_bearer_token((bt) => {
    if(bt != false){
      this.app_auth.bearer_token = bt;
      console.log("Twitter Application Auth OK!");
      this.app_twitter = new Twitter(this.app_auth);
    }
    else {
      console.error("Twitter Application Failed Auth. The bridge will be operating in a limited capacity.");
    }
  });

  
  this.get_user = function(name,cb){
    console.log("Looking up " + name);
    this.app_twitter.get('users/show',{screen_name: name}, function(error, user, response){
      if(error){
        console.error(error);
        cb(null);
      }
      else {
        cb(user);
      }
    })
  }
  
}

// this.init: function(config){
//   this._twitter = new Twitter({
//     consumer_key: '',
//     consumer_secret: '',
//     bearer_token: ''
//   });
// }
// get_user: function(name){
//   return {
//     name: name
//   };
// }

module.exports = {
    MatrixTwitter: mtwitter
}
