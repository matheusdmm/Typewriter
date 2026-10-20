const executableName = 'Typewriter';
const platform = process.platform;
if (platform !== 'win32' && platform !== 'linux') {
  throw new Error(`Sistema operacional não suportado: ${platform}. Use Windows ou Linux.`);
}

const isWindows = platform === 'win32';
const dir = import.meta.dir;
const outputPath = `${dir}/${executableName}${isWindows ? '.exe' : ''}`;
const serverPath = `${dir}/launcher/server.bin${isWindows ? '.exe' : ''}`;
const embeddedPath = `${dir}/launcher/server.bin`;
const goArch = process.arch === 'x64' ? 'amd64' : process.arch;
const iconResource = `app_windows_${goArch}.syso`;
const built = await Bun.build({
  entrypoints: [`${dir}/server.ts`],
  compile: { outfile: serverPath },
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

let code: number;
try {
  if (isWindows) await Bun.write(embeddedPath, Bun.file(serverPath));
  const commands = [
    ...(isWindows ? [['windres', '-i', 'app.rc', '-o', iconResource]] : []),
    ...(process.argv.includes('--check') ? [['go', 'test', '-v', './...']] : []),
    ['go', 'build', ...(isWindows ? ['-ldflags=-H=windowsgui'] : []), '-o', outputPath, '.'],
  ];
  for (const args of commands) {
    const command = Bun.spawn(args, {
      cwd: `${dir}/launcher`, stdout: 'inherit', stderr: 'inherit',
      env: { ...process.env, CGO_ENABLED: '1', GOOS: isWindows ? 'windows' : 'linux', GOARCH: goArch },
    });
    code = await command.exited;
    if (code !== 0) break;
  }
} finally {
  await Bun.file(serverPath).delete();
  if (isWindows && await Bun.file(embeddedPath).exists()) await Bun.file(embeddedPath).delete();
  const resourcePath = `${dir}/launcher/${iconResource}`;
  if (isWindows && await Bun.file(resourcePath).exists()) await Bun.file(resourcePath).delete();
}
if (code !== 0) process.exit(code);
console.log(`Compilado para ${isWindows ? 'Windows' : 'Linux'}: ${outputPath}`);
