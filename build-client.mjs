import { build } from 'esbuild';

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

console.log('Camille browser bundle built with the Anam JavaScript SDK.');
