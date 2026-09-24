'use strict';

const Application = require('./src/server/Application');

new Application({ port: Number(process.env.PORT) || 3000 })
  .init()
  .then((app) => app.listen())
  .catch((err) => {
    console.error('Failed to start Modelizer Studio:', err);
    process.exit(1);
  });
