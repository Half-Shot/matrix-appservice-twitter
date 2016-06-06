# matrix-appservice-twitter

Twitter AS bridge for Matrix.

# Requriements

- Node
- A twitter account
  - A phone number (Twitter requires this to generate application tokens)

# Features

- Current (alpha-like quality)
  - Read and follow a users timeline
- To be complete
  - Follow hashtags
  - Reply to users
  - Read your own timeline
  - Direct Messaging

# Installation

(We expect you to be running a standard synapse setup for these instructions)

Clone this repo and install the npm dependencies as usual

```
git clone https://github.com/Half-Shot/matrix-appservice-twitter
npm install
```

You will need a twitter application authentication token and secret to continue.

Go to https://apps.twitter.com/ and create a new app. If you follow the tedious setup all the way through you should be given all you need to fill in a config.yaml file. Copy ``config.sample.yaml`` and fill in the blanks before saving as ``config.yaml``.

Next, we need to generate the appropriate registration config so that synapse can interface with the bridge. 

```
node twitter-as.js -r -u "URL"
```


URL should be replaced by the domain/ip and port of the bridge. In this case you can usually leave it as http://localhost:9000
if you plan to run it on the same server as synapse and will be keeping the default port.

Copy/symlink the generated registration file to your synapse directory and finally edit your ``homeserver.yaml`` file for syanpse so that the bridge is registered. This means changing ``app_service_config_files`` and inserting the name of your config file into the list. It should look similar to this:

```
app_service_config_files: ["twitter-registration.yaml"]
```

You can restart synapse after this. The bridge should show up somewhere in the log output of synapse.

# Running

Simply run ``node twitter-as.js -p 9000 -c config.yaml`` from the repo directory.

The bridge should authenticate and be ready for use.

# Usage

## User Timelines

Simply join ``@twitter_@screennamegoeshere:yourdomain`` to read a users timeline.
