import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thumbnailResponse } from './thumbnails';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mth-thumb-test-'));
  folders.push(directory);
  const path = join(directory, 'image.png');
  await writeFile(path, 'source');
  return { path, cacheDir: join(directory, 'cache') };
}
const request = (headers?: HeadersInit, method = 'GET') => new Request('http://127.0.0.1/api/photos/test.md/thumbnail', { headers, method });

test('reuses cached thumbnail, validates ETag and refreshes when source changes', async () => {
  const { path, cacheDir } = await fixture();
  let calls = 0;
  const options = { cacheDir, render: async () => { calls++; return new Uint8Array([1, 2, 3]); } };
  const first = await thumbnailResponse(path, request(), options);
  expect(first.headers.get('content-type')).toBe('image/jpeg');
  expect(first.headers.get('content-length')).toBe('3');
  expect([...await first.bytes()]).toEqual([1, 2, 3]);
  const second = await thumbnailResponse(path, request(), options);
  expect([...await second.bytes()]).toEqual([1, 2, 3]);
  expect(calls).toBe(1);
  const etag = first.headers.get('etag')!;
  expect((await thumbnailResponse(path, request({ 'If-None-Match': `W/${etag}` }), options)).status).toBe(304);
  await writeFile(path, 'changed-source');
  const updated = await thumbnailResponse(path, request({ 'If-None-Match': etag }), options);
  expect(updated.status).toBe(200);
  expect(updated.headers.get('etag')).not.toBe(etag);
  expect(calls).toBe(2);
  expect((await thumbnailResponse(path, request(undefined, 'HEAD'), options)).body).toBeNull();
});

test('deduplicates concurrent requests and bounds image generation to two workers', async () => {
  const { path, cacheDir } = await fixture();
  let active = 0, peak = 0, calls = 0;
  const render = async () => {
    calls++; active++; peak = Math.max(peak, active);
    try { await Bun.sleep(20); return new Uint8Array([1]); } finally { active--; }
  };
  await Promise.all(Array.from({ length: 6 }, () => thumbnailResponse(path, request(), { cacheDir, render })));
  expect(calls).toBe(1);
  const paths = Array.from({ length: 6 }, (_, i) => `${path}-${i}`);
  await Promise.all(paths.map((file) => writeFile(file, 'image')));
  await Promise.all(paths.map((file) => thumbnailResponse(file, request(), { cacheDir, render })));
  expect(calls).toBe(7);
  expect(peak).toBe(2);
});

test('failed generation can be retried without keeping a broken cache entry', async () => {
  const { path, cacheDir } = await fixture();
  await expect(thumbnailResponse(path, request(), { cacheDir, render: async () => { throw new Error('decode failed'); } })).rejects.toThrow('decode failed');
  const result = await thumbnailResponse(path, request(), { cacheDir, render: async () => new Uint8Array([9]) });
  expect([...await result.bytes()]).toEqual([9]);
});
