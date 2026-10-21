(() => {
  const form = document.querySelector('#settings-form');
  const fields = document.querySelector('#settings-fields');
  const save = document.querySelector('#settings-save');
  const discard = document.querySelector('#settings-discard');
  const state = document.querySelector('#settings-state');
  const error = document.querySelector('#settings-error');
  const theme = document.querySelector('#settings-theme');
  let saved = null;
  let dirty = false;
  let saving = false;
  const sessionId = crypto.randomUUID();

  function values() {
    return Object.fromEntries(new FormData(form));
  }
  function populate(preferences) {
    for (const [key, value] of Object.entries(preferences)) form.elements.namedItem(key).value = value;
    saved = { ...preferences };
    dirty = false;
    save.disabled = true;
    discard.disabled = true;
    state.textContent = 'Tudo salvo';
    state.classList.remove('changed');
    error.hidden = true;
  }
  function changed() {
    dirty = JSON.stringify(values()) !== JSON.stringify(saved);
    save.disabled = !dirty || saving;
    discard.disabled = !dirty || saving;
    state.textContent = dirty ? 'Alterações não salvas' : 'Tudo salvo';
    state.classList.toggle('changed', dirty);
    error.hidden = true;
    document.documentElement.dataset.theme = theme.value;
  }
  async function confirmLeave() {
    if (saving) return false;
    return !dirty || await window.editorDialogs.confirm('Você tem configurações não salvas. Descartar alterações?');
  }
  window.editorCanLeave = confirmLeave;
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  discard.addEventListener('click', () => {
    populate(saved);
    window.editorPreferences.apply(saved);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!saved || saving || !dirty) return;
    const input = values();
    saving = true;
    fields.disabled = true;
    save.disabled = true;
    state.textContent = 'Salvando…';
    error.hidden = true;
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar as configurações.');
      populate(result);
      window.editorPreferences.apply(result);
      state.textContent = 'Configurações salvas';
    } catch (cause) {
      error.textContent = cause.message;
      error.hidden = false;
      state.textContent = 'Erro ao salvar';
    } finally {
      saving = false;
      fields.disabled = false;
      save.disabled = !dirty;
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!save.disabled) form.requestSubmit();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!window.editorDesktop && !window.editorAllowUnload && dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  window.editorPreferences.ready.then((preferences) => {
    fields.disabled = false;
    populate(preferences);
  }).catch((cause) => {
    state.textContent = 'Erro ao carregar';
    error.textContent = `${cause.message} Reabra esta seção para tentar novamente.`;
    error.hidden = false;
  });
  window.addEventListener('editor-notice', (event) => { error.textContent = event.detail; error.hidden = false; });
  const session = (action) => fetch(`/api/session/${action}`, { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
  session('open');
  setInterval(() => session('ping'), 30_000);
  window.addEventListener('pageshow', (event) => { if (event.persisted) session('open'); });
  window.addEventListener('pagehide', () => { if (!navigator.sendBeacon('/api/session/close', sessionId)) session('close'); });
})();
