(() => {
  const sidebar = document.querySelector('#app-sidebar');
  if (!sidebar) return;
  const root = document.documentElement;
  const handle = document.createElement('div');
  handle.className = 'sidebar-resizer';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Largura da barra lateral');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-controls', sidebar.id);
  handle.setAttribute('aria-describedby', 'sidebar-resize-help');
  const help = document.createElement('span');
  help.id = 'sidebar-resize-help';
  help.className = 'visually-hidden';
  help.textContent = 'Arraste para ajustar. Use as setas para diminuir ou aumentar e Home para restaurar a largura padrão.';
  handle.title = 'Arraste para ajustar a largura. Clique duas vezes para restaurar.';
  sidebar.append(handle, help);

  let preferredWidth = Number.parseInt(root.style.getPropertyValue('--sidebar-width'), 10) || 288;
  let drag = null;
  let saveTimer;
  let pendingWidth = null;
  const maximum = () => Math.max(220, Math.min(520, window.innerWidth - 380));
  const clamp = (width) => Math.max(220, Math.min(maximum(), Math.round(width)));

  function updateHandle() {
    const width = clamp(preferredWidth);
    handle.setAttribute('aria-valuemin', '220');
    handle.setAttribute('aria-valuemax', String(maximum()));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
  }
  function setWidth(width) {
    preferredWidth = width;
    root.style.setProperty('--sidebar-width', `${width}px`);
    updateHandle();
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (pendingWidth === null) return;
    const width = pendingWidth;
    pendingWidth = null;
    fetch('/api/layout', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sidebarWidth: width }), keepalive: true,
    }).then((response) => { if (!response.ok) throw new Error(); }).catch(() => {
      window.dispatchEvent(new CustomEvent('editor-notice', { detail: 'Não foi possível salvar a largura da barra lateral. Tente ajustar novamente.' }));
    });
  }
  function saveWidth() {
    pendingWidth = preferredWidth;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 200);
  }
  function finishDrag(canceled = false) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    root.classList.remove('resizing-sidebar');
    if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    if (canceled) setWidth(previous.preferredWidth);
    else if (preferredWidth !== previous.preferredWidth) { saveWidth(); flushSave(); }
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag || window.innerWidth <= 600) return;
    event.preventDefault();
    handle.focus();
    drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width, preferredWidth };
    handle.setPointerCapture(event.pointerId);
    root.classList.add('resizing-sidebar');
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.id === event.pointerId) setWidth(clamp(drag.width + event.clientX - drag.x));
  });
  handle.addEventListener('pointerup', (event) => { if (drag?.id === event.pointerId) finishDrag(); });
  handle.addEventListener('pointercancel', () => finishDrag(true));
  handle.addEventListener('lostpointercapture', () => finishDrag(true));
  handle.addEventListener('dblclick', () => { setWidth(clamp(288)); saveWidth(); flushSave(); });
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finishDrag(true); return; }
    const step = event.shiftKey ? 40 : 10;
    let width;
    if (event.key === 'ArrowLeft') width = clamp(preferredWidth) - step;
    else if (event.key === 'ArrowRight') width = clamp(preferredWidth) + step;
    else if (event.key === 'Home') width = 288;
    else if (event.key === 'End') width = maximum();
    else return;
    event.preventDefault();
    setWidth(clamp(width));
    saveWidth();
  });
  handle.addEventListener('keyup', flushSave);
  handle.addEventListener('blur', flushSave);
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('resize', () => { finishDrag(true); updateHandle(); });
  updateHandle();
})();
