import createConsumer from "./create-consumer";
import createConsumerTransport from "./create-consumer-transport";

const requestTransportToConsume = async (
  consumeData,
  socket,
  device,
  consumersRef
) => {
  for (let i = 0; i < consumeData.audioPidsToCreate.length; i++) {
    const audioPid = consumeData.audioPidsToCreate[i];
    if (consumersRef.current[audioPid]) {
      continue;
    }
    const videoPid = consumeData.videoPidsToCreate[i];
    const consumerTransportParams = await socket.emitWithAck(
      "requestTransport",
      { type: "consumer", audioPid }
    );
    console.log(consumerTransportParams);
    const consumerTransport = createConsumerTransport(
      consumerTransportParams,
      device,
      socket,
      audioPid
    );
    const [audioConsumer, videoConsumer] = await Promise.all([
      createConsumer(consumerTransport, audioPid, device, socket, "audio", i),
      createConsumer(consumerTransport, videoPid, device, socket, "video", i),
    ]);
    console.log(audioConsumer);
    console.log(videoConsumer);
    const combinedStream = new MediaStream([
      audioConsumer?.track,
      videoConsumer?.track,
    ]);
    consumersRef.current[audioPid] = {
      combinedStream,
      userName: consumeData.associatedUserNames[i],
      consumerTransport,
      audioConsumer,
      videoConsumer,
    };
  }
};

export default requestTransportToConsume;
