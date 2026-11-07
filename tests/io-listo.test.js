/* Aviso «onReady» de IO.saveText y IO.saveBytes (2.7.1): se llama una sola vez, cuando el archivo ya está listo y justo antes de abrir el menú
 * de compartir o de descargarlo. La app lo usa para quitar la ventana «Elaborando el reporte…» antes de que salga el menú del sistema. */
const test = require('node:test');
const assert = require('node:assert/strict');
const IO = require('../www/js/io.js');

test.afterEach(() => IO.setEnv(null));

const CHUNK = 1572864;

// App de Android falsa: anota el orden de lo que pasa
function nativeEnv(log, opts) {
  opts = opts || {};
  return { Capacitor: { isNativePlatform: () => true, Plugins: {
    Filesystem: {
      writeFile: async (a) => { log.push('write'); if (opts.failWrite) throw new Error('disco lleno'); return { uri: 'file:///cache/' + a.path }; },
      appendFile: async () => { log.push('append'); }
    },
    Share: { share: async () => { log.push('share'); if (opts.cancel) throw new Error('Share canceled'); } }
  } } };
}
function fakeDoc(log) {
  const doc = { createElement: () => ({ click: () => log.push('descarga'), remove: () => {} }), body: { appendChild: () => {} } };
  const url = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
  return { doc, url };
}

test('saveText en la app: onReady se llama una vez, después de escribir el archivo y antes de abrir Compartir', async () => {
  const log = [];
  IO.setEnv(nativeEnv(log));
  const r = await IO.saveText('a.html', 'text/html', '<p/>', { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['write', 'listo', 'share']);
  assert.deepEqual(r, { how: 'share', name: 'a.html' });
});

test('saveBytes en la app: onReady se llama una vez, cuando ya se escribieron todos los trozos y antes de abrir Compartir', async () => {
  const log = [];
  IO.setEnv(nativeEnv(log));
  await IO.saveBytes('g.pdf', 'application/pdf', new Uint8Array(CHUNK * 2 + 5), { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['write', 'append', 'append', 'listo', 'share']);
  log.length = 0;
  await IO.saveBytes('p.pdf', 'application/pdf', new Uint8Array(10), { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['write', 'listo', 'share']);
});

test('si no se puede escribir el archivo, onReady no se llama (nunca llegó a compartirse) y el error sale igual', async () => {
  let n = 0;
  IO.setEnv(nativeEnv([], { failWrite: true }));
  await assert.rejects(IO.saveText('a.txt', 'text/plain', 'x', { onReady: () => n++ }), /disco lleno/);
  await assert.rejects(IO.saveBytes('a.pdf', 'application/pdf', new Uint8Array(3), { onReady: () => n++ }), /disco lleno/);
  assert.equal(n, 0);
});

test('si la persona cancela el menú Compartir, onReady ya se había llamado y todo sigue siendo una cancelación', async () => {
  const log = [];
  IO.setEnv(nativeEnv(log, { cancel: true }));
  assert.deepEqual(await IO.saveBytes('a.pdf', 'application/pdf', new Uint8Array(3), { onReady: () => log.push('listo') }), { how: 'cancel', name: 'a.pdf' });
  assert.deepEqual(log, ['write', 'listo', 'share']);
});

test('en el navegador: onReady se llama justo antes de descargar, una sola vez (texto y bytes)', async () => {
  const log = [];
  const { doc, url } = fakeDoc(log);
  IO.setEnv({ document: doc, URL: url, navigator: {} });
  const rt = await IO.saveText('a.html', 'text/html', '<p/>', { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['listo', 'descarga']);
  assert.equal(rt.how, 'download');
  log.length = 0;
  const rb = await IO.saveBytes('a.pdf', 'application/pdf', new Uint8Array(4), { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['listo', 'descarga']);
  assert.equal(rb.how, 'download');
});

test('en el navegador con menú de compartir: onReady antes de compartir y, si compartir falla y cae a la descarga, no se repite', async () => {
  const log = [];
  const { doc, url } = fakeDoc(log);
  IO.setEnv({ document: doc, URL: url, navigator: { canShare: () => true, share: async () => { log.push('share'); throw new Error('falló'); } } });
  const r = await IO.saveText('a.html', 'text/html', '<p/>', { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['listo', 'share', 'descarga']);
  assert.equal(r.how, 'download');
  log.length = 0;
  const r2 = await IO.saveBytes('a.pdf', 'application/pdf', new Uint8Array(4), { onReady: () => log.push('listo') });
  assert.deepEqual(log, ['listo', 'share', 'descarga']);
  assert.equal(r2.how, 'download');
});

test('un onReady que falla o que no es una función no impide guardar', async () => {
  const log = [];
  IO.setEnv(nativeEnv(log));
  const r = await IO.saveText('a.txt', 'text/plain', 'x', { onReady: () => { throw new Error('se rompió el aviso'); } });
  assert.deepEqual(r, { how: 'share', name: 'a.txt' });
  assert.deepEqual(log, ['write', 'share']);
  const r2 = await IO.saveBytes('a.pdf', 'application/pdf', new Uint8Array(2), { onReady: 'no soy una función' });
  assert.deepEqual(r2, { how: 'share', name: 'a.pdf' });
  const r3 = await IO.saveBytes('b.pdf', 'application/pdf', new Uint8Array(2));
  assert.equal(r3.how, 'share');
});
