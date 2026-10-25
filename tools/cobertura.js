#!/usr/bin/env node
/* tools/cobertura.js — mide qué parte de www/js ejecutan las pruebas y lista lo que NO se probó.
 *
 *   node tools/cobertura.js                  pruebas unitarias (Node)
 *   node tools/cobertura.js --detalle        además lista cada bloque sin probar
 *   node tools/cobertura.js --navegador=a.json,b.json   suma la cobertura medida en Chromium (tools/e2e.js la genera)
 *
 * Usa la cobertura de V8 (la misma que usan c8 y Node). Una línea cuenta como probada si alguna de sus
 * instrucciones se ejecutó; las líneas en blanco, los comentarios y las llaves sueltas no cuentan. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'www', 'js') + path.sep;
const args = process.argv.slice(2);
const detalle = args.includes('--detalle');
const nav = (args.find((a) => a.startsWith('--navegador=')) || '').slice(12).split(',').filter(Boolean);
const soloNav = args.includes('--solo-navegador');

const hits = {};                                 // archivo -> Uint8Array (1 = alguna ejecución lo cubrió)
function sourceOf(file) { return fs.readFileSync(file, 'utf8'); }
function addEntry(file, functions) {
  const src = sourceOf(file);
  if (!hits[file]) hits[file] = new Uint8Array(src.length);
  const counts = new Int32Array(src.length).fill(-1);
  const ranges = [];
  functions.forEach((f) => f.ranges.forEach((r) => ranges.push(r)));
  ranges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));   // primero los grandes; los anidados los reemplazan
  ranges.forEach((r) => counts.fill(r.count, r.startOffset, Math.min(r.endOffset, src.length)));
  for (let i = 0; i < src.length; i++) if (counts[i] > 0) hits[file][i] = 1;
}

if (!soloNav) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
  const r = cp.spawnSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: ROOT, env: Object.assign({}, process.env, { NODE_V8_COVERAGE: dir }), encoding: 'utf8' });
  const m = /# fail (\d+)/.exec(r.stdout || '');
  if (!m || m[1] !== '0') { console.error('Las pruebas fallan; arréglalas antes de medir la cobertura.\n' + (r.stdout || '').split('\n').filter((l) => /^not ok|error:/.test(l)).join('\n')); process.exit(1); }
  console.log('Pruebas unitarias: ' + /# pass (\d+)/.exec(r.stdout)[1] + ' pasan, ' + m[1] + ' fallan.');
  fs.readdirSync(dir).forEach((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    (j.result || []).forEach((e) => {
      if (!e.url.startsWith('file://')) return;
      const file = decodeURIComponent(new URL(e.url).pathname);
      if (file.startsWith(JS) && file.endsWith('.js')) addEntry(file, e.functions);
    });
  });
  fs.rmSync(dir, { recursive: true, force: true });
}
nav.forEach((f) => {
  JSON.parse(fs.readFileSync(f, 'utf8')).forEach((e) => {
    const m = /\/js\/([\w.-]+\.js)(\?.*)?$/.exec(e.url);
    if (m && fs.existsSync(JS + m[1])) addEntry(JS + m[1], e.functions);
  });
});

function isCodeLine(t) {
  t = t.trim();
  if (!t) return false;
  if (/^(\/\/|\/\*|\*)/.test(t)) return false;
  if (/^[}\])\s;,]*$/.test(t)) return false;                       // solo cierres: }, }); })();
  return true;
}
let totT = 0, totC = 0;
const rows = [];
fs.readdirSync(JS).filter((f) => f.endsWith('.js')).sort().forEach((name) => {
  const file = JS + name, src = sourceOf(file), h = hits[file];
  const lines = src.split('\n');
  let off = 0, total = 0, cov = 0;
  const miss = [];                                                 // [{linea, texto}]
  lines.forEach((ln, i) => {
    const start = off; off += ln.length + 1;
    if (!isCodeLine(ln)) return;
    total++;
    let any = false;
    if (h) for (let k = 0; k < ln.length; k++) if (ln[k] !== ' ' && ln[k] !== '\t' && h[start + k]) { any = true; break; }
    if (any) cov++; else miss.push([i + 1, ln.trim()]);
  });
  totT += total; totC += cov;
  rows.push({ name, total, cov, pct: total ? cov / total * 100 : 100, miss, src, h });
});
console.log('\nArchivo               líneas  probadas      %');
rows.forEach((r) => console.log(r.name.padEnd(20) + String(r.total).padStart(7) + String(r.cov).padStart(10) + r.pct.toFixed(1).padStart(8) + (r.pct < 90 ? '   ← bajo 90 %' : '')));
console.log('TOTAL'.padEnd(20) + String(totT).padStart(7) + String(totC).padStart(10) + (totC / totT * 100).toFixed(1).padStart(8));
if (detalle) {
  rows.forEach((r) => {
    if (!r.miss.length && !r.h) return;
    console.log('\n— ' + r.name + ': líneas sin probar');
    r.miss.forEach((m) => console.log('  ' + String(m[0]).padStart(4) + '  ' + m[1].slice(0, 110)));
    // Bloques parciales: instrucciones sin ejecutar dentro de líneas que sí se ejecutaron
    if (r.h) {
      const out = []; let s = -1;
      for (let i = 0; i <= r.src.length; i++) {
        const bad = i < r.src.length && !r.h[i] && !/\s/.test(r.src[i]);
        if (bad && s < 0) s = i;
        if (!bad && s >= 0) {
          const text = r.src.slice(s, i), line = r.src.slice(0, s).split('\n').length;
          if (text.length > 3 && !r.miss.some((m) => m[0] === line)) out.push('  ' + String(line).padStart(4) + '  ' + text.replace(/\s+/g, ' ').slice(0, 100));
          s = -1;
        }
      }
      if (out.length) { console.log('— ' + r.name + ': ramas sin probar dentro de líneas probadas'); out.forEach((o) => console.log(o)); }
    }
  });
}
