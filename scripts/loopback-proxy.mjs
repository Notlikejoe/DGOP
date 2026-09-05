import { createServer, connect } from "node:net";

const port = Number(process.argv[2] ?? 4205);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("loopback-proxy requires a valid TCP port.");
  process.exit(1);
}

const server = createServer((client) => {
  const upstream = connect({ host: "127.0.0.1", port });

  client.pipe(upstream);
  upstream.pipe(client);

  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
});

server.on("error", (error) => {
  console.error(
    `IPv6 loopback bridge failed on [::1]:${port}: ${error.message}`,
  );
  process.exit(1);
});

server.listen({ host: "::1", port, ipv6Only: true }, () => {
  console.log(`IPv6 loopback bridge -> http://localhost:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
