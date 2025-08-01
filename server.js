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

  let workers = null;
  const rooms = [];

  const initMediaSoup = async () => {
    workers = await createWorkers();
  };

  initMediaSoup();

  io.on("connect", (socket) => {
    let client;

    socket.on("joinRoom", async ({ userName, roomName }, ackCb) => {
      let newRoom = false;
      client = new Client(userName, socket);
      let requestedRoom = rooms.find((room) => room.roomName === roomName);
      if (!requestedRoom) {
        newRoom = true;
        const workerToUse = await getWorker(workers);
        requestedRoom = new Room(roomName, workerToUse);
        await requestedRoom.createRouter(io);
        rooms.push(requestedRoom);
      }
      client.room = requestedRoom;
      client.room.addClient(client);
      socket.join(client.room.roomName);

      const audioPidsToCreate = client.room.activeSpeakerList.slice(0, 2);
      const videoPidsToCreate = audioPidsToCreate.map((aid) => {
        const producingClient = client.room.clients.find(
          (c) => c?.producer?.audio?.id === aid
        );
        return producingClient?.producer?.video?.id;
      });
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
      let clientTransportParams;
      if (type === "producer") {
        clientTransportParams = await client.addTransport(type);
      } else if (type === "consumer") {
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
            await client.upstreamTransport.transport.connect({
              dtlsParameters,
            });
            ackCb("success");
          } catch (error) {
            console.error("Error connecting upstream transport:", error);
            ackCb("error");
          }
        } else if (type === "consumer") {
          try {
            const downstreamTransport = client.downstreamTransports.find(
              (t) => t.associatedAudioPid === audioPid
            );
            if (!downstreamTransport?.transport) {
              throw new Error("Downstream transport not found");
            }
            await downstreamTransport.transport.connect({ dtlsParameters });
            ackCb("success");
          } catch (error) {
            console.error("Error connecting downstream transport:", error);
            ackCb("error");
          }
        }
      }
    );

    socket.on("startProducing", async ({ kind, rtpParameters }, ackCb) => {
      try {
        const newProducer = await client.upstreamTransport.transport.produce({
          kind,
          rtpParameters,
        });
        client.addProducer(kind, newProducer);
        if (kind === "audio") {
          client.room.activeSpeakerList.push(newProducer.id);
        }
        ackCb(newProducer.id);

        const newTransportsByPeer = updateActiveSpeakers(client.room, io);
        for (const [socketId, audioPidsToCreate] of Object.entries(
          newTransportsByPeer
        )) {
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
            activeSpeakerList: client.room.activeSpeakerList.slice(0, 2),
          });
        }
      } catch (err) {
        console.error("Error creating producer:", err);
        ackCb("error");
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
      try {
        if (
          !client.room.router.canConsume({ producerId: pid, rtpCapabilities })
        ) {
          ackCb("cannotConsume");
        } else {
          const downstreamTransport = client.downstreamTransports.find((t) => {
            if (kind === "audio") {
              return t.associatedAudioPid === pid;
            } else if (kind === "video") {
              return t.associatedVideoPid === pid;
            }
          });
          const newConsumer = await downstreamTransport.transport.consume({
            producerId: pid,
            rtpCapabilities,
            paused: true,
          });
          client.addConsumer(kind, newConsumer, downstreamTransport);
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
      const consumerToResume = client.downstreamTransports.find(
        (t) => t[kind].producerId === pid
      );
      await consumerToResume[kind].resume();
      ackCb();
    });

    socket.on("disconnect", () => {
      if (!client || !client.room) {
        console.warn("Disconnect: Client or room not initialized");
        return;
      }

      try {
        const room = client.room;
        // Emit the audio producer ID for the disconnected client
        io.to(room.roomName).emit("clientDisconnected", {
          producerId: client.producer?.audio?.id,
        });

        // Remove client from room and active speaker list
        room.removeClient(client);
        room.activeSpeakerList = room.activeSpeakerList.filter(
          (pid) => pid !== client.producer?.audio?.id
        );

        // Clean up client resources
        client.close();

        // Update active speakers for remaining clients
        const newTransportsByPeer = updateActiveSpeakers(room, io);
        for (const [socketId, audioPidsToCreate] of Object.entries(
          newTransportsByPeer
        )) {
          const videoPidsToCreate = audioPidsToCreate.map((aPid) => {
            const producerClient = room.clients.find(
              (c) => c?.producer?.audio?.id === aPid
            );
            return producerClient?.producer?.video?.id;
          });
          const associatedUserNames = audioPidsToCreate.map((aPid) => {
            const producerClient = room.clients.find(
              (c) => c?.producer?.audio?.id === aPid
            );
            return producerClient?.userName;
          });
          io.to(socketId).emit("newProducersToConsume", {
            routerRtpCapabilities: room.router.rtpCapabilities,
            audioPidsToCreate,
            videoPidsToCreate,
            associatedUserNames,
            activeSpeakerList: room.activeSpeakerList.slice(0, 2),
          });
        }

        // Remove empty room if no clients remain
        if (room.clients.length === 0) {
          const roomIndex = rooms.findIndex(
            (r) => r.roomName === room.roomName
          );
          if (roomIndex !== -1) {
            rooms.splice(roomIndex, 1);
            room.close();
          }
        }

        socket.leave(room.roomName);
      } catch (err) {
        console.error("Error handling disconnect:", err);
      }
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
