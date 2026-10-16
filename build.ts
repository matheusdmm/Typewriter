import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const dir = import.meta.dir;
const serverPath = join(dir, 'launcher', 'MTH-Editor-Server.exe');
const built = await Bun.build({
  entrypoints: [join(dir, 'server.ts')],
  compile: { outfile: serverPath },
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const command = Bun.spawn(['go', 'build', '-ldflags=-H=windowsgui', '-o', join(dir, 'MTH-Editor.exe'), 'main.go'], {
  cwd: join(dir, 'launcher'), stdout: 'inherit', stderr: 'inherit',
});
const code = await command.exited;
if (code !== 0) process.exit(code);
await unlink(serverPath);
console.log('MTH-Editor.exe pronto.');
