import { createServer } from "node:https";
import next from "next";
import { Server } from "socket.io";
import fs from "node:fs";
import path from "node:path";
import createWorkers from "./server-lib/createWorkers.js";
import Room from "./server-lib/Room.js";
import Client from "./server-lib/Client.js";
import getWorker from "./server-lib/getWorker.js";
import updateActiveSpeakers from "./server-lib/updateActiveSpeakers.js";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();
const __dirname = new URL(".", import.meta.url).pathname;
const options = {
  key: fs.readFileSync(path.join(__dirname, "ssl/server.key")),
  cert: fs.readFileSync(path.join(__dirname, "ssl/server.crt")),
};

app.prepare().then(() => {
  const httpServer = createServer(options, handler);

  const io = new Server(httpServer);

  //our globals
  //init workers, it's where our mediasoup workers will live
  let workers = null;
  // router is now managed by the Room object
  // master rooms array that contains all our Room object
  const rooms = [];

  //initMediaSoup gets mediasoup ready to do its thing
  const initMediaSoup = async () => {
    workers = await createWorkers();
    // console.log(workers)
  };

  initMediaSoup(); //build our mediasoup server/sfu

  // socketIo listeners
  io.on("connect", (socket) => {
    // this is where this client/user/socket lives!
    let client; //this client object available to all our socket listeners

    //you could now check handshake for password, auth, etc.
    socket.on("joinRoom", async ({ userName, roomName }, ackCb) => {
      let newRoom = false;
      client = new Client(userName, socket);
      let requestedRoom = rooms.find((room) => room.roomName === roomName);
      if (!requestedRoom) {
        newRoom = true;
        // make the new room, add a worker, add a router
        const workerToUse = await getWorker(workers);
        requestedRoom = new Room(roomName, workerToUse);
        await requestedRoom.createRouter(io);
        rooms.push(requestedRoom);
      }
      // add the room to the client
      client.room = requestedRoom;
      // add the client to the Room clients
      client.room.addClient(client);
      // add this socket to the socket room
      socket.join(client.room.roomName);

      //fetch the first 0-5 pids in activeSpeakerList
      const audioPidsToCreate = client.room.activeSpeakerList.slice(0, 2);
      //find the videoPids and make an array with matching indicies
      // for our audioPids.
      const videoPidsToCreate = audioPidsToCreate.map((aid) => {
        const producingClient = client.room.clients.find(
          (c) => c?.producer?.audio?.id === aid
        );
        return producingClient?.producer?.video?.id;
      });
      //find the username and make an array with matching indicies
      // for our audioPids/videoPids.
      const associatedUserNames = audioPidsToCreate.map((aid) => {
        const producingClient = client.room.clients.find(
          (c) => c?.producer?.audio?.id === aid
        );
        return producingClient?.userName;
      });

      ackCb({
        routerRtpCapabilities: client.room.router.rtpCapabilities,
        newRoom,
        audioPidsToCreate,
        videoPidsToCreate,
        associatedUserNames,
      });
    });
    socket.on("requestTransport", async ({ type, audioPid }, ackCb) => {
      // whether producer or consumer, client needs params
      let clientTransportParams;
      if (type === "producer") {
        // run addClient, which is part of our Client class
        clientTransportParams = await client.addTransport(type);
      } else if (type === "consumer") {
        // we have 1 trasnport per client we are streaming from
        // each trasnport will have an audio and a video producer/consumer
        // we know the audio Pid (because it came from dominantSpeaker), get the video
        const producingClient = client.room.clients.find(
          (c) => c?.producer?.audio?.id === audioPid
        );
        const videoPid = producingClient?.producer?.video?.id;
        clientTransportParams = await client.addTransport(
          type,
          audioPid,
          videoPid
        );
      }
      ackCb(clientTransportParams);
    });
    socket.on(
      "connectTransport",
      async ({ dtlsParameters, type, audioPid }, ackCb) => {
        if (type === "producer") {
          try {
            await client.upstreamTransport.connect({ dtlsParameters });
            ackCb("success");
          } catch (error) {
            console.log(error);
            ackCb("error");
          }
        } else if (type === "consumer") {
          // find the right transport, for this consumer
          try {
            const downstreamTransport = client.downstreamTransports.find(
              (t) => {
                return t.associatedAudioPid === audioPid;
              }
            );
            downstreamTransport.transport.connect({ dtlsParameters });
            ackCb("success");
          } catch (error) {
            console.log(error);
            ackCb("error");
          }
        }
      }
    );
    socket.on("startProducing", async ({ kind, rtpParameters }, ackCb) => {
      // create a producer with the rtpParameters we were sent
      try {
        const newProducer = await client.upstreamTransport.produce({
          kind,
          rtpParameters,
        });
        //add the producer to this client obect
        client.addProducer(kind, newProducer);
        if (kind === "audio") {
          client.room.activeSpeakerList.push(newProducer.id);
        }
        // the front end is waiting for the id
        ackCb(newProducer.id);
      } catch (err) {
        console.log(err);
        ackCb(err);
      }

      // run updateActiveSpeakers
      const newTransportsByPeer = updateActiveSpeakers(client.room, io);
      // newTransportsByPeer is an object, each property is a socket.id that
      // has transports to make. They are in an array, by pid
      for (const [socketId, audioPidsToCreate] of Object.entries(
        newTransportsByPeer
      )) {
        // we have the audioPidsToCreate this socket needs to create
        // map the video pids and the username
        const videoPidsToCreate = audioPidsToCreate.map((aPid) => {
          const producerClient = client.room.clients.find(
            (c) => c?.producer?.audio?.id === aPid
          );
          return producerClient?.producer?.video?.id;
        });
        const associatedUserNames = audioPidsToCreate.map((aPid) => {
          const producerClient = client.room.clients.find(
            (c) => c?.producer?.audio?.id === aPid
          );
          return producerClient?.userName;
        });
        io.to(socketId).emit("newProducersToConsume", {
          routerRtpCapabilities: client.room.router.rtpCapabilities,
          audioPidsToCreate,
          videoPidsToCreate,
          associatedUserNames,
          activeSpeakerList: client.room.activeSpeakerList.slice(0, 5),
        });
      }
    });
    socket.on("audioChange", (typeOfChange) => {
      if (typeOfChange === "mute") {
        client?.producer?.audio?.pause();
      } else {
        client?.producer?.audio?.resume();
      }
    });
    socket.on("consumeMedia", async ({ rtpCapabilities, pid, kind }, ackCb) => {
      // will run twice for every peer to consume... once for video, once for audio
      console.log("Kind: ", kind, "   pid:", pid);
      // we will set up our clientConsumer, and send back the params
      // use the right transport and add/update the consumer in Client
      // confirm canConsume
      try {
        if (
          !client.room.router.canConsume({ producerId: pid, rtpCapabilities })
        ) {
          ackCb("cannotConsume");
        } else {
          // we can consume!
          const downstreamTransport = client.downstreamTransports.find((t) => {
            if (kind === "audio") {
              return t.associatedAudioPid === pid;
            } else if (kind === "video") {
              return t.associatedVideoPid === pid;
            }
          });
          // create the consumer with the transport
          const newConsumer = await downstreamTransport.transport.consume({
            producerId: pid,
            rtpCapabilities,
            paused: true, //good practice
          });
          // add this newCOnsumer to the CLient
          client.addConsumer(kind, newConsumer, downstreamTransport);
          // respond with the params
          const clientParams = {
            producerId: pid,
            id: newConsumer.id,
            kind: newConsumer.kind,
            rtpParameters: newConsumer.rtpParameters,
          };
          ackCb(clientParams);
        }
      } catch (err) {
        console.log(err);
        ackCb("consumeFailed");
      }
    });
    socket.on("unpauseConsumer", async ({ pid, kind }, ackCb) => {
      const consumerToResume = client.downstreamTransports.find((t) => {
        return t?.[kind].producerId === pid;
      });
      await consumerToResume[kind].resume();
      ackCb();
    });
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on https://${hostname}:${port}`);
    });
});
