import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sync from '../js/sync.js';

// Minimal fetch fake: each call shifts the next scripted response.
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const DATA = { exercises: [], template: { sections: [] }, sessions: [{ date: '2026-07-18', note: 'déjà vu ✓' }] };

function b64(data) { return sync.encodeContent(data); }

test('encode/decode roundtrip survives unicode', () => {
  assert.deepEqual(sync.decodeContent(sync.encodeContent(DATA)), DATA);
});

test('decodeContent tolerates newlines in GitHub base64', () => {
  const wrapped = sync.encodeContent(DATA).replace(/(.{20})/g, '$1\n');
  assert.deepEqual(sync.decodeContent(wrapped), DATA);
});

test('getRemote parses sha and content', async () => {
  const f = fakeFetch([{ status: 200, body: { sha: 'abc', content: b64(DATA) } }]);
  const r = await sync.getRemote(f, 'tok');
  assert.equal(r.status, 'ok');
  assert.equal(r.sha, 'abc');
  assert.deepEqual(r.data, DATA);
  assert.match(f.calls[0].url, /repos\/curtisnn\/cn-personal-habits\/contents\/data\/data\.json\?ref=main$/);
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer tok');
});

test('getRemote maps 401 and 404', async () => {
  assert.equal((await sync.getRemote(fakeFetch([{ status: 401, body: {} }]), 't')).status, 'auth');
  assert.equal((await sync.getRemote(fakeFetch([{ status: 404, body: {} }]), 't')).status, 'missing');
});

test('backup PUTs with the remote sha when it matches the last-written sha', async () => {
  const f = fakeFetch([
    { status: 200, body: { sha: 'abc', content: b64(DATA) } },
    { status: 200, body: { content: { sha: 'def' } } },
  ]);
  const r = await sync.backup(f, 'tok', DATA, 'abc', 'backup: session 2026-07-18');
  assert.deepEqual(r, { status: 'ok', sha: 'def' });
  const put = f.calls[1];
  assert.equal(put.opts.method, 'PUT');
  const body = JSON.parse(put.opts.body);
  assert.equal(body.sha, 'abc');
  assert.equal(body.branch, 'main');
  assert.equal(body.message, 'backup: session 2026-07-18');
  assert.deepEqual(sync.decodeContent(body.content), DATA);
});

test('backup reports divergence without writing when the remote sha differs', async () => {
  const f = fakeFetch([{ status: 200, body: { sha: 'other', content: b64(DATA) } }]);
  const r = await sync.backup(f, 'tok', DATA, 'abc', 'm');
  assert.equal(r.status, 'diverged');
  assert.equal(r.remote.sha, 'other');
  assert.equal(f.calls.length, 1);
});

test('backup treats a never-synced device as divergence when the file exists', async () => {
  const f = fakeFetch([{ status: 200, body: { sha: 'abc', content: b64(DATA) } }]);
  const r = await sync.backup(f, 'tok', DATA, null, 'm');
  assert.equal(r.status, 'diverged');
});

test('backup creates the file without a sha on 404', async () => {
  const f = fakeFetch([
    { status: 404, body: {} },
    { status: 201, body: { content: { sha: 'new' } } },
  ]);
  const r = await sync.backup(f, 'tok', DATA, null, 'm');
  assert.deepEqual(r, { status: 'ok', sha: 'new' });
  assert.equal('sha' in JSON.parse(f.calls[1].opts.body), false);
});

test('backup surfaces auth from either call', async () => {
  assert.equal((await sync.backup(fakeFetch([{ status: 401, body: {} }]), 't', DATA, 'a', 'm')).status, 'auth');
  const f = fakeFetch([
    { status: 200, body: { sha: 'abc', content: b64(DATA) } },
    { status: 401, body: {} },
  ]);
  assert.equal((await sync.backup(f, 't', DATA, 'abc', 'm')).status, 'auth');
});

test('putRemote maps 409/422 to conflict', async () => {
  const r = await sync.putRemote(fakeFetch([{ status: 409, body: {} }]), 't', DATA, 'a', 'm');
  assert.equal(r.status, 'conflict');
});

test('backup propagates network failure', async () => {
  await assert.rejects(sync.backup(fakeFetch([new Error('offline')]), 't', DATA, 'a', 'm'), /offline/);
});
