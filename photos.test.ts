import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePhoto } from './photos';
import { readExif } from './photo-exif.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

test('salva imagem e Markdown, rejeita colisão e não publica GPS sem consentimento', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mth-photo-test-'));
  folders.push(folder);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.set('image', new Blob([png], { type: 'image/png' }), 'foto.png');
  form.set('sourceName', 'foto.png');
  form.set('title', 'Café da Manhã');
  form.set('caption', 'Uma foto');
  form.set('alt', 'Xícara sobre a mesa');
  form.set('date', '2026-10-06');
  form.set('tags', JSON.stringify(['café', 'mesa']));
  const result = await savePhoto(folder, form);
  expect(result).toEqual({ slug: 'cafe-da-manha', imageName: 'cafe-da-manha.png', markdownName: 'cafe-da-manha.md' });
  expect(await readFile(join(folder, result.imageName))).toEqual(png);
  const markdown = await readFile(join(folder, result.markdownName), 'utf8');
  expect(markdown).toContain('image: "./cafe-da-manha.png"');
  expect(markdown).toContain('tags: ["café", "mesa"]');
  expect(markdown).not.toContain('location:');
  await expect(savePhoto(folder, form)).rejects.toThrow('Já existe');
  expect((await readdir(folder)).sort()).toEqual(['cafe-da-manha.md', 'cafe-da-manha.png']);
});

test('lê data EXIF e ignora dados ausentes', () => {
  const date = '2024:02:29 12:30:00\0';
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + date.length);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x0132, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, date.length, true);
  view.setUint32(18, 26, true);
  for (let i = 0; i < date.length; i++) tiff[26 + i] = date.charCodeAt(i);
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  payload.set(tiff, 6);
  const jpeg = new Uint8Array(2 + 4 + payload.length + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]);
  jpeg.set(payload, 6);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  expect(readExif(jpeg.buffer)).toEqual({ date: '2024-02-29', gps: null });
  expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toEqual({ date: null, gps: null });
});

test('lê coordenadas GPS do EXIF', () => {
  const tiff = new Uint8Array(128);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8825, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint16(26, 4, true);
  function entry(offset: number, tag: number, type: number, count: number, value: number) {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    view.setUint32(offset + 8, value, true);
  }
  entry(28, 1, 2, 2, 'S'.charCodeAt(0));
  entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 'W'.charCodeAt(0));
  entry(64, 4, 5, 3, 104);
  for (const [offset, values] of [[80, [23, 30, 0]], [104, [46, 40, 0]]] as const) {
    values.forEach((value, index) => {
      view.setUint32(offset + index * 8, value, true);
      view.setUint32(offset + index * 8 + 4, 1, true);
    });
  }
  const png = new Uint8Array(8 + 12 + tiff.length);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(8, tiff.length);
  png.set([0x65, 0x58, 0x49, 0x66], 12);
  png.set(tiff, 16);
  expect(readExif(png.buffer)).toEqual({ date: null, gps: { latitude: -23.5, longitude: -(46 + 40 / 60) } });
});
