import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, 'dist');

// Disable x-powered-by header
app.disable('x-powered-by');

// Health check endpoint for Cloud Run startup / liveness probes
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'cloudsentinel-frontend' });
});

// Serve static assets from dist/
app.use(express.static(DIST_DIR, {
  maxAge: '1h',
  etag: true,
}));

// SPA Fallback: Serve index.html for all unrecognized GET requests
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`CloudSentinel frontend production server running on http://${HOST}:${PORT}`);
  console.log(`Serving static files from: ${DIST_DIR}`);
});
