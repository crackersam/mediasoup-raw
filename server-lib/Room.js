import config from "./config.js";
import newDominantSpeaker from "./newDominantSpeaker.js";

class Room {
  constructor(roomName, workerToUse) {
    this.roomName = roomName;
    this.worker = workerToUse;
    this.router = null;
    this.clients = [];
    this.activeSpeakerList = [];
    this.activeSpeakerObserver = null;
  }

  addClient(client) {
    if (client && !this.clients.includes(client)) {
      this.clients.push(client);
    } else {
      console.warn(
        `Invalid or duplicate client not added to room ${this.roomName}`
      );
    }
  }

  removeClient(client) {
    if (!client) {
      console.warn(
        `Invalid client provided for removal from room ${this.roomName}`
      );
      return;
    }
    // Remove client from clients array
    const index = this.clients.indexOf(client);
    if (index !== -1) {
      this.clients.splice(index, 1);
    } else {
      console.warn(`Client not found in room ${this.roomName}`);
    }
    // Remove client's audio producer from activeSpeakerList, if it exists
    if (client.producer?.audio?.id) {
      const audioPidIndex = this.activeSpeakerList.indexOf(
        client.producer.audio.id
      );
      if (audioPidIndex !== -1) {
        this.activeSpeakerList.splice(audioPidIndex, 1);
      }
    }
  }

  createRouter(io) {
    return new Promise(async (resolve, reject) => {
      try {
        this.router = await this.worker.createRouter({
          mediaCodecs: config.routerMediaCodecs,
        });
        this.activeSpeakerObserver =
          await this.router.createActiveSpeakerObserver({
            interval: 300,
          });
        this.activeSpeakerObserver.on("dominantspeaker", (ds) => {
          try {
            newDominantSpeaker(ds, this, io);
          } catch (err) {
            console.error(
              `Error handling dominant speaker in room ${this.roomName}:`,
              err
            );
          }
        });
        resolve();
      } catch (err) {
        console.error(`Error creating router for room ${this.roomName}:`, err);
        reject(err);
      }
    });
  }

  // Optional: Clean up room resources
  close() {
    try {
      if (this.router) {
        this.router.close();
        this.router = null;
      }
      if (this.activeSpeakerObserver) {
        this.activeSpeakerObserver.close();
        this.activeSpeakerObserver = null;
      }
      this.clients = [];
      this.activeSpeakerList = [];
    } catch (err) {
      console.error(`Error closing room ${this.roomName}:`, err);
    }
  }
}

export default Room;
