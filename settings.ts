import { readFile, rename, writeFile } from 'node:fs/promises';

export const defaultPreferences = {
  theme: 'light',
  username: 'Matheus',
  productionUrl: '',
  developmentUrl: 'http://localhost:4321',
};

export type Preferences = typeof defaultPreferences;

export const defaultLayout = { sidebarWidth: 288 };

export function validateLayout(input: unknown): typeof defaultLayout {
  const width = input && typeof input === 'object' ? (input as Record<string, unknown>).sidebarWidth : null;
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 220 || width > 520) {
    throw new Error('A largura da barra lateral deve estar entre 220 e 520 pixels.');
  }
  return { sidebarWidth: width };
}

export function validatePreferences(input: unknown): Preferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configurações inválidas.');
  const data = input as Record<string, unknown>;
  if (!['light', 'dark', 'system', 'brutalist-light'].includes(data.theme as string)) throw new Error('Selecione um tema válido.');
  if (typeof data.username !== 'string' || !data.username.trim() || data.username.trim().length > 80) {
    throw new Error('Informe um nome de usuário com até 80 caracteres.');
  }
  function address(key: string, label: string) {
    if (typeof data[key] !== 'string') throw new Error(`Informe o endereço de ${label}.`);
    const value = data[key].trim();
    if (!value) return '';
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
      return url.href.replace(/\/+$/, '');
    } catch { throw new Error(`Use um endereço http ou https válido para ${label}, sem credenciais, busca ou fragmento.`); }
  }
  return {
    theme: data.theme as string, username: data.username.trim(),
    productionUrl: address('productionUrl', 'produção'),
    developmentUrl: address('developmentUrl', 'desenvolvimento'),
  };
}

// Keep older folder settings and unknown fields when adding preferences.
export async function openSettings(path: string) {
  let saved: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
  } catch { /* First launch or an unreadable settings file: use defaults. */ }
  const preferences = { ...defaultPreferences };
  for (const key of Object.keys(preferences) as (keyof Preferences)[]) {
    try { preferences[key] = validatePreferences({ ...defaultPreferences, [key]: saved[key] })[key]; }
    catch { /* Recover each preference independently. */ }
  }
  saved = { ...saved, ...preferences };
  let pending = Promise.resolve();
  return {
    get value() { return { ...saved }; },
    get layout() {
      try { return validateLayout(saved); }
      catch { return { ...defaultLayout }; }
    },
    get preferences(): Preferences {
      return { theme: saved.theme as string, username: saved.username as string, productionUrl: saved.productionUrl as string, developmentUrl: saved.developmentUrl as string };
    },
    update(patch: Record<string, unknown>) {
      const operation = pending.catch(() => {}).then(async () => {
        const next = { ...saved, ...patch };
        await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2));
        await rename(`${path}.tmp`, path);
        saved = next;
      });
      pending = operation;
      return operation;
    },
  };
}
