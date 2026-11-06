import { spawn } from 'child_process';
import http from 'http';
import path from 'path';

console.log('⚡ Starting SentinelFS Development Suite...');

// 1. Spawn Vite dev server
const vite = spawn('npx.cmd', ['vite'], {
  stdio: 'inherit',
  shell: true
});

function checkViteReady() {
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get('http://localhost:5173', (res) => {
        if (res.statusCode === 200 || res.statusCode === 304) {
          resolve(true);
        } else {
          setTimeout(check, 300);
        }
      });
      req.on('error', () => {
        setTimeout(check, 300);
      });
    };
    check();
  });
}

// 2. Wait for Vite server, then launch Electron
await checkViteReady();
console.log('✅ Vite Dev Server Ready on http://localhost:5173');
console.log('🚀 Launching Electron Desktop Window...');

const electron = spawn('npx.cmd', ['electron', '.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' }
});

electron.on('close', (code) => {
  console.log(`Electron closed with code ${code}. Stopping Vite...`);
  vite.kill();
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  electron.kill();
  vite.kill();
  process.exit(0);
});
