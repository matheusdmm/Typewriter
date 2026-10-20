import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePostImage } from './post-image';

type Location = { name: string; latitude?: number; longitude?: number };
export type Photo = {
  id: string; image: string; title: string; alt: string; caption: string;
  date: string; tags: string[]; location: Location | null; revision: string;
};

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const text = (value: unknown) => typeof value === 'string' ? value : '';

function split(raw: string) {
  const match = raw.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$)[\s\S]*)$/);
  if (!match) throw new Error('Este arquivo não tem um cabeçalho Markdown válido.');
  const data = Bun.YAML.parse(match[2]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Cabeçalho da foto inválido.');
  return { prefix: match[1], frontmatter: match[2], suffix: match[3], data: data as Record<string, unknown> };
}

export function parsePhoto(id: string, raw: string): Photo {
  const { data } = split(raw);
  if (!text(data.image)) throw new Error('O post da foto precisa informar uma imagem.');
  const location = data.location && typeof data.location === 'object' ? data.location as Location : null;
  const date = text(data.date);
  return {
    id, image: text(data.image), title: text(data.title), alt: text(data.alt), caption: text(data.caption),
    date: date.slice(0, 10),
    tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    location: location ? { name: text(location.name), ...(typeof location.latitude === 'number' ? { latitude: location.latitude } : {}), ...(typeof location.longitude === 'number' ? { longitude: location.longitude } : {}) } : null,
    revision: hash(raw),
  };
}

async function photoPath(dir: string, id: string) {
  if (!/^[^\\/:\0]+\.md$/i.test(id) || id.includes('..')) throw new Error('Foto inválida.');
  const path = join(dir, id);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Escolha um arquivo Markdown da galeria.');
  return path;
}

export async function readPhoto(dir: string, id: string) {
  return parsePhoto(id, await readFile(await photoPath(dir, id), 'utf8'));
}

export async function listPhotos(dir: string) {
  const photos: Photo[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!/\.md$/i.test(entry.name) || !entry.isFile()) continue;
    try { photos.push(await readPhoto(dir, entry.name)); }
    catch (error) { errors.push({ id: entry.name, error: error instanceof Error ? error.message : 'Arquivo inválido.' }); }
  }
  photos.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { photos, errors };
}

export async function resolvePhotoImage(dir: string, id: string) {
  const photo = await readPhoto(dir, id);
  return resolvePostImage(photo.image, dir, null);
}

function validate(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Dados inválidos.');
  const data = input as Record<string, unknown>;
  const title = text(data.title).trim();
  const alt = text(data.alt).trim();
  const caption = text(data.caption).trim();
  const date = text(data.date);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!alt || !caption || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Preencha data, texto alternativo e legenda válidos.');
  }
  if (title.length > 200 || alt.length > 10_000 || caption.length > 100_000) throw new Error('Os dados da foto excedem o tamanho permitido.');
  if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string')) throw new Error('As tags são inválidas.');
  const tags = [...new Set((data.tags as string[]).map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
  let location: Location | null = null;
  if (data.location != null) {
    const place = data.location as Location;
    if (!text(place.name).trim()) throw new Error('Informe o nome do lugar.');
    const hasCoordinates = place.latitude != null || place.longitude != null;
    if (hasCoordinates && (typeof place.latitude !== 'number' || typeof place.longitude !== 'number' || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180)) {
      throw new Error('Informe latitude entre -90 e 90 e longitude entre -180 e 180.');
    }
    location = { name: place.name.trim(), ...(hasCoordinates ? { latitude: place.latitude, longitude: place.longitude } : {}) };
  }
  return { title, alt, caption, date, tags, location, revision: text(data.revision) };
}

// Replace only edited fields; retain the image reference, body, comments and other metadata.
function replaceField(frontmatter: string, key: string, value: string | null, newline: string) {
  const lines = frontmatter.split(/\r?\n/);
  const field = new RegExp(`^(?:${key}|'${key}'|"${key}")\\s*:`);
  const start = lines.findIndex((line) => field.test(line));
  if (start < 0) return value === null ? frontmatter : `${frontmatter}${newline}${key}: ${value}`;
  let end = start + 1;
  while (end < lines.length && !/^[^\s#][^:]*:/.test(lines[end])) end++;
  // Keep trailing blank lines and comments between top-level fields.
  while (end > start + 1 && /^(?:\s*|#.*)$/.test(lines[end - 1])) end--;
  lines.splice(start, end - start, ...(value === null ? [] : [`${key}: ${value}`]));
  return lines.join(newline);
}

const updates = new Set<string>();
export async function updatePhoto(dir: string, id: string, input: unknown) {
  const data = validate(input);
  const path = await photoPath(dir, id);
  if (updates.has(path)) throw new Error('Esta foto já está sendo salva. Tente novamente.');
  updates.add(path);
  try {
    const raw = await readFile(path, 'utf8');
    if (hash(raw) !== data.revision) {
      throw Object.assign(new Error('O arquivo mudou fora do editor. Reabra a foto antes de salvar.'), { status: 409 });
    }
    const previous = parsePhoto(id, raw);
    const parts = split(raw);
    const newline = raw.includes('\r\n') ? '\r\n' : '\n';
    let frontmatter = parts.frontmatter;
    for (const key of ['title', 'alt', 'caption', 'date', 'tags', 'location'] as const) {
      if (JSON.stringify(previous[key]) === JSON.stringify(data[key])) continue;
      frontmatter = replaceField(frontmatter, key, data[key] === null ? null : JSON.stringify(data[key]), newline);
    }
    const result = `${parts.prefix}${frontmatter}${parts.suffix}`;
    const photo = parsePhoto(id, result);
    await writeFile(path, result);
    return photo;
  } finally { updates.delete(path); }
}
