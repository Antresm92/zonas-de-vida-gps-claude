/* Ramas de io.js que las otras pruebas no distinguían (salieron de una prueba de fallos provocados en la 2.7.1):
 * qué pasa cuando falta un complemento o el menú de compartir, cómo se reconoce una cancelación y qué tipo de archivo se declara. */
const test = require('node:test');
const assert = require('node:assert/strict');
const IO = require('../www/js/io.js');

test.afterEach(() => IO.setEnv(null));

const CHUNK = 1572864;

function browser(extra) {
  const log = { blobs: [], clicks: 0, shared: null };
  const doc = { createElement: () => ({ click: () => { log.clicks++; }, remove: () => {} }), body: { appendChild: () => {} } };
  const url = { createObjectURL: (b) => { log.blobs.push(b); return 'blob:fake'; }, revokeObjectURL: () => {} };
  return { log, env: Object.assign({ document: doc, URL: url }, extra) };
}

test('capPlugin: un Capacitor sin isNativePlatform no cuenta como app', () => {
  IO.setEnv({ Capacitor: {} });
  assert.equal(IO.capPlugin('Filesystem'), null);
});

test('en la app con solo uno de los dos complementos (Filesystem sin Share, o al revés), se descarga como en el navegador', async () => {
  for (const plugins of [{ Filesystem: { writeFile: async () => ({ uri: 'x' }) } }, { Share: { share: async () => {} } }]) {
    const { log, env } = browser({ Capacitor: { isNativePlatform: () => true, Plugins: plugins }, navigator: {} });
    IO.setEnv(env);
    assert.equal((await IO.saveText('a.txt', 'text/plain', 'x')).how, 'download');
    assert.equal((await IO.saveBytes('a.bin', 'application/octet-stream', new Uint8Array(2))).how, 'download');
    assert.equal(log.clicks, 2);
  }
});

test('el menú de compartir del navegador solo se usa si canShare dice que admite archivos; sin navigator o sin canShare se descarga', async () => {
  let intentos = 0;                                                         // si se llamara a share, el fallo se taparía con la descarga: por eso se cuentan las llamadas
  for (const navigator of [undefined, {}, { share: async () => { intentos++; } }, { canShare: () => false, share: async () => { intentos++; } }]) {
    const { log, env } = browser({ navigator });
    IO.setEnv(env);
    assert.equal((await IO.saveText('a.txt', 'text/plain', 'x')).how, 'download');
    assert.equal((await IO.saveBytes('a.bin', 'application/octet-stream', new Uint8Array(2))).how, 'download');
    assert.equal(log.clicks, 2);
  }
  assert.equal(intentos, 0, 'no se llamó a share');
});

test('el menú de compartir recibe título, texto y el archivo con el tipo pedido (o el de reserva)', async () => {
  const dados = [];
  const { env } = browser({ navigator: { canShare: () => true, share: async (d) => { dados.push(d); } } });
  IO.setEnv(env);
  await IO.saveText('a.csv', 'text/csv', 'x', { title: 'Mi título', text: 'Mi texto' });
  await IO.saveText('b.txt', undefined, 'x');
  await IO.saveBytes('c.pdf', 'application/pdf', new Uint8Array(2), { title: 'Otro título', text: 'Otro texto' });
  await IO.saveBytes('d.bin', undefined, new Uint8Array(2));
  assert.deepEqual(dados.map((d) => [d.title, d.text, d.files[0].name, d.files[0].type]), [
    ['Mi título', 'Mi texto', 'a.csv', 'text/csv'],
    ['b.txt', '', 'b.txt', 'text/plain'],
    ['Otro título', 'Otro texto', 'c.pdf', 'application/pdf'],
    ['d.bin', '', 'd.bin', 'application/octet-stream']
  ]);
});

test('en la descarga el archivo lleva el tipo pedido, o text/plain y application/octet-stream si no se dijo', async () => {
  const { log, env } = browser({ navigator: {} });
  IO.setEnv(env);
  await IO.saveText('a.csv', 'text/csv', 'x');
  await IO.saveText('b.txt', undefined, 'x');
  await IO.saveBytes('c.pdf', 'application/pdf', new Uint8Array(2));
  await IO.saveBytes('d.bin', undefined, new Uint8Array(2));
  assert.deepEqual(log.blobs.map((b) => b.type), ['text/csv', 'text/plain', 'application/pdf', 'application/octet-stream']);
});

test('cancelar se reconoce por el nombre, por el mensaje o porque el error es un texto; un error cualquiera o vacío no es cancelar', async () => {
  const comparte = (rechazo) => ({ Capacitor: { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async () => ({ uri: 'u' }) }, Share: { share: () => Promise.reject(rechazo) } } } });
  for (const [rechazo, cancela] of [[{ name: 'AbortError' }, true], [{ message: 'Share canceled' }, true], ['Share dismissed', true], [{ name: 'NotAllowedError', message: 'cancel' }, true],
    [{ name: 'Error', message: 'disco lleno' }, false], ['disco lleno', false], [{}, false], [null, false]]) {
    IO.setEnv(comparte(rechazo));
    if (cancela) assert.deepEqual(await IO.saveText('a.txt', 'text/plain', 'x'), { how: 'cancel', name: 'a.txt' }, JSON.stringify(rechazo));
    else await assert.rejects(IO.saveText('a.txt', 'text/plain', 'x'), () => true, JSON.stringify(rechazo));
  }
});

test('saveBytes en la app: con justo 1 trozo no se anexa nada; con 2 trozos exactos, un solo anexo', async () => {
  const log = [];
  IO.setEnv({ Capacitor: { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async () => { log.push('write'); return { uri: 'u' }; }, appendFile: async () => { log.push('append'); } },
    Share: { share: async () => { log.push('share'); } } } } });
  await IO.saveBytes('a.zip', 'application/zip', new Uint8Array(CHUNK));
  assert.deepEqual(log, ['write', 'share']);
  log.length = 0;
  await IO.saveBytes('b.zip', 'application/zip', new Uint8Array(CHUNK * 2));
  assert.deepEqual(log, ['write', 'append', 'share']);
});
