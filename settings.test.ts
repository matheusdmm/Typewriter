import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLayout, defaultPreferences, openSettings, validateLayout, validatePreferences } from './settings';

async function temporarySettings(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'typewriter-settings-'));
  try { await run(join(directory, 'editor-settings.json')); }
  finally {
    if (!directory.startsWith(`${tmpdir()}\\`) && !directory.startsWith(`${tmpdir()}/`)) throw new Error('Pasta de teste inválida.');
    await rm(directory, { recursive: true, force: true });
  }
}

test('adiciona preferências às configurações antigas sem perder pastas ou outros campos', async () => {
  await temporarySettings(async (path) => {
    const legacy = { postsDir: '/blog/posts', photosDir: '/blog/photos', futureOption: true };
    await writeFile(path, JSON.stringify(legacy));
    const store = await openSettings(path);
    expect(store.preferences).toEqual(defaultPreferences);
    await store.update(validatePreferences({ ...defaultPreferences, theme: 'dark', username: 'Ana' }));
    expect((await openSettings(path)).value).toEqual({ ...legacy, ...defaultPreferences, theme: 'dark', username: 'Ana' });
    await store.update({ postsDir: '/other/posts' });
    expect((await openSettings(path)).preferences).toEqual({ ...defaultPreferences, theme: 'dark', username: 'Ana' });
  });
});

test('preserva mudanças concorrentes em preferências e pastas', async () => {
  await temporarySettings(async (path) => {
    const store = await openSettings(path);
    await Promise.all([
      store.update({ username: 'Ana', theme: 'system' }),
      store.update({ postsDir: '/posts' }),
      store.update({ photosDir: '/photos' }),
    ]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ...defaultPreferences, username: 'Ana', theme: 'system', postsDir: '/posts', photosDir: '/photos' });
  });
});

test('recupera preferências inválidas individualmente ao abrir o aplicativo', async () => {
  await temporarySettings(async (path) => {
    await writeFile(path, JSON.stringify({ theme: 'invalid', username: 'Ana', productionUrl: 'javascript:alert(1)', developmentUrl: 'http://localhost:8080/site/' }));
    expect((await openSettings(path)).preferences).toEqual({ ...defaultPreferences, username: 'Ana', developmentUrl: 'http://localhost:8080/site' });
  });
});

test('valida nome e tema e aceita apenas endereços http(s) sem credenciais', () => {
  for (const patch of [
    { username: '   ' }, { username: 'a'.repeat(81) }, { theme: 'other' },
    { productionUrl: 'javascript:alert(1)' }, { developmentUrl: 'file:///C:/blog' },
    { productionUrl: 'https://user:pass@example.com' }, { developmentUrl: 'http://localhost:4321/?test=1' },
    { productionUrl: 'https://example.com/#fragment' }, { developmentUrl: null },
  ]) expect(() => validatePreferences({ ...defaultPreferences, ...patch })).toThrow();
  expect(validatePreferences({ ...defaultPreferences, username: ' Ana ', productionUrl: ' https://example.com/site/ ', developmentUrl: '' }))
    .toEqual({ ...defaultPreferences, username: 'Ana', productionUrl: 'https://example.com/site', developmentUrl: '' });
});

test('recupera largura inválida sem perder as preferências existentes', async () => {
  await temporarySettings(async (path) => {
    await writeFile(path, JSON.stringify({ ...defaultPreferences, username: 'Ana', sidebarWidth: 9_000 }));
    const store = await openSettings(path);
    expect(store.layout).toEqual(defaultLayout);
    expect(store.preferences.username).toBe('Ana');
    for (const sidebarWidth of [null, '320', 219, 521, 300.5]) expect(() => validateLayout({ sidebarWidth })).toThrow();
  });
});

test.each(['dark', 'brutalist-light'])('API salva, rejeita configurações inválidas e restaura as preferências após reiniciar (%s)', async (theme) => {
  await temporarySettings(async (path) => {
    const directory = join(path, '..');
    let child: ReturnType<typeof Bun.spawn> | null = null;
    async function start() {
      child = Bun.spawn([process.execPath, 'run', join(import.meta.dir, 'server.ts'), '--editor-dir', directory, '--desktop'], {
        env: { ...process.env, EDITOR_PORT: '0' }, stdout: 'pipe', stderr: 'pipe', windowsHide: true,
      });
      let output = '';
      for await (const chunk of child.stdout) {
        output += new TextDecoder().decode(chunk);
        const match = output.match(/MTH_EDITOR_READY (.+)\r?\n/);
        if (match) return JSON.parse(match[1]).url as string;
      }
      throw new Error(`Servidor não iniciou: ${output}`);
    }
    async function stop() {
      child?.kill();
      if (child) await child.exited;
      child = null;
    }
    try {
      let base = await start();
      const put = (data: unknown) => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const desired = { theme, username: 'Ana', productionUrl: 'https://example.com/site', developmentUrl: 'http://localhost:4321' };
      expect(await (await fetch(`${base}/api/layout`)).json()).toEqual(defaultLayout);
      const layoutRequest = (sidebarWidth: number) => fetch(`${base}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidebarWidth }) });
      expect((await layoutRequest(420)).status).toBe(200);
      expect((await layoutRequest(9_000)).status).toBe(400);
      expect((await put(desired)).status).toBe(200);
      expect((await put({ ...desired, theme: 'invalid' })).status).toBe(400);
      expect(await (await fetch(`${base}/api/settings`)).json()).toEqual(desired);
      await stop();
      base = await start();
      expect(await (await fetch(`${base}/api/settings`)).json()).toEqual(desired);
      expect(await (await fetch(`${base}/api/layout`)).json()).toEqual({ sidebarWidth: 420 });
      for (const route of ['/', '/photos', '/settings']) {
        const page = await fetch(`${base}${route}`);
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toContain(`data-theme="${theme}"`);
        expect(html).toContain('href="/settings"');
        expect(html).toContain('--sidebar-width:420px');
        expect(html).toContain('class="blog-addresses"');
      }
      for (const route of ['/preferences.js', '/settings.js', '/sidebar.js', '/themes.css']) expect((await fetch(`${base}${route}`)).status).toBe(200);
    } finally { await stop(); }
  });
}, 15_000);
