All of these API requests can return a 500 if something fails that wasn't expected.

## /_matrix/provision/%roomId%/link/timeline/%screenName%?=%userId
## /_matrix/provision/%roomId%/link/hashtag/%hashtag%?=%userId

PUT - Create a new link

DELETE - Remove an existing link

| Param          | Description     |
| :------------- | :------------- |
| roomId | Matrix Room ID |
| screenName | The screenname of the timeline to add (without @) |
| hashtag | The hashtag to add (without #) |
| userId | The user that is requesting the bridge |

| Return Code    | Reason     |
| :------------- | :------------- |
| 200 | the bridge OKed it or the link already exists |
| 401 | the user is unauthorized to create links |
| 403 | the bridge could not join the room itself |
| 404 | the room or the profile wasn't found |

```
{
  "message": Error message if did not complete successfully.
}
```

## GET /_matrix/provision/%roomId%/links

Retrieve links for the given room.

| Param          | Description     |
| :------------- | :------------- |
| roomId | Matrix Room ID |

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

## GET /_matrix/provision/show/timeline/%screenName%

Retrive some profile information about a timeline.

| Return Code    | Reason     |
| :------------- | :------------- |
| 200 | the bridge OKd it and 0 or more results exist |
| 404 | the room  wasn't found |

| Param          | Description     |
| :------------- | :------------- |
| screenName | The screenname of the timeline to add (without @) |

```
{
  twitterId:
  name:
  screenName:
  avatarUrl:
  description:
}
```
