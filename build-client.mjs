import { build } from 'esbuild';
import { writeEclArtwork } from './ecl-artwork.mjs';

// Always install valid offline ECL assets first. The running server may replace
// placeholder panels with the actual published Anam avatar preview photos.
await writeEclArtwork();

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

console.log('ECL three-avatar install icons and browser bundle built.');
