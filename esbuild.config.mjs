import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// 构建产物默认落在 ./dist。想让构建直接写进某个 vault，用 CANVAS_VAULT 指到 vault 根目录：
//   CANVAS_VAULT=/path/to/vault npm run build
const vault = process.env.CANVAS_VAULT;
const outdir = vault
  ? path.join(vault, '.obsidian', 'plugins', 'canvas-quick-add')
  : 'dist';
const prod = process.argv[2] === 'production';

const options = {
  bundle: true,
  entryPoints: ['src/main.ts'],
  outfile: path.join(outdir, 'main.js'),
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  minify: prod,
};

function copySupportFiles() {
  fs.mkdirSync(outdir, { recursive: true });
  for (const file of ['manifest.json', 'versions.json', 'styles.css']) {
    fs.copyFileSync(file, path.join(outdir, file));
  }
}

copySupportFiles();

if (prod) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`watching → ${outdir}`);
}
