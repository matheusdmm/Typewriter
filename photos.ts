import { access, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const formats: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const asText = (value: FormDataEntryValue | null) => typeof value === 'string' ? value.trim() : '';
const quote = (value: string) => JSON.stringify(value);

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validMagic(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mime === 'image/webp') return bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

export async function savePhoto(dir: string, form: FormData) {
  const title = asText(form.get('title'));
  const caption = asText(form.get('caption'));
  const alt = asText(form.get('alt'));
  const date = asText(form.get('date'));
  const sourceName = asText(form.get('sourceName'));
  const extension = extname(sourceName).toLowerCase();
  const mime = formats[extension];
  const slug = slugify(title);
  const image = form.get('image');

  if (!title || !caption || !alt || !validDate(date)) throw new Error('Preencha título, data, texto alternativo e legenda.');
  if (!slug) throw new Error('O título precisa conter letras ou números.');
  if (!mime || !(image instanceof Blob)) throw new Error('Use uma imagem JPEG, PNG ou WebP.');
  if (image.size === 0 || image.size > 50_000_000) throw new Error('A imagem precisa ter até 50 MB.');
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (image.type !== mime || !validMagic(bytes, mime)) throw new Error('O formato da imagem não corresponde à extensão.');

  let tags: string[] = [];
  try {
    const input = JSON.parse(asText(form.get('tags')) || '[]');
    if (!Array.isArray(input)) throw new Error();
    tags = [...new Set(input.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
  } catch { throw new Error('As tags são inválidas.'); }

  let location: { name: string; latitude: number; longitude: number } | null = null;
  const rawLocation = asText(form.get('location'));
  if (rawLocation) {
    try {
      const input = JSON.parse(rawLocation);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const latitude = Number(input.latitude);
      const longitude = Number(input.longitude);
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error();
      location = { name, latitude, longitude };
    } catch { throw new Error('Informe um nome válido para o local.'); }
  }

  const imageName = `${slug}${extension}`;
  const markdownName = `${slug}.md`;
  const imagePath = join(dir, imageName);
  const markdownPath = join(dir, markdownName);
  if (await exists(imagePath) || await exists(markdownPath)) throw new Error('Já existe uma foto com esse título. Escolha outro.');

  const lines = [
    '---',
    `image: ${quote(`./${imageName}`)}`,
    `alt: ${quote(alt)}`,
    `caption: ${quote(caption)}`,
    `date: ${date}`,
    `title: ${quote(title)}`,
  ];
  if (tags.length) lines.push(`tags: [${tags.map(quote).join(', ')}]`);
  if (location) lines.push('location:', `  name: ${quote(location.name)}`, `  latitude: ${location.latitude.toFixed(7)}`, `  longitude: ${location.longitude.toFixed(7)}`);
  const markdown = `${lines.join('\n')}\n---\n`;

  let imageCreated = false;
  let markdownCreated = false;
  try {
    await writeFile(imagePath, bytes, { flag: 'wx' });
    imageCreated = true;
    await writeFile(markdownPath, markdown, { flag: 'wx' });
    markdownCreated = true;
  } catch (error) {
    if (markdownCreated) await unlink(markdownPath).catch(() => {});
    if (imageCreated) await unlink(imagePath).catch(() => {});
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('Já existe uma foto com esse título. Escolha outro.');
    throw error;
  }

  return { slug, imageName, markdownName };
}
