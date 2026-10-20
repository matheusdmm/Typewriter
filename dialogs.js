(() => {
  const dialog = document.createElement('dialog');
  dialog.className = 'image-dialog editor-dialog';
  dialog.setAttribute('aria-labelledby', 'editor-dialog-title');
  dialog.innerHTML = `<form method="dialog">
    <h2 id="editor-dialog-title"></h2>
    <label class="field"><span id="editor-dialog-label">Valor</span><input type="text" aria-labelledby="editor-dialog-title editor-dialog-label" autocomplete="off" spellcheck="false"></label>
    <div class="image-dialog-actions"><button type="button" data-cancel>Cancelar</button><button type="submit" value="accept">Continuar</button></div>
  </form>`;
  document.body.append(dialog);
  const title = dialog.querySelector('h2');
  const field = dialog.querySelector('label');
  const input = dialog.querySelector('input');
  const accept = dialog.querySelector('[type="submit"]');
  const cancel = dialog.querySelector('[data-cancel]');
  let pending = null;
  let queue = Promise.resolve();
  dialog.addEventListener('close', () => {
    if (!pending) return;
    const { resolve, prompt } = pending;
    pending = null;
    resolve(dialog.returnValue === 'accept' ? (prompt ? input.value : true) : (prompt ? null : false));
  });
  cancel.addEventListener('click', () => dialog.close('cancel'));

  function show(message, value, prompt) {
    const result = queue.then(() => new Promise((resolve) => {
      pending = { resolve, prompt };
      title.textContent = message;
      field.hidden = !prompt;
      input.value = value;
      accept.textContent = prompt ? 'Continuar' : 'Descartar alterações';
      dialog.returnValue = '';
      dialog.showModal();
      if (prompt) { input.focus(); input.select(); } else cancel.focus();
    }));
    queue = result.catch(() => {});
    return result;
  }

  window.editorDialogs = {
    confirm: (message) => show(message, '', false),
    prompt: (message, value = '') => show(message, value, true),
  };
  document.addEventListener('keydown', async (event) => {
    if (!window.editorDesktop) return;
    if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) {
      event.preventDefault();
      if (!window.editorCanLeave || await window.editorCanLeave()) location.reload();
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) event.preventDefault();
  });
  let closing = false;
  let leaving = false;
  window.editorRequestClose = async () => {
    if (closing) return;
    closing = true;
    try {
      if (!window.editorCanLeave || await window.editorCanLeave()) {
        window.editorAllowUnload = true;
        await window.desktopClose();
      }
    } finally { closing = false; }
  };
  document.addEventListener('click', async (event) => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented) return;
    const url = new URL(link.href, location.href);
    const external = url.origin !== location.origin || link.target === '_blank';
    if (external && window.editorDesktop) {
      event.preventDefault();
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        try { await window.desktopOpenExternal(url.href); }
        catch { window.dispatchEvent(new CustomEvent('editor-notice', { detail: 'Não foi possível abrir o navegador.' })); }
      }
      return;
    }
    if (url.origin === location.origin && (url.pathname !== location.pathname || url.search !== location.search)) {
      event.preventDefault();
      if (leaving) return;
      leaving = true;
      try {
        if (!window.editorCanLeave || await window.editorCanLeave()) {
          window.editorAllowUnload = true;
          location.assign(url.href);
        }
      } finally { leaving = false; }
    }
  });
})();
