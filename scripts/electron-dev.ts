/**
 * Development mode launcher for the Electron app.
 *
 * 1. Rebuilds the main process and preload
 * 2. Starts the Vite dev server (renderer with HMR)
 * 3. Detects the actual Vite URL from its stdout
 * 4. Launches Electron with VITE_DEV_SERVER_URL set
 *
 * Usage:
 *   bun run electron:dev              # default
 *   bun run electron:dev:terminal     # same (--terminal flag is a no-op stub)
 */
import { build } from 'esbuild';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');

// ── 1. Build main process ────────────────────────────────────────────────────
console.log('[dev] Building main process...');
await build({
  entryPoints: [resolve(electronDir, 'src/main/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: resolve(electronDir, 'dist/main.cjs'),
  external: ['electron', 'node-pty', 'electron-log', 'electron-updater', '@aws-sdk/client-s3'],
  sourcemap: true,
  target: 'node22',
  absWorkingDir: electronDir,
});
console.log('[dev] ✓ Main process built');

// ── 2. Build preload ─────────────────────────────────────────────────────────
console.log('[dev] Building preload...');
await build({
  entryPoints: [resolve(electronDir, 'src/preload/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: resolve(electronDir, 'dist/preload.cjs'),
  external: ['electron'],
  sourcemap: true,
  target: 'node22',
  absWorkingDir: electronDir,
});
console.log('[dev] ✓ Preload built');

// ── 3. Start Vite dev server & detect URL ────────────────────────────────────
console.log('[dev] Starting Vite dev server...');

let viteDevUrl: string | null = null;

const vite = spawn('bun', ['run', 'dev'], {
  cwd: electronDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});

// Parse Vite's "Local: http://localhost:XXXX/" line to get actual URL.
// Bun/Vite may write the banner to stdout or stderr depending on the environment,
// so we check both streams.
const viteReady = new Promise<string>((res, rej) => {
  let viteOutput = '';
  const checkForUrl = (text: string) => {
    // Strip ANSI escape codes before matching (Vite may bold/colour "Local")
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    viteOutput += plain;
    const match = viteOutput.match(/Local:\s+(http:\/\/localhost:\d+\/)/);
    if (match) {
      res(match[1]);
    }
  };
  vite.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    process.stdout.write(text);
    checkForUrl(text);
  });
  vite.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    process.stderr.write(text);
    checkForUrl(text);
  });
  vite.on('close', (code) => {
    rej(new Error(`Vite exited with code ${code} before becoming ready`));
  });
});

viteDevUrl = await viteReady;
console.log(`[dev] ✓ Vite ready at ${viteDevUrl}`);

// ── 4. Launch Electron ───────────────────────────────────────────────────────
console.log('[dev] Launching Electron...');
const electronBin: string = _require('electron');
const electron = spawn(electronBin, [electronDir], {
  cwd: electronDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: viteDevUrl,
    NODE_ENV: 'development',
  },
});

electron.on('close', (code) => {
  console.log(`[dev] Electron exited with code ${code}`);
  vite.kill();
  process.exit(code ?? 0);
});

vite.on('close', (code) => {
  if (code !== null && code !== 0) {
    console.error(`[dev] Vite exited unexpectedly with code ${code}`);
    electron.kill();
    process.exit(code);
  }
});

// Forward signals to child processes
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    vite.kill();
    electron.kill();
    process.exit(0);
  });
}
