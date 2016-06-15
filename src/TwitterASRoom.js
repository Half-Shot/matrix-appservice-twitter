var TwitterASRoom = function (bridge, local, remote) {
  this._localroom = local;
  this._remoteroom = remote;
  this._bridge = bridge;
}

TwitterASRoom.prototype.onEvent(request, context){
  console.log("Room got event");
}
