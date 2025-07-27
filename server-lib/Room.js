import config from "./config.js"; //import our config file
import newDominantSpeaker from "./newDominantSpeaker.js"; //import the function to handle new dominant speakers

// Rooms are not a MediaSoup thing. MS cares about mediastreams, transports,
// things like that. It doesn't care, or know, about rooms.
// Rooms can be inside of clients, clients inside of rooms,
// transports can belong to rooms or clients, etc.
class Room {
  constructor(roomName, workerToUse) {
    this.roomName = roomName;
    this.worker = workerToUse;
    this.router = null;
    //all the Client objects that are in this room
    this.clients = [];
    //an array of id's with the most recent dominant speaker first
    this.activeSpeakerList = [];
  }
  addClient(client) {
    this.clients.push(client);
  }
  createRouter(io) {
    return new Promise(async (resolve) => {
      this.router = await this.worker.createRouter({
        mediaCodecs: config.routerMediaCodecs,
      });
      this.activeSpeakerObserver =
        await this.router.createActiveSpeakerObserver({
          interval: 300, //300 is default
        });
      this.activeSpeakerObserver.on("dominantspeaker", (ds) =>
        newDominantSpeaker(ds, this, io)
      );
      resolve();
    });
  }
}

export default Room;
