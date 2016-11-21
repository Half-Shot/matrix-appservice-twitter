## /_matrix/provision/%roomId%/link/timeline/%screenName%?userId=%userId
## /_matrix/provision/%roomId%/link/hashtag/%hashtag%?userId=%userId
### Methods

PUT Create a new link. Can also be used to reconfigure an existing room.

DELETE Remove an existing link

### Parameters

| Param          | Description     |
| :------------- | :-------------  |
| roomId | Matrix Room ID |
| screenName | The screenname of the timeline to add (without @) |
| hashtag | The hashtag to add (without #) |
| userId | The user that is requesting the bridge |

## Body
The body is used to pass additional options to the room.
These options can also be used to update the existing room, though currently
only the timeline can be modified.

Only used for PUT

| Option          | Description    |
| :-------------  | :------------- |
| exclude_replies | Don't show replies to mentions by the user. |

### Return Codes

| Return Code    | Reason         |
| :------------- | :------------- |
| 200 | the bridge has updated or deleted the link |
| 201 | the bridge has created a new link |
| 401 | the user is unauthorized to create links |
| 403 | the bridge could not join the room itself |
| 404 | the room or the profile wasn't found |

#### 200

```
{
  "message":"Link updated" || "Hashtag already bridged!"
}
```

#### 201

```
{
  "message":"Linked successfully"
}
```

## /_matrix/provision/%roomId%/links
### Methods

GET Retrieve links for the given room.

### Parameters

| Param          | Description    |
| :------------- | :------------- |
| roomId | Matrix Room ID |

### Return Codes

| Return Code    | Reason     |
| :------------- | :------------- |
| 200 | the bridge OKd it and 0 or more results exist |
| 404 | the room  wasn't found |


```
{
  "timelines":[
    {
      //Profile information (same as /show/timeline)
    }
  ]
  "hasttags":[
    //List of strings without #
    "foo", "bar"
  ]
}
```

## /_matrix/provision/show/timeline/%screenName%
### Methods

GET Retrive some profile information about a timeline.

### Parameters

| Param          | Description     |
| :------------- | :------------- |
| screenName | The screenname of the timeline to add (without @) |

### Return Codes

| Return Code    | Reason     |
| :------------- | :------------- |
| 200 | The Twitter user was found. |
| 404 | The Twitter user wasn't found |


```
{
  twitterId: "366675043"
  name: "Half-Shot"
  screenName: "Half_Shot"
  avatarUrl: "https://pbs.twimg.com/profile_images/796729706318012418/VdozW4mO.jpg"
  description: "Software Dev | Woof. ❤ @MaxwellKepler . I do @matrixdotorg stuff sometimes."
}
```

### Errors

Errors will take the form of a non-``200`` status code and a object like below.
In addition a ``500`` error can happen if something unexpected occurs on the
server.

```
{
  "message": "The toast was burnt."
}
```
