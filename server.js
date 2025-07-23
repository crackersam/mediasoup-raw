import { createServer } from "node:https";
import next from "next";
import { Server } from "socket.io";
import fs from "node:fs";
import path from "node:path";

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

  io.on("connection", (socket) => {
    // ...
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
