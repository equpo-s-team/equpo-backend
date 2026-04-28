import { app } from '#a/app.js';
import { config } from '#a/config.js';

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${config.port}`);
});