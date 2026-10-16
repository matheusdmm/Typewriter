import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { resolvePostImage } from './post-image';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => {
    if (!folder.startsWith(`${import.meta.dir}${sep}`)) throw new Error('Pasta de teste fora do projeto.');
    return rm(folder, { recursive: true, force: true });
  }));
});

test('encontra imagens em public e relativas ao post sem permitir sair do projeto', async () => {
  const root = await mkdtemp(join(import.meta.dir, 'post-image-test-'));
  folders.push(root);
  const posts = join(root, 'src', 'content', 'blog');
  const images = join(root, 'src', 'content', 'img');
  const publicImages = join(root, 'public', 'images');
  await Promise.all([mkdir(posts, { recursive: true }), mkdir(images, { recursive: true }), mkdir(publicImages, { recursive: true })]);
  await Promise.all([
    writeFile(join(publicImages, 'capa.png'), 'png'),
    writeFile(join(posts, 'inline.jpg'), 'jpg'),
    writeFile(join(images, 'foto.webp'), 'webp'),
    writeFile(join(root, 'segredo.png'), 'secret'),
  ]);

  expect(await resolvePostImage('/images/capa.png', posts, root)).toEqual({ path: join(publicImages, 'capa.png'), type: 'image/png' });
  expect(await resolvePostImage('./inline.jpg', posts, root)).toEqual({ path: join(posts, 'inline.jpg'), type: 'image/jpeg' });
  expect(await resolvePostImage('../img/foto.webp', posts, root)).toEqual({ path: join(images, 'foto.webp'), type: 'image/webp' });
  await expect(resolvePostImage('/../segredo.png', posts, root)).rejects.toThrow('dentro do projeto');
  await expect(resolvePostImage('../../../../segredo.png', posts, root)).rejects.toThrow('dentro do projeto');
  await expect(resolvePostImage('/images/ausente.png', posts, root)).rejects.toThrow();
  await expect(resolvePostImage('javascript:alert(1)', posts, root)).rejects.toThrow();
});
