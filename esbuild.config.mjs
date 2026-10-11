import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// 产物始终落在 ./dist，发版只认这一份。
// 设了 CANVAS_VAULT 再额外复制一份进那个库，避免"直接构建进库"导致 dist 静默变旧。
const vault = process.env.CANVAS_VAULT;
const outdir = 'dist';
const vaultDir = vault ? path.join(vault, '.obsidian', 'plugins', 'canvas-quick-add') : null;
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

const ROOT_ASSETS = ['manifest.json', 'versions.json', 'styles.css'];

/** 把根目录的配置和构建出的 main.js 组装成一份完整的 dist */
function stage() {
  fs.mkdirSync(outdir, { recursive: true });
  for (const file of ROOT_ASSETS) fs.copyFileSync(file, path.join(outdir, file));
}

/** dist 整体复制进某个库 */
function deployTo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of [...ROOT_ASSETS, 'main.js']) {
    fs.copyFileSync(path.join(outdir, file), path.join(dir, file));
  }
}

function publish() {
  stage();
  if (vaultDir) deployTo(vaultDir);
}

if (prod) {
  await esbuild.build(options);
  publish();
} else {
  const ctx = await esbuild.context(options);
  ctx.onBuild({
    result() {
      try {
        publish();
      } catch (error) {
        console.error('copy failed', error);
      }
    },
  });
  await ctx.watch();
  publish();
  console.log(`watching → ${outdir}${vaultDir ? ` + ${vaultDir}` : ''}`);
}
