import { defineConfig } from 'vite';
import { apiMiddleware } from './server/api.js';

// Mounts the live-profile API on Vite's dev and preview servers, so `npm run dev`
// runs the whole app from one command.
export default defineConfig({
  plugins: [{
    name: 'hyderabad-connects-api',
    configureServer(server) { server.middlewares.use(apiMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(apiMiddleware); },
  }],
  server: { watch: { ignored: ['**/data/**'] } },
});
