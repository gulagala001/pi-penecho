// spike:验证「app 内嵌 Node 可执行」的最小 HTTP 服务
import http from "node:http";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("hello from embedded node " + process.version + " (" + process.arch + ")");
});
server.listen(8787, "127.0.0.1", () => console.log("SPIKE_LISTENING 8787"));
