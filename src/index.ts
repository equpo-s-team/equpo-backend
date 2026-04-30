import { createServer } from 'http';
import { app } from '#a/app.js';
import { config } from '#a/config.js';
import { initializeRealtimeServer } from '#a/domains/room/realtimeServer.js';

const server = createServer(app);

initializeRealtimeServer(server);

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${config.port}`);
});
