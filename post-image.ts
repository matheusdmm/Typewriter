import { lstat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const imageTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

function inside(root: string, target: string): boolean {
  const part = relative(root, target);
  return part !== '..' && !part.startsWith(`..\\`) && !part.startsWith('../') && !isAbsolute(part);
}

export async function resolvePostImage(source: string, postsDir: string | null, projectRoot: string | null) {
  if (!source || source.length > 2048 || source.startsWith('//') || source.includes('\\') || source.includes('\0') || /[?#]/.test(source)) {
    throw new Error('Caminho de imagem inválido.');
  }
  const publicRoute = source.startsWith('/');
  const root = publicRoute ? (projectRoot ? join(projectRoot, 'public') : null) : (projectRoot || postsDir);
  if (!root || !postsDir) throw new Error('Escolha uma pasta de posts em um projeto Astro para visualizar esta imagem.');
  const target = publicRoute ? resolve(root, `.${source}`) : resolve(postsDir, source);
  if (!inside(root, target)) throw new Error('A imagem precisa estar dentro do projeto.');
  const type = imageTypes[extname(target).toLowerCase()];
  if (!type) throw new Error('Use uma imagem JPG, PNG, WebP, GIF ou AVIF.');
  let current = root;
  let fileInfo;
  for (const part of relative(root, target).split(sep)) {
    current = join(current, part);
    fileInfo = await lstat(current);
    if (fileInfo.isSymbolicLink()) throw new Error('Links simbólicos não são aceitos em imagens locais.');
  }
  if (!fileInfo?.isFile()) throw new Error('Escolha um arquivo de imagem.');
  return { path: target, type };
}
