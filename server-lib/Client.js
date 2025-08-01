import config from "./config.js";

class Client {
  constructor(userName, socket) {
    this.userName = userName;
    this.socket = socket;
    this.upstreamTransport = null; // Transport for sending data (producer)
    this.producer = {}; // Audio and video producers
    this.downstreamTransports = []; // Array of transports for consuming data
    this.room = null; // Reference to Room object
  }

  addTransport(type, audioPid = null, videoPid = null) {
    return new Promise(async (resolve, reject) => {
      try {
        const {
          listenIps,
          initialAvailableOutgoingBitrate,
          maxIncomingBitrate,
        } = config.webRtcTransport;
        const transport = await this.room.router.createWebRtcTransport({
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          listenInfos: listenIps,
          initialAvailableOutgoingBitrate,
        });

        if (maxIncomingBitrate) {
          try {
            await transport.setMaxIncomingBitrate(maxIncomingBitrate);
          } catch (err) {
            console.error("Error setting max incoming bitrate:", err);
          }
        }

        const clientTransportParams = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };

        if (type === "producer") {
          this.upstreamTransport = { transport }; // Wrap in object for consistency
        } else if (type === "consumer") {
          this.downstreamTransports.push({
            transport,
            associatedVideoPid: videoPid,
            associatedAudioPid: audioPid,
            audio: null, // Initialize consumer placeholders
            video: null,
          });
        }

        resolve(clientTransportParams);
      } catch (err) {
        console.error("Error creating WebRTC transport:", err);
        reject(err);
      }
    });
  }

  addProducer(kind, newProducer) {
    this.producer[kind] = newProducer;
    if (kind === "audio" && this.room?.activeSpeakerObserver) {
      try {
        this.room.activeSpeakerObserver.addProducer({
          producerId: newProducer.id,
        });
      } catch (err) {
        console.error("Error adding producer to activeSpeakerObserver:", err);
      }
    }
  }

  addConsumer(kind, newConsumer, downstreamTransport) {
    if (downstreamTransport) {
      downstreamTransport[kind] = newConsumer;
    } else {
      console.error("No downstream transport found for consumer:", kind);
    }
  }

  // New method to clean up client resources
  close() {
    // Close upstream transport
    if (this.upstreamTransport?.transport) {
      try {
        this.upstreamTransport.transport.close();
      } catch (err) {
        console.error("Error closing upstream transport:", err);
      }
      this.upstreamTransport = null;
    }

    // Close downstream transports and consumers
    this.downstreamTransports.forEach((transportObj) => {
      if (transportObj.audio) {
        try {
          transportObj.audio.close();
        } catch (err) {
          console.error("Error closing audio consumer:", err);
        }
      }
      if (transportObj.video) {
        try {
          transportObj.video.close();
        } catch (err) {
          console.error("Error closing video consumer:", err);
        }
      }
      if (transportObj.transport) {
        try {
          transportObj.transport.close();
        } catch (err) {
          console.error("Error closing downstream transport:", err);
        }
      }
    });
    this.downstreamTransports = [];

    // Close producers
    if (this.producer.audio) {
      try {
        this.producer.audio.close();
      } catch (err) {
        console.error("Error closing audio producer:", err);
      }
    }
    if (this.producer.video) {
      try {
        this.producer.video.close();
      } catch (err) {
        console.error("Error closing video producer:", err);
      }
    }
    this.producer = {};

    // Clear room reference
    this.room = null;
  }
}

export default Client;
