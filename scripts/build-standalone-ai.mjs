#!/usr/bin/env node
// Build a genuinely separate Chrome extension, copying only the shared ESM
// dependencies the autonomous chat actually imports. No Workbench runtime.
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFlag = process.argv.indexOf('--out');
if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out requires a directory');
const out = resolve(outFlag >= 0 ? process.argv[outFlag + 1] : join(root, 'dist/ai-operator-standalone'));
const seedFiles = [
  'standalone-ai/manifest.json',
  'standalone-ai/background.js',
  'standalone-ai/chat.html',
  'standalone-ai/chat.css',
  'standalone-ai/chat.js'
];
const copied = new Set();
const visiting = new Set();

function safePath(file) {
  const absolute = resolve(root, file);
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) {
    throw new Error('Refusing import outside repository: ' + file);
  }
  return { absolute, rel };
}

function moduleImports(source) {
  // Handles side-effect imports, multiline 'from' imports/exports and import().
  const staticRe = /(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([.]{1,2}\/[^'"]+\.(?:m?js|json))['"]/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([.]{1,2}\/[^'"]+\.(?:m?js|json))['"]\s*\)/g;
  return [
    ...Array.from(source.matchAll(staticRe), match => match[1]),
    ...Array.from(source.matchAll(dynamicRe), match => match[1])
  ];
}

async function include(file) {
  const { absolute, rel } = safePath(file);
  if (copied.has(rel)) return;
  if (visiting.has(rel)) return;
  visiting.add(rel);
  const source = await readFile(absolute);
  if (/\.(?:m?js)$/.test(rel)) {
    for (const dependency of moduleImports(source.toString('utf8'))) {
      await include(resolve(dirname(absolute), dependency));
    }
  }
  const target = join(out, rel);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(absolute, target);
  if (/\.(?:m?js)$/.test(rel)) execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
  visiting.delete(rel);
  copied.add(rel);
}

await rm(out, { recursive: true, force: true });
for (const file of seedFiles) await include(file);
const manifest = JSON.parse(await readFile(join(out, 'standalone-ai/manifest.json'), 'utf8'));
if (manifest.background?.service_worker !== 'standalone-ai/background.js') throw new Error('Unexpected background entrypoint');
if (manifest.content_scripts?.length) throw new Error('Standalone build must not inject Workbench content scripts');
await copyFile(join(out, 'standalone-ai/manifest.json'), join(out, 'manifest.json'));
await stat(join(out, 'src/features/ai-operator/lab-background.js'));
await stat(join(out, 'src/features/ai-operator/live-tool-runtime.js'));
await stat(join(out, 'src/features/ai-operator/semantic-probe.js'));
console.log('SIMNET AI standalone ready: ' + out);
console.log('Copied source files: ' + copied.size);
console.log('Chrome: chrome://extensions > Load unpacked > ' + out);
