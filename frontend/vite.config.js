import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Check if certificates exist
const certKeyPath = path.join(process.cwd(), '../server/certs/key.pem');
const certPath = path.join(process.cwd(), '../server/certs/cert.pem');
const hasCerts = fs.existsSync(certKeyPath) && fs.existsSync(certPath);

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
    port: 5173
  }
})
