const $ = (selector) => document.querySelector(selector);
const els = {
  list: $('#post-list'), count: $('#post-count'), search: $('#search'),
  empty: $('#empty-state'), view: $('#editor-view'), title: $('#title'), description: $('#description'),
  date: $('#pub-date'), tags: $('#tags'), image: $('#hero-image'), hidden: $('#hidden'),
  visual: $('#visual-editor'), source: $('#markdown-editor'), toolbar: $('#toolbar'),
  imageButton: $('#insert-image'), imageDialog: $('#image-dialog'), imageForm: $('#image-form'),
  imageSource: $('#image-source'), imageAlt: $('#image-alt'), imageError: $('#image-error'),
  imageConfirm: $('#image-confirm'), imageCancel: $('#image-cancel'),
  visualMode: $('#visual-mode'), markdownMode: $('#markdown-mode'), save: $('#save-post'),
  state: $('#save-state'), crumb: $('#crumb-title'), type: $('#post-type'), file: $('#file-name'),
  viewPost: $('#view-post'), toast: $('#toast'), wordCount: $('#word-count'),
  folderPath: $('#folder-path'), chooseFolder: $('#choose-folder'), manualFolder: $('#manual-folder'),
  emptyTitle: $('#empty-title'), emptyText: $('#empty-text'), emptyNew: $('#empty-new'), emptyChoose: $('#empty-choose'),
};

let posts = [];
let current = null;
let dirty = false;
let bodyDirty = false;
let mode = 'visual';
let visualNeedsSync = false;
let sourceNeedsSync = false;
let lastBodyEditMode = 'visual';
let editVersion = 0;
let bodyEditVersion = 0;
let saving = false;
let toastTimer;
let folder = null;
let isProjectFolder = false;
let imageRange = null;
let markdownImageRange = null;
const sessionId = crypto.randomUUID();

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const escapeMd = (value) => value.replaceAll('\\', '\\\\').replaceAll('*', '\\*').replaceAll('_', '\\_').replaceAll('`', '\\`');
const decodeHtml = (value) => value.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const imagePreviewSource = (source) => /^https?:\/\//i.test(source) ? source : `/api/post-image?src=${encodeURIComponent(source)}`;
const markdownImage = (source, alt) => `![${alt.replaceAll('\\', '\\\\').replaceAll(']', '\\]')}](${source})`;

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  const code = [];
  html = html.replace(/`([^`]+)`/g, (_, content) => { code.push(`<code>${content}</code>`); return `@@CODE${code.length - 1}@@`; });
  html = html.replace(/!\[((?:\\.|[^\]])*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const original = decodeHtml(src);
    return `<img alt="${alt.replace(/\\([\\\]])/g, '$1')}" data-source="${src}" src="${escapeHtml(imagePreviewSource(original))}" />`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/_([^_]+)_/g, '<em>$1</em>');
  return html.replace(/@@CODE(\d+)@@/g, (_, n) => code[Number(n)]);
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const out = [];
  let fence = null;
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const fenced = line.match(/^```(.*)$/);
    if (fenced) {
      closeList();
      if (fence !== null) { out.push('</code></pre>'); fence = null; }
      else { fence = fenced[1]; out.push(`<pre><code data-language="${escapeHtml(fence)}">`); }
      continue;
    }
    if (fence !== null) { out.push(`${escapeHtml(line)}\n`); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); const n = heading[1].length; out.push(`<h${n}>${inlineMarkdown(heading[2])}</h${n}>`); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) { const next = bullet ? 'ul' : 'ol'; if (list !== next) { closeList(); out.push(`<${next}>`); list = next; } out.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`); continue; }
    closeList();
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { out.push(`<blockquote><p>${inlineMarkdown(quote[1])}</p></blockquote>`); continue; }
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (fence !== null) out.push('</code></pre>');
  return out.join('');
}

function inlineToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeMd(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  const inner = [...node.childNodes].map(inlineToMarkdown).join('');
  if (tag === 'strong' || tag === 'b') return `**${inner}**`;
  if (tag === 'em' || tag === 'i') return `*${inner}*`;
  if (tag === 'code') return `\`${node.textContent || ''}\``;
  if (tag === 'a') return `[${inner}](${node.getAttribute('href') || ''})`;
  if (tag === 'img') return markdownImage(node.getAttribute('data-source') || node.getAttribute('src') || '', node.getAttribute('alt') || '');
  if (tag === 'br') return '  \n';
  return inner;
}

function htmlToMarkdown(root) {
  const blocks = [];
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { const text = node.textContent?.trim(); if (text) blocks.push(escapeMd(text)); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) blocks.push(`${'#'.repeat(Number(tag[1]))} ${[...node.childNodes].map(inlineToMarkdown).join('')}`);
    else if (tag === 'pre') blocks.push(`\`\`\`${node.querySelector('code')?.dataset.language || ''}\n${(node.textContent || '').replace(/\n$/, '')}\n\`\`\``);
    else if (tag === 'hr') blocks.push('---');
    else if (tag === 'img') blocks.push(inlineToMarkdown(node));
    else if (tag === 'blockquote') blocks.push((node.textContent || '').split('\n').map((line) => `> ${line}`).join('\n'));
    else if (tag === 'ul' || tag === 'ol') blocks.push([...node.querySelectorAll(':scope > li')].map((li, i) => `${tag === 'ul' ? '-' : `${i + 1}.`} ${[...li.childNodes].map(inlineToMarkdown).join('')}`).join('\n'));
    else blocks.push([...node.childNodes].map(inlineToMarkdown).join(''));
  }
  return blocks.filter(Boolean).join('\n\n').trim();
}

function needsMarkdownMode(body) {
  return /^(?:\s{2,}[-*+]\s|\s*\|.*\|\s*$|\s*[-*+]\s+\[[ xX]\]|\[\^[^\]]+\]:|\s*:::\w|\s*<\/?[a-z][^>]*>)/im.test(body);
}

function notice(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 4000);
}

function markDirty(body = false) {
  if (!current) return;
  dirty = true;
  editVersion++;
  if (body) {
    bodyDirty = true;
    bodyEditVersion++;
    lastBodyEditMode = mode;
    visualNeedsSync = mode === 'visual';
    sourceNeedsSync = mode === 'markdown';
    if (mode === 'markdown') {
      els.visualMode.disabled = needsMarkdownMode(els.source.value);
      els.visualMode.title = els.visualMode.disabled ? 'Este post usa Markdown avançado. Edite o corpo no modo Markdown para preservar a formatação.' : '';
    }
    updateWordCount();
  }
  els.state.textContent = 'Alterações não salvas';
  els.state.classList.add('changed');
  if (!saving) els.save.disabled = false;
}

function updateWordCount() {
  const text = mode === 'visual' ? els.visual.textContent || '' : els.source.value;
  const count = text.match(/\p{L}[\p{L}\p{N}'’-]*/gu)?.length || 0;
  els.wordCount.textContent = `${count} ${count === 1 ? 'palavra' : 'palavras'}`;
}

function renderList() {
  const query = els.search.value.trim().toLocaleLowerCase('pt-BR');
  const visible = posts.filter((post) => `${post.title} ${post.tags.join(' ')}`.toLocaleLowerCase('pt-BR').includes(query));
  els.count.textContent = `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`;
  els.list.replaceChildren();
  for (const post of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `post-item${current?.id === post.id ? ' selected' : ''}`;
    const date = post.pubDate ? new Date(`${post.pubDate}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    button.innerHTML = `<strong>${escapeHtml(post.title)}</strong><span>${escapeHtml(date)}, ${post.hidden ? 'rascunho' : 'publicado'}</span>`;
    button.addEventListener('click', () => openPost(post.id));
    els.list.append(button);
  }
  if (!visible.length) els.list.innerHTML = '<p class="no-results">Nenhum post encontrado.</p>';
}

function updateFolder(config) {
  folder = config.folder || null;
  isProjectFolder = config.isProjectFolder === true;
  els.folderPath.textContent = folder || 'Nenhuma pasta selecionada';
  els.folderPath.title = folder || '';
  $('#new-post').disabled = !folder;
  els.emptyNew.hidden = !folder;
  els.emptyChoose.hidden = !!folder;
  els.emptyTitle.textContent = folder ? 'Seus posts' : 'Escolha a pasta dos posts';
  els.emptyText.textContent = folder ? 'Escolha um post na lista ou crie um novo.' : 'O editor vai usar os arquivos Markdown dessa pasta.';
}

function clearPost() {
  current = null;
  dirty = false;
  bodyDirty = false;
  visualNeedsSync = false;
  sourceNeedsSync = false;
  lastBodyEditMode = 'visual';
  els.view.hidden = true;
  els.empty.hidden = false;
  els.save.disabled = true;
  els.state.textContent = 'Pronto';
  els.state.classList.remove('changed');
  els.crumb.textContent = 'Selecione um post';
  renderList();
}

async function confirmLeave() {
  if (saving) { notice('Aguarde o salvamento terminar.'); return false; }
  return !dirty || await window.editorDialogs.confirm('Você tem alterações não salvas. Sair deste post?');
}
window.editorCanLeave = confirmLeave;
window.addEventListener('editor-notice', (event) => notice(event.detail, true));

function populate(post, preferredMode = 'visual') {
  current = post;
  dirty = false;
  bodyDirty = false;
  visualNeedsSync = false;
  sourceNeedsSync = false;
  lastBodyEditMode = 'visual';
  mode = needsMarkdownMode(post.body) ? 'markdown' : preferredMode;
  els.empty.hidden = true;
  els.view.hidden = false;
  els.title.value = post.title;
  els.description.value = post.description;
  els.date.value = post.pubDate;
  els.tags.value = post.tags.join(', ');
  els.image.value = post.heroImage;
  els.hidden.checked = post.hidden;
  els.visual.innerHTML = markdownToHtml(post.body);
  els.source.value = post.body;
  els.visual.hidden = mode !== 'visual';
  els.source.hidden = mode !== 'markdown';
  els.toolbar.hidden = mode !== 'visual';
  els.visualMode.disabled = mode === 'markdown';
  els.visualMode.title = els.visualMode.disabled ? 'Este post usa Markdown avançado. Edite o corpo no modo Markdown para preservar a formatação.' : '';
  els.visualMode.classList.toggle('active', mode === 'visual');
  els.markdownMode.classList.toggle('active', mode === 'markdown');
  els.save.disabled = true;
  els.state.textContent = 'Tudo salvo';
  els.state.classList.remove('changed');
  els.crumb.textContent = post.title || 'Novo post';
  els.type.textContent = post.hidden ? 'RASCUNHO' : 'PUBLICADO';
  els.file.textContent = post.id || 'Ainda não criado';
  els.viewPost.hidden = !post.id || post.hidden || !isProjectFolder;
  if (post.id) els.viewPost.href = `http://localhost:4321/blog/${encodeURIComponent(post.id.replace(/\.md$/, ''))}/`;
  updateWordCount();
  renderList();
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível completar a operação.');
  return data;
}

async function refreshList() {
  posts = await request('/api/posts');
  renderList();
}

async function applyFolder(config) {
  if (config.canceled) return;
  updateFolder(config);
  clearPost();
  await refreshList();
  notice('Pasta selecionada.');
}

async function chooseFolder() {
  if (!await confirmLeave()) return;
  try {
    if (window.editorDesktop) {
      const path = await window.desktopPickFolder();
      if (!path) return;
      await applyFolder(await request('/api/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: path }),
      }));
    } else await applyFolder(await request('/api/folder/pick', { method: 'POST' }));
  }
  catch (error) { notice(error.message, true); }
}

async function manualFolder() {
  if (!await confirmLeave()) return;
  const path = await window.editorDialogs.prompt('Caminho completo da pasta dos posts', folder || '');
  if (path === null) return;
  try {
    await applyFolder(await request('/api/folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: path }),
    }));
  } catch (error) { notice(error.message, true); }
}

async function openPost(id) {
  if (current?.id === id || !await confirmLeave()) return;
  try { populate(await request(`/api/posts/${encodeURIComponent(id)}`)); }
  catch (error) { notice(error.message, true); }
}

async function newPost() {
  if (!folder) { notice('Escolha a pasta dos posts primeiro.', true); return; }
  if (!await confirmLeave()) return;
  populate({ id: '', title: '', description: '', pubDate: new Date().toLocaleDateString('sv-SE'), tags: [], heroImage: '', hidden: true, body: '', revision: '' });
  els.title.focus();
}

function setMode(next) {
  if (next === mode) return;
  if (next === 'markdown') {
    if (visualNeedsSync) els.source.value = htmlToMarkdown(els.visual);
  } else {
    if (sourceNeedsSync) els.visual.innerHTML = markdownToHtml(els.source.value);
  }
  visualNeedsSync = false;
  sourceNeedsSync = false;
  mode = next;
  els.visual.hidden = next !== 'visual';
  els.source.hidden = next !== 'markdown';
  els.toolbar.hidden = next !== 'visual';
  els.visualMode.classList.toggle('active', next === 'visual');
  els.markdownMode.classList.toggle('active', next === 'markdown');
  updateWordCount();
}

async function savePost() {
  if (!current || saving || !dirty) return;
  const body = bodyDirty ? (lastBodyEditMode === 'visual' ? htmlToMarkdown(els.visual) : els.source.value) : current.body;
  const input = {
    id: current.id, revision: current.revision, title: els.title.value.trim(),
    description: els.description.value.trim(), pubDate: els.date.value,
    tags: [...new Set(els.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean))],
    heroImage: els.image.value.trim(), hidden: els.hidden.checked, body,
  };
  if (!input.title || !input.description || !input.pubDate) { notice('Preencha título, descrição e data.', true); return; }
  const submittedVersion = editVersion;
  const submittedBodyVersion = bodyEditVersion;
  const savedMode = mode;
  saving = true;
  els.save.disabled = true;
  els.state.textContent = 'Salvando…';
  try {
    const saved = await request(current.id ? `/api/posts/${encodeURIComponent(current.id)}` : '/api/posts', {
      method: current.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    current = saved;
    let listError = false;
    try { await refreshList(); } catch { listError = true; }
    if (editVersion === submittedVersion) {
      populate(saved, savedMode);
      notice(listError ? 'Post salvo, mas a lista não pôde ser atualizada.' : 'Post salvo.', listError);
    } else {
      if (bodyEditVersion === submittedBodyVersion) bodyDirty = false;
      els.file.textContent = saved.id;
      els.viewPost.hidden = saved.hidden || !isProjectFolder;
      els.viewPost.href = `http://localhost:4321/blog/${encodeURIComponent(saved.id.replace(/\.md$/, ''))}/`;
      els.state.textContent = 'Alterações não salvas';
      els.state.classList.add('changed');
      renderList();
      notice(listError ? 'Post salvo, mas a lista não pôde ser atualizada.' : 'Post salvo. Há alterações mais recentes para salvar.', listError);
    }
  } catch (error) {
    els.state.textContent = 'Erro ao salvar';
    notice(error.message, true);
  } finally {
    saving = false;
    els.save.disabled = !dirty;
  }
}

async function format(action) {
  els.visual.focus();
  if (action === 'link') {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const url = await window.editorDialogs.prompt('URL do link');
    if (!url) return;
    els.visual.focus();
    if (range) { selection.removeAllRanges(); selection.addRange(range); }
    document.execCommand('createLink', false, url);
  } else if (action === 'h2' || action === 'h3') document.execCommand('formatBlock', false, action);
  else if (action === 'quote') document.execCommand('formatBlock', false, 'blockquote');
  else if (action === 'ul') document.execCommand('insertUnorderedList');
  else document.execCommand(action);
  markDirty(true);
}

function openImageDialog() {
  if (!current) return;
  imageRange = null;
  markdownImageRange = null;
  let selectedText = '';
  if (mode === 'visual') {
    const selection = window.getSelection();
    if (selection?.rangeCount && els.visual.contains(selection.anchorNode)) {
      imageRange = selection.getRangeAt(0).cloneRange();
      selectedText = selection.toString();
    }
  } else {
    markdownImageRange = [els.source.selectionStart, els.source.selectionEnd];
    selectedText = els.source.value.slice(...markdownImageRange);
  }
  els.imageForm.reset();
  els.imageAlt.value = selectedText.replace(/\s+/g, ' ').trim().slice(0, 200);
  els.imageError.hidden = true;
  els.imageDialog.showModal();
  els.imageSource.focus();
}

function validateImageSource(source) {
  if (!source || source.length > 2048 || /[\s<>()"'\\]/.test(source)) {
    throw new Error('Informe uma URL ou um caminho sem espaços, parênteses ou barras invertidas.');
  }
  if (/^https?:\/\//i.test(source)) {
    try { new URL(source); } catch { throw new Error('Informe uma URL válida.'); }
    return false;
  }
  if (source.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(source) || /[?#]/.test(source)) {
    throw new Error('Use uma rota local ou uma URL http(s).');
  }
  return true;
}

function insertImage(source, alt) {
  if (mode === 'markdown') {
    const [start, end] = markdownImageRange || [els.source.selectionStart, els.source.selectionEnd];
    els.source.setRangeText(markdownImage(source, alt), start, end, 'end');
  } else {
    const image = document.createElement('img');
    image.alt = alt;
    image.dataset.source = source;
    image.src = imagePreviewSource(source);
    const range = imageRange && els.visual.contains(imageRange.commonAncestorContainer) ? imageRange : document.createRange();
    if (range !== imageRange) range.selectNodeContents(els.visual);
    if (range !== imageRange) range.collapse(false);
    range.deleteContents();
    range.insertNode(image);
    range.setStartAfter(image);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  markDirty(true);
}

async function submitImage(event) {
  event.preventDefault();
  const source = els.imageSource.value.trim();
  const alt = els.imageAlt.value.trim();
  els.imageError.hidden = true;
  try {
    const local = validateImageSource(source);
    if (!alt) throw new Error('Descreva a imagem no texto alternativo.');
    els.imageConfirm.disabled = true;
    if (local) {
      const response = await fetch(`/api/post-image?src=${encodeURIComponent(source)}`, { method: 'HEAD' });
      if (!response.ok) throw new Error('Imagem local não encontrada. Confira o caminho e a pasta do blog.');
    }
    insertImage(source, alt);
    els.imageDialog.close();
    (mode === 'visual' ? els.visual : els.source).focus();
  } catch (error) {
    els.imageError.textContent = error.message;
    els.imageError.hidden = false;
  } finally {
    els.imageConfirm.disabled = false;
  }
}

const inspectorToggle = $('#toggle-inspector');
const inspector = $('#post-inspector');
function setInspectorCollapsed(collapsed) {
  inspector.hidden = collapsed;
  $('.editor-grid').classList.toggle('inspector-collapsed', collapsed);
  inspectorToggle.setAttribute('aria-expanded', String(!collapsed));
  inspectorToggle.textContent = collapsed ? 'Mostrar dados do post' : 'Ocultar dados do post';
}
try {
  setInspectorCollapsed(localStorage.getItem('mth-editor-inspector-collapsed') === 'true');
} catch { /* O painel continua disponível quando o armazenamento está bloqueado. */ }
inspectorToggle.addEventListener('click', () => {
  setInspectorCollapsed(!inspector.hidden);
  try { localStorage.setItem('mth-editor-inspector-collapsed', String(inspector.hidden)); } catch { /* Preferência válida nesta sessão. */ }
});

$('#new-post').addEventListener('click', newPost);
$('#empty-new').addEventListener('click', newPost);
els.emptyChoose.addEventListener('click', chooseFolder);
els.chooseFolder.addEventListener('click', chooseFolder);
els.manualFolder.addEventListener('click', manualFolder);
els.search.addEventListener('input', renderList);
els.save.addEventListener('click', savePost);
els.visualMode.addEventListener('click', () => setMode('visual'));
els.markdownMode.addEventListener('click', () => setMode('markdown'));
els.toolbar.addEventListener('mousedown', (event) => { if (event.target.closest('button')) event.preventDefault(); });
els.toolbar.addEventListener('click', (event) => { const button = event.target.closest('button[data-action]'); if (button) format(button.dataset.action); });
els.imageButton.addEventListener('mousedown', (event) => { if (mode === 'visual') event.preventDefault(); });
els.imageButton.addEventListener('click', openImageDialog);
els.imageForm.addEventListener('submit', submitImage);
els.imageCancel.addEventListener('click', () => els.imageDialog.close());
els.imageSource.addEventListener('input', () => { els.imageError.hidden = true; });
els.imageAlt.addEventListener('input', () => { els.imageError.hidden = true; });
els.imageDialog.addEventListener('close', () => { imageRange = null; markdownImageRange = null; });
els.visual.addEventListener('input', () => markDirty(true));
els.source.addEventListener('input', () => markDirty(true));
for (const input of [els.title, els.description, els.date, els.tags, els.image, els.hidden]) {
  input.addEventListener('input', () => { markDirty(); els.crumb.textContent = els.title.value || 'Novo post'; els.type.textContent = els.hidden.checked ? 'RASCUNHO' : 'PUBLICADO'; });
}
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); savePost(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    els.search.focus();
    els.search.select();
  }
});
window.addEventListener('beforeunload', (event) => { if (!window.editorDesktop && !window.editorAllowUnload && dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  if (!navigator.sendBeacon('/api/session/close', sessionId)) {
    fetch('/api/session/close', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) fetch('/api/session/open', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
});

fetch('/api/session/open', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
request('/api/config').then(async (config) => {
  updateFolder(config);
  await refreshList();
}).catch((error) => notice(`Não foi possível carregar os posts: ${error.message}`, true));
setInterval(() => fetch('/api/session/ping', { method: 'POST', body: sessionId }).catch(() => {}), 30_000);
