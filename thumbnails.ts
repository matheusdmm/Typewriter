import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cacheDir = join(tmpdir(), 'mth-editor-thumbnails-v1');
const pending = new Map<string, Promise<void>>();
const queue: (() => void)[] = [];
let active = 0;
let lastPruned = 0;

async function withSlot<T>(task: () => Promise<T>) {
  if (active >= 2) await new Promise<void>((resolve) => queue.push(resolve));
  else active++;
  try { return await task(); }
  finally {
    const next = queue.shift();
    if (next) next(); else active--;
  }
}

async function render(path: string): Promise<Uint8Array> {
  const executable = process.env.MTH_EDITOR_EXECUTABLE;
  const child = Bun.spawn(executable ? [executable, '--thumbnail'] : ['go', 'run', './thumbnail'], {
    cwd: executable ? undefined : join(import.meta.dir, 'launcher'),
    stdin: Bun.file(path), stdout: 'pipe', stderr: 'pipe', windowsHide: true,
  });
  const timer = setTimeout(() => child.kill(), 60_000);
  try {
    const [bytes, error, code] = await Promise.all([
      new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0 || bytes.length === 0) throw new Error(error.trim() || 'Não foi possível gerar a miniatura.');
    return bytes;
  } finally { clearTimeout(timer); }
}

// Cache entries expire on disk; originals and Markdown files are never modified.
async function pruneCache() {
  if (Date.now() - lastPruned < 60 * 60_000) return;
  lastPruned = Date.now();
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  for (const entry of await readdir(cacheDir)) {
    if (!/^[a-f0-9]{64}\.jpg(?:\.[a-f0-9-]+\.tmp)?$/.test(entry)) continue;
    const path = join(cacheDir, entry);
    try { if ((await stat(path)).mtimeMs < cutoff) await rm(path); } catch { /* Another process may have pruned it. */ }
  }
}

export async function thumbnailResponse(path: string, request: Request, options: {
  cacheDir?: string;
  render?: (path: string) => Promise<Uint8Array>;
} = {}) {
  const info = await stat(path, { bigint: true });
  const key = createHash('sha256').update(`${path}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\0thumb-v1-112-jpeg72`).digest('hex');
  const etag = `"${key}"`;
  const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (request.headers.get('if-none-match')?.split(',').map((value) => value.trim()).some((value) => value === etag || value === `W/${etag}` || value === '*')) {
    return new Response(null, { status: 304, headers });
  }
  const directory = options.cacheDir || cacheDir;
  const cachedPath = join(directory, `${key}.jpg`);
  if (!await Bun.file(cachedPath).exists()) {
    let job = pending.get(cachedPath);
    if (!job) {
      job = withSlot(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (await Bun.file(cachedPath).exists()) return;
        const bytes = await (options.render || render)(path);
        const temporary = `${cachedPath}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, bytes, { mode: 0o600 });
          try { await rename(temporary, cachedPath); }
          catch (error) { if (!await Bun.file(cachedPath).exists()) throw error; }
        } finally { await rm(temporary, { force: true }); }
      });
      pending.set(cachedPath, job);
      job.finally(() => pending.delete(cachedPath)).catch(() => {});
    }
    await job;
  }
  const bytes = await Bun.file(cachedPath).bytes();
  if (!options.cacheDir) void pruneCache().catch(() => {});
  return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ...headers, 'Content-Length': String(bytes.length) } });
}
