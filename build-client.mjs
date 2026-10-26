import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Generate photo assets from the checked-in Emma portrait source before
// Express serves static files. This avoids binary-asset encoding issues and
// preserves portrait quality across iOS/Android PWA icons.
const source = (await readFile('emma-portrait.b64', 'utf8')).trim();
const portrait = Buffer.from(source, 'base64');
if (portrait.length < 1500 || portrait[0] !== 0xff || portrait[1] !== 0xd8) {
  throw new Error('Invalid Emma portrait source; refusing to overwrite icons.');
}

const meta = await sharp(portrait).metadata();
if (meta.width !== 224 || meta.height !== 336) {
  throw new Error('Unexpected Emma portrait size.');
}

await writeFile('emma-portrait.jpg', portrait);
await Promise.all([
  sharp(portrait).resize(192, 192, { fit: 'cover', position: 'north' }).png().toFile('icon-192.png'),
  sharp(portrait).resize(512, 512, { fit: 'cover', position: 'north' }).png().toFile('icon-512.png'),
  sharp(portrait).resize(180, 180, { fit: 'cover', position: 'north' }).png().toFile('apple-touch-icon.png'),
  sharp(portrait).resize(64, 64, { fit: 'cover', position: 'north' }).png().toFile('favicon-64.png')
]);

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

console.log('Emma assets and browser bundle built successfully.');
