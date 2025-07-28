const updateActiveSpeakers = (room, io) => {
  //this function is called on newDominantSpeaker, or a new peer produces
  // mutes existing consumers/producer if below 5, for all peers in room
  // unmutes existing consumers/producer if in top 5, for all peers in room
  // return new transports by peer
  //called by either activeSpeakerObserver (newDominantSpeaker) or startProducing

  const activeSpeakers = room.activeSpeakerList.slice(0, 2);
  const mutedSpeakers = room.activeSpeakerList.slice(2);
  const newTransportsByPeer = {};
  // loop through all connected clients in the room
  room.clients.forEach((client) => {
    // loop through all clients to mute
    mutedSpeakers.forEach((pid) => {
      // pid is the producer id we want to mute
      if (client?.producer?.audio?.id === pid) {
        // this client is the produer. Mute the producer

        client?.producer?.video.pause();
        return;
      }
      const downstreamToStop = client.downstreamTransports.find(
        (t) => t?.audio?.producerId === pid
      );
      if (downstreamToStop) {
        // found the audio, mute both

        downstreamToStop.video.pause();
      } //no else. Do nothing if no match
    });
    // store all the pid's this client is not yet consuming
    const newSpeakersToThisClient = [];
    activeSpeakers.forEach((pid) => {
      if (client?.producer?.audio?.id === pid) {
        // this client is the produer. Resume the producer

        client?.producer?.video.resume();
        return;
      }
      // can grab pid from the audio.producerId like above, or use our own associatedAudioPid
      const downstreamToStart = client.downstreamTransports.find(
        (t) => t?.associatedAudioPid === pid
      );
      if (downstreamToStart) {
        // we have a match. Just resume
        downstreamToStart?.audio.resume();
        downstreamToStart?.video.resume();
      } else {
        // this client is not consuming... start the process
        newSpeakersToThisClient.push(pid);
      }
    });
    if (newSpeakersToThisClient.length) {
      // this client has at least 1 new consumer/transport to make
      // at socket.id key, put the array of newSpeakers to make
      // if there were no newSpeakers, then there will be no key for that client
      newTransportsByPeer[client.socket.id] = newSpeakersToThisClient;
    }
  });
  // client loop is done. We have muted or unmuted all producers/consumers
  // based on the new activeSpeakerList. Now, send out the consumers that
  // need to be made.
  // Broadcast to this room
  io.to(room.roomName).emit("updateActiveSpeakers", activeSpeakers);
  return newTransportsByPeer;
};

export default updateActiveSpeakers;
