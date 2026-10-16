import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import html from './index.html' with { type: 'text' };
import script from './app.js' with { type: 'text' };
import styles from './style.css' with { type: 'text' };
import photoHtml from './photo.html' with { type: 'text' };
import photoScript from './photo.js' with { type: 'text' };
import photoStyles from './photo.css' with { type: 'text' };
import photoExif from './photo-exif.js' with { type: 'text' };
import { savePhoto } from './photos';
import { resolvePostImage } from './post-image';

const editorDirArg = process.argv.indexOf('--editor-dir');
const editorDir = editorDirArg >= 0 && process.argv[editorDirArg + 1]
  ? resolve(process.argv[editorDirArg + 1])
  : Bun.isStandaloneExecutable ? dirname(process.execPath) : import.meta.dir;
const parentDir = resolve(editorDir, '..');
const projectCandidates = [
  process.env.MTH_BLOG_DIR,
  parentDir, // Compatibilidade com o editor dentro do blog.
  join(parentDir, 'MTH-Blog'), // Repositórios lado a lado.
].filter((path): path is string => Boolean(path));
const projectRoot = await (async () => {
  for (const candidate of projectCandidates) {
    const path = resolve(candidate);
    if (await isDirectory(join(path, 'src', 'content', 'blog')) &&
        await isDirectory(join(path, 'src', 'content', 'img'))) return path;
  }
  return null;
})();
const defaultPostsDir = projectRoot ? join(projectRoot, 'src', 'content', 'blog') : null;
const defaultPhotosDir = projectRoot ? join(projectRoot, 'src', 'content', 'img') : null;
const settingsPath = join(editorDir, 'editor-settings.json');
let postsDir: string | null = null;
let photosDir: string | null = null;
function imageProjectRoot() {
  if (!postsDir) return projectRoot;
  const candidate = resolve(postsDir, '..', '..', '..');
  return resolve(candidate, 'src', 'content', 'blog').toLowerCase() === postsDir.toLowerCase() ? candidate : null;
}
const host = '127.0.0.1';
const preferredPort = Number(process.env.EDITOR_PORT || 4177);
let activePort = preferredPort;
const startedAt = Date.now();
const clients = new Map<string, number>();
let hadClient = false;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let server: ReturnType<typeof Bun.serve>;

function scheduleStop() {
  if (!Bun.isStandaloneExecutable || !hadClient || clients.size > 0) return;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (clients.size === 0) {
      server.stop();
      process.exit(0);
    }
  }, 2000);
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

try {
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  if (typeof settings.postsDir === 'string' && await isDirectory(settings.postsDir)) postsDir = resolve(settings.postsDir);
  if (typeof settings.photosDir === 'string' && await isDirectory(settings.photosDir)) photosDir = resolve(settings.photosDir);
} catch { /* Ainda não há uma pasta salva. */ }
if (!postsDir && defaultPostsDir) postsDir = defaultPostsDir;
if (!photosDir && defaultPhotosDir) photosDir = defaultPhotosDir;

async function saveSettings() {
  await writeFile(settingsPath, JSON.stringify({ postsDir, photosDir }, null, 2));
}

async function setPostsDir(folder: string) {
  const path = folder.trim();
  if (!path || !isAbsolute(path) || !await isDirectory(path)) throw new Error('Selecione uma pasta válida.');
  const selected = resolve(path);
  postsDir = selected;
  await saveSettings();
  return selected;
}

async function setPhotosDir(folder: string) {
  const path = folder.trim();
  if (!path || !isAbsolute(path) || !await isDirectory(path)) throw new Error('Selecione uma pasta válida.');
  const selected = resolve(path);
  photosDir = selected;
  await saveSettings();
  return selected;
}

async function pickFolder(kind: 'posts' | 'photos'): Promise<string | null> {
  if (process.platform !== 'win32') throw new Error('A seleção de pasta está disponível no Windows.');
  const label = kind === 'posts' ? 'dos posts' : 'das fotos';
  const command = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$dialog.Description = 'Selecione a pasta ${label}'`,
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }',
  ].join('; ');
  const process = Bun.spawn(['powershell.exe', '-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-Command', command], {
    windowsHide: true, stdout: 'pipe', stderr: 'pipe',
  });
  const output = await new Response(process.stdout).text();
  const code = await process.exited;
  if (code !== 0) throw new Error('Não foi possível abrir a seleção de pasta. Informe o caminho manualmente.');
  return output.trim() || null;
}

type Post = {
  id: string;
  title: string;
  description: string;
  pubDate: string;
  tags: string[];
  heroImage: string;
  hidden: boolean;
  body: string;
  revision: string;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const asString = (value: unknown) => typeof value === 'string' ? value : '';

function decodeScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function parseTags(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) return [];
  return (value.slice(1, -1).match(/(?:"(?:\\.|[^"])*"|'(?:''|[^'])*'|[^,])+/g) || [])
    .map((part) => decodeScalar(part.trim())).filter(Boolean);
}

function splitFile(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('Este arquivo não tem um cabeçalho Markdown válido.');
  return { frontmatter: match[1], body: match[2] };
}

function field(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

function parsePost(id: string, raw: string): Post {
  const { frontmatter, body } = splitFile(raw);
  const rawDate = decodeScalar(field(frontmatter, 'pubDate'));
  const parsedDate = new Date(rawDate);
  return {
    id,
    title: decodeScalar(field(frontmatter, 'title')),
    description: decodeScalar(field(frontmatter, 'description')),
    pubDate: Number.isNaN(parsedDate.valueOf()) ? rawDate : parsedDate.toISOString().slice(0, 10),
    tags: parseTags(field(frontmatter, 'tags')),
    heroImage: decodeScalar(field(frontmatter, 'heroImage')),
    hidden: field(frontmatter, 'hidden') === 'true',
    body,
    revision: hash(raw),
  };
}

function setField(frontmatter: string, key: string, value: string): string {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index >= 0) lines[index] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return lines.join('\n');
}

function serializePost(input: Post, existing?: string): string {
  const parts = existing ? splitFile(existing) : { frontmatter: '', body: '' };
  let frontmatter = parts.frontmatter;
  frontmatter = setField(frontmatter, 'title', JSON.stringify(input.title));
  frontmatter = setField(frontmatter, 'description', JSON.stringify(input.description));
  frontmatter = setField(frontmatter, 'pubDate', JSON.stringify(input.pubDate));
  frontmatter = setField(frontmatter, 'tags', JSON.stringify(input.tags));
  if (input.heroImage || field(frontmatter, 'heroImage')) {
    frontmatter = setField(frontmatter, 'heroImage', JSON.stringify(input.heroImage));
  }
  frontmatter = setField(frontmatter, 'hidden', String(input.hidden));
  return `---\n${frontmatter.trim()}\n---\n\n${input.body.replace(/^\n+/, '').replace(/\s*$/, '')}\n`;
}

function validId(id: string): boolean {
  return /^[^\\/]+\.md$/.test(id) && id !== '..' && id !== '.';
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'novo-post';
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validate(input: unknown): Post {
  if (!input || typeof input !== 'object') throw new Error('Dados inválidos.');
  const data = input as Record<string, unknown>;
  const title = asString(data.title).trim();
  const description = asString(data.description).trim();
  const pubDate = asString(data.pubDate).trim();
  const body = asString(data.body);
  if (!title || !description || !/^\d{4}-\d{2}-\d{2}$/.test(pubDate) || Number.isNaN(Date.parse(pubDate))) {
    throw new Error('Preencha título, descrição e uma data válida.');
  }
  if (title.length > 200 || description.length > 1000 || body.length > 1_000_000) {
    throw new Error('O post excede o tamanho permitido.');
  }
  return {
    id: asString(data.id), title, description, pubDate, body,
    tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 30) : [],
    heroImage: asString(data.heroImage).trim(),
    hidden: data.hidden === true,
    revision: asString(data.revision),
  };
}

async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Envie os dados em JSON.');
  const body = await request.text();
  if (body.length > 1_100_000) throw new Error('O post excede o tamanho permitido.');
  return validate(JSON.parse(body));
}

const options = {
  hostname: host,
  port: preferredPort,
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== `http://${host}:${activePort}`) return json({ error: 'Origem não permitida.' }, 403);
    try {
      const session = url.pathname.match(/^\/api\/session\/(open|ping|close)$/);
      if (session && request.method === 'POST') {
        const id = (await request.text()).trim();
        if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ error: 'Sessão inválida.' }, 400);
        if (session[1] === 'open') {
          hadClient = true;
          clients.set(id, Date.now());
          if (stopTimer) clearTimeout(stopTimer);
          stopTimer = undefined;
        } else if (session[1] === 'ping' && clients.has(id)) {
          clients.set(id, Date.now());
        } else if (session[1] === 'close') {
          clients.delete(id);
          scheduleStop();
        }
        return json({ ok: true });
      }
      if (url.pathname === '/api/config' && request.method === 'GET') return json({ folder: postsDir, isProjectFolder: postsDir === defaultPostsDir });
      if (url.pathname === '/api/folder' && request.method === 'POST') {
        const input = await request.json();
        const folder = await setPostsDir(asString(input?.folder));
        return json({ folder, isProjectFolder: folder === defaultPostsDir });
      }
      if (url.pathname === '/api/folder/pick' && request.method === 'POST') {
        const selected = await pickFolder('posts');
        const folder = selected ? await setPostsDir(selected) : postsDir;
        return json({ folder, isProjectFolder: folder === defaultPostsDir, canceled: !selected });
      }
      if (url.pathname === '/api/photo/config' && request.method === 'GET') return json({ folder: photosDir, isProjectFolder: photosDir === defaultPhotosDir });
      if (url.pathname === '/api/photo/folder' && request.method === 'POST') {
        const input = await request.json();
        const folder = await setPhotosDir(asString(input?.folder));
        return json({ folder, isProjectFolder: folder === defaultPhotosDir });
      }
      if (url.pathname === '/api/photo/folder/pick' && request.method === 'POST') {
        const selected = await pickFolder('photos');
        const folder = selected ? await setPhotosDir(selected) : photosDir;
        return json({ folder, isProjectFolder: folder === defaultPhotosDir, canceled: !selected });
      }
      if (url.pathname === '/api/photo/import' && request.method === 'POST') {
        if (!photosDir) throw new Error('Escolha a pasta da galeria antes de salvar.');
        const length = Number(request.headers.get('content-length'));
        if (length > 60_000_000) throw new Error('A imagem precisa ter até 50 MB.');
        const result = await savePhoto(photosDir, await request.formData());
        return json(result, 201);
      }
      if (url.pathname === '/api/post-image' && (request.method === 'GET' || request.method === 'HEAD')) {
        try {
          const { path, type } = await resolvePostImage(url.searchParams.get('src') || '', postsDir, imageProjectRoot());
          return new Response(request.method === 'HEAD' ? null : Bun.file(path), {
            headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
          });
        } catch (error) {
          const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
          return json({ error: missing ? 'Imagem não encontrada.' : error instanceof Error ? error.message : 'Imagem inválida.' }, missing ? 404 : 400);
        }
      }
      if (url.pathname === '/api/posts' && request.method === 'GET') {
        if (!postsDir) return json([]);
        const files = (await readdir(postsDir)).filter((name) => name.endsWith('.md'));
        const posts = await Promise.all(files.map(async (id) => parsePost(id, await readFile(join(postsDir, id), 'utf8'))));
        return json(posts.map(({ body, ...post }) => post).sort((a, b) => b.pubDate.localeCompare(a.pubDate)));
      }
      if (url.pathname === '/api/posts' && request.method === 'POST') {
        if (!postsDir) throw new Error('Escolha a pasta dos posts antes de salvar.');
        const post = await readBody(request);
        const base = slugify(post.title);
        const files = new Set(await readdir(postsDir));
        let id = `${base}.md`;
        for (let n = 2; files.has(id); n++) id = `${base}-${n}.md`;
        const raw = serializePost(post);
        await writeFile(join(postsDir, id), raw, { flag: 'wx' });
        return json(parsePost(id, raw), 201);
      }
      const match = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
      if (match) {
        if (!postsDir) throw new Error('Escolha a pasta dos posts.');
        const id = decodeURIComponent(match[1]);
        if (!validId(id)) return json({ error: 'Post inválido.' }, 400);
        const path = join(postsDir, id);
        if (request.method === 'GET') return json(parsePost(id, await readFile(path, 'utf8')));
        if (request.method === 'PUT') {
          const post = await readBody(request);
          const current = await readFile(path, 'utf8');
          if (post.revision !== hash(current)) return json({ error: 'O arquivo mudou fora do editor. Recarregue antes de salvar.' }, 409);
          const raw = serializePost(post, current);
          await writeFile(path, raw);
          return json(parsePost(id, raw));
        }
      }
      if (request.method !== 'GET') return json({ error: 'Operação não permitida.' }, 405);
      if (url.pathname === '/') return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/photos') return new Response(photoHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/app.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      if (url.pathname === '/style.css') return new Response(styles, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
      if (url.pathname === '/photo.js') return new Response(photoScript, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      if (url.pathname === '/photo.css') return new Response(photoStyles, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
      if (url.pathname === '/photo-exif.js') return new Response(photoExif, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      return new Response('Não encontrado', { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado.';
      return json({ error: message }, message.includes('ENOENT') ? 404 : 400);
    }
  },
} satisfies Parameters<typeof Bun.serve>[0];

try {
  server = Bun.serve(options);
} catch {
  server = Bun.serve({ ...options, port: 0 });
}
activePort = server.port;

console.log(`Editor local: http://${server.hostname}:${server.port}`);
if (process.argv.includes('--lifecycle-test')) {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  for (const id of [first, second]) await options.fetch(new Request(`http://${host}:${server.port}/api/session/open`, { method: 'POST', body: id }));
  await options.fetch(new Request(`http://${host}:${server.port}/api/session/close`, { method: 'POST', body: first }));
  await Bun.sleep(2500);
  if (clients.size !== 1) throw new Error('O editor encerrou antes da última aba.');
  console.log('A primeira aba fechou e o processo continuou.');
  await options.fetch(new Request(`http://${host}:${server.port}/api/session/close`, { method: 'POST', body: second }));
  await Bun.sleep(3500);
  throw new Error('O processo não encerrou após a última aba.');
}
if (process.argv.includes('--self-test')) {
  // A verificação não deve depender de arquivos pessoais fora deste projeto.
  postsDir = null;
  photosDir = null;
  const sample = serializePost({
    id: 'teste.md', title: 'Título de teste', description: 'Descrição', pubDate: '2026-10-06',
    tags: ['dev', 'música'], heroImage: '', hidden: true, body: '# Olá\n\nTexto.', revision: '',
  });
  const roundTrip = parsePost('teste.md', sample);
  const configResponse = await options.fetch(new Request(`http://${host}:${server.port}/api/config`));
  const config = await configResponse.json();
  const photoConfigResponse = await options.fetch(new Request(`http://${host}:${server.port}/api/photo/config`));
  const photoConfig = await photoConfigResponse.json();
  const photoPage = await options.fetch(new Request(`http://${host}:${server.port}/photos`));
  const photoScriptResponse = await options.fetch(new Request(`http://${host}:${server.port}/photo.js`));
  const response = await options.fetch(new Request(`http://${host}:${server.port}/api/posts`));
  const items = await response.json();
  const invalidFolder = await options.fetch(new Request(`http://${host}:${server.port}/api/folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: '' }),
  }));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  await options.fetch(new Request(`http://${host}:${server.port}/api/session/open`, { method: 'POST', body: sessionId }));
  const opened = clients.has(sessionId);
  await options.fetch(new Request(`http://${host}:${server.port}/api/session/close`, { method: 'POST', body: sessionId }));
  const imageFolder = await mkdtemp(join(tmpdir(), 'mth-editor-image-test-'));
  let imageServed = false;
  let imageRestricted = false;
  try {
    postsDir = imageFolder;
    await writeFile(join(imageFolder, 'teste.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
    const imageResponse = await options.fetch(new Request(`http://${host}:${server.port}/api/post-image?src=.%2Fteste.png`));
    imageServed = imageResponse.ok && imageResponse.headers.get('content-type') === 'image/png' && (await imageResponse.arrayBuffer()).byteLength > 0;
    const outsideResponse = await options.fetch(new Request(`http://${host}:${server.port}/api/post-image?src=..%2Ffora.png`));
    imageRestricted = outsideResponse.status === 400;
  } finally {
    postsDir = null;
    if (!imageFolder.startsWith(`${tmpdir()}\\`) && !imageFolder.startsWith(`${tmpdir()}/`)) throw new Error('Pasta de teste fora da área temporária.');
    await rm(imageFolder, { recursive: true, force: true });
  }
  const checks = {
    config: configResponse.ok && config.folder === postsDir,
    photoConfig: photoConfigResponse.ok && photoConfig.folder === photosDir,
    photoPage: photoPage.ok,
    photoScript: photoScriptResponse.ok,
    posts: response.ok && Array.isArray(items),
    invalidFolder: invalidFolder.status === 400,
    session: opened && !clients.has(sessionId),
    markdown: roundTrip.title === 'Título de teste' && roundTrip.tags[1] === 'música',
    image: imageServed && imageRestricted,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Falha na verificação do editor: ${failed.join(', ')}.`);
  console.log(`Verificação concluída: ${items.length} posts encontrados; executável: ${Bun.isStandaloneExecutable}.`);
  server.stop();
  process.exit(0);
}
if (Bun.isStandaloneExecutable && !process.argv.includes('--no-browser')) {
  const url = `http://${host}:${server.port}`;
  try {
    Bun.spawn(['rundll32.exe', 'url.dll,FileProtocolHandler', url], { windowsHide: true, stdout: 'ignore', stderr: 'ignore' }).unref();
  } catch (error) {
    console.error('Não foi possível abrir o navegador:', error);
  }
}
if (Bun.isStandaloneExecutable) setInterval(() => {
  const now = Date.now();
  for (const [id, seen] of clients) if (now - seen > 30 * 60_000) clients.delete(id);
  if (clients.size === 0) {
    if (hadClient) scheduleStop();
    else if (now - startedAt > 2 * 60_000) {
      server.stop();
      process.exit(0);
    }
  }
}, 30_000);
