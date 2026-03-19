import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Check if certificates exist
const certKeyPath = path.join(process.cwd(), '../server/certs/key.pem');
const certPath = path.join(process.cwd(), '../server/certs/cert.pem');
const hasCerts = fs.existsSync(certKeyPath) && fs.existsSync(certPath);

// Backend URL for the Vite proxy (server-side localhost, not the network IP)
const backendProtocol = hasCerts ? 'https' : 'http';
const BACKEND_URL = process.env.VITE_BACKEND_URL || `${backendProtocol}://localhost:5000`;

export default defineConfig({
  plugins: [react()],
  server: {
    // HTTPS is optional - only used when certificates are available
    // For local development, HTTP is used by default
    https: hasCerts ? {
      key: fs.readFileSync(certKeyPath),
      cert: fs.readFileSync(certPath)
    } : undefined,
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Forward all /api requests to the Express backend.
      // This allows the ANAF OAuth redirect_uri to use the Vite server port (5173)
      // so that after the callback, the browser is correctly redirected back to the frontend.
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
      },
    },
  }
})
