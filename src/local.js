'use strict';
/* Local development server — serves the public site plus /admin and /api. */
const config = require('./config');
const { createApp } = require('./server');

const port = Number(process.env.PORT || 4173);
const app = createApp({ serveStatic: true });

app.listen(port, () => {
  console.log(`\nSymbiosis — local server`);
  console.log(`  site     http://localhost:${port}/`);
  console.log(`  admin    http://localhost:${port}/admin`);
  console.log(`  env      ${config.env}\n`);
});
