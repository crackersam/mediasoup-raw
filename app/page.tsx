"use client";
import { useEffect, useState, useRef } from "react";
import { socket } from "../socket";
import { Device, types } from "mediasoup-client";
import createProducerTransport from "@/lib/create-producer-transport";
import createProducer from "@/lib/create-producer";
import requestTransportToConsume from "@/lib/request-transport-to-consume";

// Define the interface for active consumers
interface ActiveConsumer {
  combinedStream: MediaStream;
  userName: string;
  consumerTransport: types.Transport;
  audioConsumer: types.Consumer;
  videoConsumer: types.Consumer;
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [roomName, setRoomName] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const producerTransport = useRef<types.Transport | null>(null);
  const device = useRef<Device | null>(null);
  const producers = useRef<{
    audioProducer: types.Producer;
    videoProducer: types.Producer;
  } | null>(null);
  const joinRoomResp = useRef<{
    activeSpeakerList: string[];
    routerRtpCapabilities: types.RtpCapabilities;
    audioPidsToCreate: string[];
    videoPidsToCreate: string[];
    associatedUserNames: string[];
    newRoom: boolean;
  } | null>(null);
  const [actives, setActives] = useState<ActiveConsumer[]>([]);
  const consumers = useRef<Record<string, ActiveConsumer>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    socket.connect();
    socket.on(
      "newProducersToConsume",
      async (data: {
        audioPidsToCreate: string[];
        activeSpeakerList?: string[];
        routerRtpCapabilities: types.RtpCapabilities;
        videoPidsToCreate: string[];
        associatedUserNames: string[];
      }) => {
        console.log("New producers to consume:", data);
        if (data?.audioPidsToCreate?.length > 0) {
          await requestTransportToConsume(
            data,
            socket,
            device.current,
            consumers
          );
          console.log("Consumers after transport:", consumers.current);
        } else {
          console.warn("No audioPidsToCreate received");
        }
        if (data?.activeSpeakerList?.length) {
          console.log("Active speaker list:", data.activeSpeakerList);
          const newActives = data.activeSpeakerList
            .map((pid: string) => {
              const consumer = consumers.current[pid];
              if (!consumer) {
                console.warn(`No consumer found for producerId: ${pid}`);
              }
              return consumer;
            })
            .filter(
              (consumer): consumer is ActiveConsumer =>
                consumer !== undefined &&
                consumer.audioConsumer.producerId !==
                  producers.current?.audioProducer?.id
            );
          console.log("New actives:", newActives);
          setActives(newActives);
        } else {
          console.warn("No activeSpeakerList received or empty");
          setActives([]);
        }
      }
    );
    socket.on("updateActiveSpeakers", (data: string[]) => {
      console.log("Active speakers updated:", data);
      if (data?.length > 0) {
        const newActives = data
          .map((pid: string) => {
            const consumer = consumers.current[pid];
            if (!consumer) {
              console.warn(`No consumer found for producerId: ${pid}`);
            }
            return consumer;
          })
          .filter(
            (consumer): consumer is ActiveConsumer =>
              consumer !== undefined &&
              consumer.audioConsumer.producerId !==
                producers.current?.audioProducer?.id
          );
        console.log("Updated actives:", newActives);
        setActives(newActives);
      } else {
        console.warn("No active speakers received or empty");
        setActives([]);
      }
    });
    socket.on("clientDisconnected", (data: { producerId: string }) => {
      console.log("Client disconnected:", data);
      if (data?.producerId) {
        const consumer = consumers.current[data.producerId];
        if (consumer) {
          consumer.audioConsumer.close();
          consumer.videoConsumer.close();
          consumer.consumerTransport.close();
          delete consumers.current[data.producerId];
          console.log("Consumer removed:", data.producerId);
          console.log("Remaining consumers:", consumers.current);
        }
        setActives((prev: ActiveConsumer[]) =>
          prev.filter(
            (consumer: ActiveConsumer) =>
              consumer.audioConsumer.producerId !== data.producerId
          )
        );
        console.log("Actives after removal:", actives);
      }
    });

    return () => {
      socket.off("newProducersToConsume");
      socket.off("updateActiveSpeakers");
      socket.off("clientDisconnected");
    };
  }, []);

  const handleJoin = async () => {
    if (username && roomName && !hasJoined) {
      joinRoomResp.current = await socket.emitWithAck("joinRoom", {
        username,
        roomName,
      });
      console.log("Join Room Response:", joinRoomResp.current);
      device.current = new Device();

      if (joinRoomResp.current) {
        await device.current.load({
          routerRtpCapabilities: joinRoomResp.current.routerRtpCapabilities,
        });
        await requestTransportToConsume(
          joinRoomResp.current,
          socket,
          device.current,
          consumers
        );
        console.log("Consumers after join:", consumers.current);

        if (joinRoomResp.current.activeSpeakerList?.length) {
          console.log(
            "Initial activeSpeakerList:",
            joinRoomResp.current.activeSpeakerList
          );
          const newActives = joinRoomResp.current.activeSpeakerList
            .map((pid: string) => {
              const consumer = consumers.current[pid];
              if (!consumer) {
                console.warn(`No consumer found for producerId: ${pid}`);
              }
              return consumer;
            })
            .filter(
              (consumer): consumer is ActiveConsumer =>
                consumer !== undefined &&
                consumer.audioConsumer.producerId !==
                  producers.current?.audioProducer?.id
            );
          console.log("Initial actives:", newActives);
          setActives(newActives);
        } else {
          console.warn("No initial activeSpeakerList or empty");
          setActives([]);
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

          setLocalStream(stream);
          producerTransport.current = await createProducerTransport(
            socket,
            device.current
          );
          producers.current = await createProducer(
            stream,
            producerTransport.current
          );
          console.log("Producers created:", producers.current);
        } catch (error) {
          console.error("Error getting user media:", error);
        }
      } else {
        console.error("joinRoomResp.current is null");
      }
      console.log("Device loaded:", device);
      setHasJoined(true);
    }
  };

  useEffect(() => {
    if (localStream && videoRef.current && hasJoined) {
      videoRef.current.srcObject = localStream;
      console.log("Local stream set to videoRef");
    }
  }, [localStream, hasJoined]);

  useEffect(() => {
    actives.forEach((consumer: ActiveConsumer, index: number) => {
      const key = consumer.audioConsumer.producerId || `video-${index}`;
      const videoElement = videoRefs.current[key];
      if (videoElement && consumer.combinedStream) {
        videoElement.srcObject = consumer.combinedStream;
        console.log(
          `Video stream set for ${consumer.userName} (key: ${key}):`,
          consumer.audioConsumer.producerId
        );
      } else if (!consumer.combinedStream) {
        console.warn(
          `No combinedStream for ${consumer.userName} (key: ${key})`
        );
      } else if (!videoElement) {
        console.warn(`No video element found for key: ${key}`);
      }
    });
  }, [actives]);

  const toggleMuteAudio = async () => {
    if (producers.current) {
      const audioProducer = producers.current.audioProducer;
      if (audioProducer) {
        if (isAudioMuted) {
          socket.emit("audioChange", "unmute");
          await audioProducer.resume();
          console.log("Audio unmuted");
          setIsAudioMuted(false);
        } else {
          socket.emit("audioChange", "mute");
          await audioProducer.pause();
          console.log("Audio muted");
          setIsAudioMuted(true);
        }
      } else {
        console.warn("No audio producer found to toggle mute.");
      }
    } else {
      console.warn("No producers found to toggle mute.");
    }
  };

  return (
    <div className="relative min-h-screen p-4">
      {!hasJoined ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center max-w-md mx-auto">
          <h2 className="text-2xl font-bold mb-6">Socket.IO Video Rooms</h2>
          <p className="mb-4 text-gray-600">
            Has joined: {hasJoined ? "yes" : "no"}
          </p>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter Username"
            className="mb-4 p-3 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={hasJoined}
          />
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Enter Room Name"
            className="mb-4 p-3 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={hasJoined}
          />
          <button
            onClick={handleJoin}
            disabled={!username || !roomName || hasJoined}
            className="mb-4 py-3 px-6 bg-blue-500 text-white font-semibold rounded-lg w-full hover:bg-blue-600 disabled:bg-gray-300"
          >
            Join Room
          </button>
        </div>
      ) : (
        <>
          <div className="absolute top-4 left-0 right-0 flex justify-center space-x-4">
            {actives.slice(1).map((consumer: ActiveConsumer, index: number) => {
              const key = consumer.audioConsumer.producerId || `video-${index}`;
              return (
                <div key={key} className="w-40 h-28 flex flex-col items-center">
                  <p className="text-sm font-medium text-gray-700 mb-1">
                    {consumer.userName}
                  </p>
                  <video
                    ref={(el) => {
                      videoRefs.current[key] = el;
                      if (el && consumer.combinedStream) {
                        el.srcObject = consumer.combinedStream;
                        console.log(`Secondary video ref set for key: ${key}`);
                      }
                    }}
                    autoPlay
                    playsInline
                    className="w-full h-full bg-black rounded-lg object-cover"
                  />
                </div>
              );
            })}
          </div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            {actives.length > 0 && (
              <div className="w-full max-w-5xl h-2/3 flex flex-col items-center">
                <p className="text-lg font-semibold text-white mb-2">
                  {actives[0].userName}
                </p>
                <div className="w-full h-full">
                  <video
                    ref={(el) => {
                      const key =
                        actives[0]?.audioConsumer.producerId || "main-video";
                      videoRefs.current[key] = el;
                      if (el && actives[0].combinedStream) {
                        el.srcObject = actives[0].combinedStream;
                        console.log(`Main video ref set for key: ${key}`);
                      }
                    }}
                    autoPlay
                    playsInline
                    className="w-full h-full bg-black rounded-lg object-contain"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="absolute bottom-4 right-4 w-40 h-28 bg-black rounded-lg overflow-hidden border border-gray-300">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
          <button
            onClick={toggleMuteAudio}
            className="absolute bottom-4 left-4 py-2 px-4 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600"
          >
            {isAudioMuted ? "Unmute Audio" : "Mute Audio"}
          </button>
        </>
      )}
    </div>
  );
}
