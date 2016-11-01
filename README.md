matrix-appservice-twitter
=========================

Twitter bridge for Matrix.

### Using master is discouraged right now. Please use the develop branch until a release is made.

### Please [visit this page](https://half-shot.github.io/matrix-appservice-twitter/) for a prettier introduction.

See [#twitter:half-shot.uk](https://matrix.to/#/#twitter:half-shot.uk) for dev discussion and help.

# Requirements

- NodeJS
- A twitter account
  - A phone number (Twitter requires this to generate application tokens)

# Features

- Current (alpha-like quality)
  - Read and follow a users timeline
  - Send tweets to yourself and other users
  - Follow hashtags
  - Direct Messaging
  - Read your own timeline
- To be completed
  - Reply to specific tweets

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

The URL should be replaced by the domain/ip and port of the bridge. In this case you can usually leave it as http://localhost:9000 if you plan to run it on the same server as synapse and will be keeping the default port.

Copy/symlink the generated registration file to your synapse directory and finally edit your ``homeserver.yaml`` file for synapse so that the bridge is registered. This means changing ``app_service_config_files`` and inserting the name of your config file into the list. It should look similar to this:

```
app_service_config_files: ["twitter-registration.yaml"]
```

You can restart synapse after this.

# Running

Simply run ``node twitter-as.js -p 9000 -c config.yaml`` from the repo directory.

The bridge should authenticate and be ready for use.

# Usage

## Linking your Twitter account to your Matrix user.

Linking is not required for reading timelines/hashtags, but **interactions must be completed under your own account**.

* Create a room and invite ``@twitbot:yourdomain``.
* Send the message `link account`
* Follow the URL and instructions. Copy the PIN code
* Enter the pin code directly into the room and your account should be linked up.

## User Timelines

Simply join ``@twitter_@screennamegoeshere:yourdomain`` to read a users timeline. Protected timelines are currently not available.

Accounts which are bridged (Twitter<->Matrix) will be able to send tweets to these timelines (you do not need to put the @screen_name, it is done automatically)

## Hashtags

Join ``@twitter_#hashtaggoeshere`` to follow a particular hashtag.

Accounts which are bridged (Twitter<->Matrix) will be able to send tweets which will automatically apply this tag.
