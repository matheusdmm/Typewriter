import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPhotos, parsePhoto, readPhoto, resolvePhotoImage, updatePhoto } from './photo-library';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const sample = `---
image: './foto.png'
alt: 'Paisagem'
caption: |
  Primeira linha.
  Segunda linha.
date: 2026-10-18
tags:
  - viagem
  - 'd''água'
location:
  name: 'São Paulo'
  latitude: -23.5
  longitude: -46.6
# Configuração do blog
demo: true
custom:
  color: azul
---

Texto **original** do post.
`;

async function fixture(raw = sample) {
  const folder = await mkdtemp(join(tmpdir(), 'mth-photo-library-'));
  folders.push(folder);
  await writeFile(join(folder, 'foto.md'), raw);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  await writeFile(join(folder, 'foto.png'), image);
  return { folder, image };
}

test('lê YAML multilinha, tags em lista e título opcional', () => {
  const photo = parsePhoto('foto.md', sample);
  expect(photo.title).toBe('');
  expect(photo.caption).toBe('Primeira linha.\nSegunda linha.\n');
  expect(photo.tags).toEqual(['viagem', "d'água"]);
  expect(photo.location).toEqual({ name: 'São Paulo', latitude: -23.5, longitude: -46.6 });
  expect(photo.date).toBe('2026-10-18');
});

test('lista somente posts de fotos e reporta arquivos inválidos sem perder os demais', async () => {
  const { folder } = await fixture();
  await writeFile(join(folder, 'invalido.md'), 'sem cabeçalho');
  await writeFile(join(folder, 'post.md'), '---\ntitle: Post\n---\n');
  await writeFile(join(folder, 'recente.md'), sample.replace('2026-10-18', '2026-10-20'));
  const result = await listPhotos(folder);
  expect(result.photos.map((photo) => photo.id)).toEqual(['recente.md', 'foto.md']);
  expect(result.errors.map((item) => item.id).sort()).toEqual(['invalido.md', 'post.md']);
});

test('edita metadados no mesmo arquivo sem alterar imagem, corpo ou campos desconhecidos', async () => {
  const { folder, image } = await fixture(sample.replaceAll('\n', '\r\n'));
  const before = await readPhoto(folder, 'foto.md');
  const saved = await updatePhoto(folder, 'foto.md', {
    ...before, title: 'Novo título', alt: 'Nova descrição', caption: 'Legenda: "nova"\nOutra linha', date: '2024-02-29',
    tags: ['nova', 'nova', ' lugar '], location: { name: 'Equador', latitude: 0, longitude: 0 },
  });
  expect(saved).toMatchObject({ id: 'foto.md', title: 'Novo título', alt: 'Nova descrição', tags: ['nova', 'lugar'], location: { name: 'Equador', latitude: 0, longitude: 0 } });
  expect(saved.revision).not.toBe(before.revision);
  const raw = await readFile(join(folder, 'foto.md'), 'utf8');
  expect(raw).toContain("image: './foto.png'\r\n");
  expect(raw).toContain('# Configuração do blog\r\ndemo: true\r\ncustom:\r\n  color: azul\r\n');
  expect(raw).toEndWith('---\r\n\r\nTexto **original** do post.\r\n');
  expect(await readFile(join(folder, 'foto.png'))).toEqual(image);
  expect((await readdir(folder)).sort()).toEqual(['foto.md', 'foto.png']);
  expect(await readPhoto(folder, 'foto.md')).toEqual(saved);
});

test('remove localização e tags, preserva comentário e permite lugar sem coordenadas', async () => {
  const { folder } = await fixture();
  const photo = await readPhoto(folder, 'foto.md');
  const removed = await updatePhoto(folder, 'foto.md', { ...photo, location: null, tags: [] });
  const raw = await readFile(join(folder, 'foto.md'), 'utf8');
  expect(raw).not.toContain('location:');
  expect(raw).not.toContain('latitude:');
  expect(raw).not.toContain('  - viagem');
  expect(raw).toContain('# Configuração do blog');
  expect(removed.location).toBeNull();
  expect(removed.tags).toEqual([]);
  const nameOnly = await updatePhoto(folder, 'foto.md', { ...removed, location: { name: 'Lugar' } });
  expect(nameOnly.location).toEqual({ name: 'Lugar' });
});

test('preserva campos YAML e corpo intactos quando nada muda', async () => {
  const { folder } = await fixture();
  await updatePhoto(folder, 'foto.md', { ...await readPhoto(folder, 'foto.md'), caption: 'Primeira linha.\nSegunda linha.' });
  const before = await readFile(join(folder, 'foto.md'), 'utf8');
  await updatePhoto(folder, 'foto.md', await readPhoto(folder, 'foto.md'));
  expect(await readFile(join(folder, 'foto.md'), 'utf8')).toBe(before);
});

test('rejeita revisão desatualizada sem sobrescrever alteração externa', async () => {
  const { folder } = await fixture();
  const before = await readPhoto(folder, 'foto.md');
  const changed = sample.replace('Paisagem', 'Alteração externa');
  await writeFile(join(folder, 'foto.md'), changed);
  await expect(updatePhoto(folder, 'foto.md', { ...before, title: 'Título' })).rejects.toMatchObject({ status: 409 });
  expect(await readFile(join(folder, 'foto.md'), 'utf8')).toBe(changed);
});

test('edita chaves entre aspas e valida YAML antes de gravar', async () => {
  const quoted = sample.replace('caption: |', '"caption": |').replace('tags:', "'tags':");
  const { folder } = await fixture(quoted);
  const saved = await updatePhoto(folder, 'foto.md', { ...await readPhoto(folder, 'foto.md'), caption: 'Outra legenda', tags: ['nova'] });
  expect(saved.caption).toBe('Outra legenda');
  expect(saved.tags).toEqual(['nova']);
  const anchored = sample.replace("  name: 'São Paulo'", "  name: &place 'São Paulo'").replace('  color: azul', '  color: *place');
  await writeFile(join(folder, 'foto.md'), anchored);
  await expect(updatePhoto(folder, 'foto.md', { ...await readPhoto(folder, 'foto.md'), location: null })).rejects.toThrow();
  expect(await readFile(join(folder, 'foto.md'), 'utf8')).toBe(anchored);
});

test.each([
  { date: '2026-02-30' }, { alt: '' }, { caption: '' }, { tags: 'tag' }, { tags: [1] },
  { location: { name: '', latitude: 0, longitude: 0 } },
  { location: { name: 'Lugar', latitude: 91, longitude: 0 } },
  { location: { name: 'Lugar', latitude: 0 } },
])('rejeita dados inválidos sem tocar no arquivo: %j', async (changes) => {
  const { folder } = await fixture();
  await expect(updatePhoto(folder, 'foto.md', { ...await readPhoto(folder, 'foto.md'), ...changes })).rejects.toThrow();
  expect(await readFile(join(folder, 'foto.md'), 'utf8')).toBe(sample);
});

test('serve imagem referenciada e impede acesso fora da galeria', async () => {
  const { folder } = await fixture();
  expect(await resolvePhotoImage(folder, 'foto.md')).toEqual({ path: join(folder, 'foto.png'), type: 'image/png' });
  for (const id of ['../foto.md', '..\\foto.md', 'C:foto.md', 'foto.png']) {
    await expect(readPhoto(folder, id)).rejects.toThrow('Foto inválida');
  }
  await writeFile(join(folder, 'foto.md'), sample.replace('./foto.png', '../fora.png'));
  await expect(resolvePhotoImage(folder, 'foto.md')).rejects.toThrow('dentro do projeto');
});
