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
        setActives(
          data.activeSpeakerList
            .map((pid: string) => consumers.current[pid])
            .filter(Boolean)
        );
      }
    });
    socket.on("updateActiveSpeakers", (data) => {
      console.log("Active speakers updated:", data);
      if (data && data.activeSpeakerList) {
        setActives(
          data.activeSpeakerList
            .map((pid: string) => consumers.current[pid])
            .filter(Boolean)
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
              .filter(Boolean)
          );
        }
      } else {
        console.error("joinRoomResp.current is null");
      }
      console.log("Device loaded:", device);
      setHasJoined(true);
    }
  };

  const handleGetLocalFeed = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        producerTransport.current = await createProducerTransport(
          socket,
          device.current
        );
        producers.current = await createProducer(
          stream,
          producerTransport.current
        );
      }
    } catch (error) {
      console.error("Error getting user media:", error);
    }
  };
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px",
        maxWidth: "400px",
        margin: "0 auto",
      }}
    >
      <h2 style={{ marginBottom: "20px" }}>Socket.IO Chat Room</h2>

      <p>Has joined: {hasJoined ? "yes" : "no"}</p>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Enter Username"
        style={{
          margin: "10px 0",
          padding: "10px",
          width: "100%",
          boxSizing: "border-box",
        }}
        disabled={hasJoined}
      />
      <input
        type="text"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
        placeholder="Enter Room Name"
        style={{
          margin: "10px 0",
          padding: "10px",
          width: "100%",
          boxSizing: "border-box",
        }}
        disabled={hasJoined}
      />
      <button
        onClick={handleJoin}
        disabled={!username || !roomName || hasJoined}
        style={{
          padding: "10px 20px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
          marginTop: "10px",
          width: "100%",
        }}
      >
        Join Room
      </button>
      <button
        onClick={handleGetLocalFeed}
        style={{
          padding: "10px 20px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
          marginTop: "10px",
          width: "100%",
        }}
      >
        Get Local Feed
      </button>
      <button
        onClick={toggleMuteAudio}
        style={{
          padding: "10px 20px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
          marginTop: "10px",
          width: "100%",
        }}
      >
        {isAudioMuted ? "Unmute Audio" : "Mute Audio"}
      </button>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "100%", marginTop: "20px" }}
      />
      {actives.map((consumer, index) => (
        <div key={index} style={{ width: "100%", marginTop: "20px" }}>
          <p>{consumer.userName}</p>
          <video
            ref={(video) => {
              if (video) {
                video.srcObject = consumer.combinedStream;
              }
            }}
            autoPlay
            playsInline
            style={{ width: "100%" }}
          />
        </div>
      ))}
    </div>
  );
}
