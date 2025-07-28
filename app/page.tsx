"use client";
import { useEffect, useState, useRef } from "react";
import { socket } from "../socket";
import { Device, types } from "mediasoup-client";
import createProducerTransport from "@/lib/create-producer-transport";
import createProducer from "@/lib/create-producer";
import requestTransportToConsume from "@/lib/request-transport-to-consume";

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
    activeSpeakerList: string[]; // Assuming activeSpeakerList is an array of strings (e.g., user IDs)
    routerRtpCapabilities: types.RtpCapabilities;
  } | null>(null);
  const [actives, setActives] = useState<
    {
      combinedStream: MediaStream;
      userName: string;
      consumerTransport: types.Transport;
      audioConsumer: types.Consumer;
      videoConsumer: types.Consumer;
    }[]
  >([]);
  const consumers = useRef<
    Record<
      string,
      {
        combinedStream: MediaStream;
        userName: string;
        consumerTransport: types.Transport;
        audioConsumer: types.Consumer;
        videoConsumer: types.Consumer;
      }
    >
  >({});

  useEffect(() => {
    socket.connect();
    socket.on("newProducersToConsume", async (data) => {
      console.log("New producers to consume:", data);
      if (data && data.audioPidsToCreate.length > 0) {
        await requestTransportToConsume(
          data,
          socket,
          device.current,
          consumers
        );
      }
      if (data && data.activeSpeakerList) {
        if (
          data.activeSpeakerList.filter(
            (pid: string) => pid !== producers.current?.audioProducer?.id
          ).length > 0
        ) {
          setActives(
            data.activeSpeakerList
              .map((pid: string) => consumers.current[pid])
              .filter(
                (consumer: {
                  audioConsumer: { producerId: string | undefined };
                }) =>
                  consumer &&
                  producers.current?.audioProducer?.id !==
                    consumer.audioConsumer?.producerId
              )
          );
        }
      }
    });
    socket.on("updateActiveSpeakers", (data) => {
      console.log("Active speakers updated:", data);
      console.log(data?.length);
      if (data && data.length > 0) {
        setActives(
          data
            .map((pid: string) => consumers.current[pid])
            .filter(
              (consumer: {
                audioConsumer: { producerId: string | undefined };
              }) =>
                consumer &&
                producers.current?.audioProducer?.id !==
                  consumer.audioConsumer?.producerId
            )
        );
      }
    });
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

        console.log("activeSpeakerList:", joinRoomResp.current);
        if (joinRoomResp.current.activeSpeakerList) {
          setActives(
            joinRoomResp.current.activeSpeakerList
              .map((pid: string) => consumers.current[pid])
              .filter(
                (consumer) =>
                  consumer &&
                  producers.current?.audioProducer?.id !==
                    consumer.audioConsumer?.producerId
              )
          );
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
    }
  }, [localStream, hasJoined]);

  const toggleMuteAudio = async () => {
    console.log(producers.current);
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
            {actives.slice(1).map((consumer, index) => (
              <div key={index} className="w-40 h-28 flex flex-col items-center">
                <p className="text-sm font-medium text-gray-700 mb-1">
                  {consumer?.userName}
                </p>
                <video
                  ref={(video) => {
                    if (video) {
                      video.srcObject = consumer?.combinedStream;
                    }
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full bg-black rounded-lg object-cover"
                />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            {actives.length > 0 && (
              <div className="w-full max-w-5xl h-2/3 flex flex-col items-center">
                <p className="text-lg font-semibold text-white mb-2">
                  {actives[0]?.userName}
                </p>
                <video
                  ref={(video) => {
                    if (video) {
                      video.srcObject = actives[0]?.combinedStream;
                    }
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full bg-black rounded-lg object-contain"
                />
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
