import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await Promise.all([
  cp('public/manifest.json', 'dist/manifest.json'),
  cp('public/highlights.css', 'dist/highlights.css'),
  cp('public/sidebar.css', 'dist/sidebar.css'),
  cp('sidebar.html', 'dist/sidebar.html'),
]);
await build({
  entryPoints: ['src/content.js', 'src/background.js', 'src/sidebar.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'firefox140',
  minify: true,
});
