import os from "os"; //operating system module. part of node
import mediasoup from "mediasoup"; //import mediasoup library
const totalThreads = os.cpus().length; //maximum number of allowed workers
// console.log(totalThreads)
import config from "./config.js"; //import our config file

const createWorkers = () =>
  new Promise(async (resolve) => {
    let workers = [];
    //loop to create each worker
    for (let i = 0; i < totalThreads; i++) {
      const worker = await mediasoup.createWorker({
        //rtcMinPort and max are just arbitray ports for our traffic
        //useful for firewall or networking rules
        rtcMinPort: config.workerSettings.rtcMinPort,
        rtcMaxPort: config.workerSettings.rtcMaxPort,
        logLevel: config.workerSettings.logLevel,
        logTags: config.workerSettings.logTags,
      });
      worker.on("died", () => {
        //this should never happen, but if it does, do x...
        console.log("Worker has died");
        process.exit(1); //kill the node program
      });
      workers.push(worker);
    }

    resolve(workers);
  });

export default createWorkers;
