import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const libRoot = path.resolve('node_modules/simli-client/lib');

function patchFile(file) {
  let text = fs.readFileSync(file, 'utf8');
  const original = text;
  text = text
    .replaceAll('./Events', './events')
    .replaceAll('../Events', '../events')
    .replaceAll('./Transports/', './transports/')
    .replaceAll('../Transports/', '../transports/')
    .replaceAll('./Signaling/', './signaling/')
    .replaceAll('../Signaling/', '../signaling/')
    .replaceAll('./Client', './client')
    .replaceAll('../Client', '../client');
  if (text !== original) fs.writeFileSync(file, text);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|js)$/.test(entry.name)) patchFile(full);
  }
}

if (!fs.existsSync(libRoot)) {
  throw new Error('simli-client source files were not installed.');
}

walk(libRoot);

await build({
  entryPoints: ['app-src.js'],
  bundle: true,
  outfile: 'app.bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});

console.log('Camille browser bundle built with local Simli client.');
