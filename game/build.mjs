// Build : bundle unique (IIFE) dans dist/, + fichiers statiques. Utilisé par le web et par l'APK Android.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
cpSync('mods/examples', 'dist/mods', { recursive: true });
const opts = {
  entryPoints: ['src/main.js'], bundle: true, format: 'iife', outfile: 'dist/game.js',
  minify: !watch && !dev, sourcemap: watch || dev ? 'inline' : false, target: ['chrome90'], loader: { '.css': 'text', '.json': 'json' },
  legalComments: 'none', logLevel: 'info',
};
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); console.log('watch…'); }
else await esbuild.build(opts);
