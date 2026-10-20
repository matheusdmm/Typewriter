// Integration check for the packaged app; does not start a window or edit blog files.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { thumbnailResponse } from './thumbnails';

const directory = await mkdtemp(join(tmpdir(), 'mth-desktop-check-'));
try {
  const source = join(directory, 'image.png');
  await writeFile(source, await Bun.file(`${import.meta.dir}/launcher/app-icon.png`).bytes());
  if (!process.argv[2]) throw new Error('Informe o executável: bun run verify-desktop.ts ./Typewriter.exe');
  const executable = resolve(process.argv[2]);
  const child = Bun.spawn([executable, '--thumbnail'], { stdin: Bun.file(source), stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [bytes, error, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(error || 'O executável não gerou um JPEG.');
  process.env.MTH_EDITOR_EXECUTABLE = executable;
  const request = new Request('http://127.0.0.1/api/photos/test.md/thumbnail');
  const first = await thumbnailResponse(source, request, { cacheDir: join(directory, 'cache') });
  if (first.status !== 200 || (await first.bytes()).length !== bytes.length) throw new Error('Falha ao servir miniatura.');
  const second = await thumbnailResponse(source, new Request(request, { headers: { 'If-None-Match': first.headers.get('etag')! } }), { cacheDir: join(directory, 'cache') });
  if (second.status !== 304) throw new Error('Falha na validação do cache.');
  console.log(`Aplicativo empacotado: ${bytes.length} bytes na miniatura; cache HTTP 304 confirmado.`);
} finally { await rm(directory, { recursive: true, force: true }); }
