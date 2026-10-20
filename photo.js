import { readExif } from './photo-exif.js';

const $ = (selector) => document.querySelector(selector);
const els = {
  file: $('#photo-file'), chooseImage: $('#photo-choose-image'), image: $('#photo-image'), placeholder: $('#photo-placeholder'),
  fileInfo: $('#photo-file-info'), exifInfo: $('#photo-exif-info'), map: $('#photo-map'),
  title: $('#photo-title'), date: $('#photo-date'), alt: $('#photo-alt'), caption: $('#photo-caption'),
  tags: $('#photo-tags'), includeLocation: $('#photo-include-location'), place: $('#photo-place'),
  locationFields: $('#photo-location-fields'), locationHint: $('#photo-location-hint'),
  latitude: $('#photo-latitude'), longitude: $('#photo-longitude'),
  folderPath: $('#photo-folder-path'), chooseFolder: $('#photo-choose-folder'), manualFolder: $('#photo-manual-folder'),
  save: $('#photo-save'), state: $('#photo-save-state'), result: $('#photo-result'), toast: $('#toast'),
  list: $('#photo-list'), count: $('#photo-count'), search: $('#photo-search'), warning: $('#photo-list-warning'),
  newPhoto: $('#photo-new'), heading: $('#photo-heading'), headingHint: $('#photo-heading-hint'), crumb: $('#photo-crumb'),
  locationLabel: $('#photo-location-label'), privacyHint: $('#photo-privacy-hint'),
};

let folder = null;
let selectedFile = null;
let gps = null;
let previewUrl = null;
let dirty = false;
let saving = false;
let loading = false;
let current = null;
let photos = [];
let toastTimer;
const sessionId = crypto.randomUUID();

function notice(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 4000);
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível completar a operação.');
  return data;
}

function updateFolder(config) {
  if (config.canceled) return;
  folder = config.folder || null;
  els.folderPath.textContent = folder || 'Nenhuma pasta selecionada';
  els.folderPath.title = folder || '';
  updateSaveButton();
}

function updateSaveButton() {
  els.save.disabled = saving || loading || !dirty || !folder || (!selectedFile && !current);
}

function setBusy() {
  const busy = saving || loading;
  for (const input of document.querySelectorAll('.photo-fields input, .photo-fields textarea')) input.disabled = busy;
  els.includeLocation.disabled = busy || (!selectedFile && !current);
  els.locationFields.disabled = busy || !els.includeLocation.checked;
  for (const button of [els.newPhoto, els.chooseImage, els.chooseFolder, els.manualFolder]) button.disabled = busy;
  for (const button of els.list.querySelectorAll('button')) button.disabled = busy;
  updateSaveButton();
}

function markDirty() {
  dirty = true;
  els.state.textContent = 'Alterações não salvas';
  els.state.classList.add('changed');
  els.result.textContent = '';
  updateSaveButton();
}

async function confirmLeave() {
  if (saving || loading) { notice('Aguarde a operação terminar.'); return false; }
  return !dirty || await window.editorDialogs.confirm('Você tem alterações não salvas. Sair desta foto?');
}
window.editorCanLeave = confirmLeave;
window.addEventListener('editor-notice', (event) => notice(event.detail, true));

function renderList() {
  const query = els.search.value.trim().toLocaleLowerCase('pt-BR');
  const visible = photos.filter((photo) => `${photo.title} ${photo.alt} ${photo.id} ${photo.tags.join(' ')} ${photo.location?.name || ''}`.toLocaleLowerCase('pt-BR').includes(query));
  els.count.textContent = `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`;
  els.list.replaceChildren();
  for (const photo of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `post-item photo-item${current?.id === photo.id ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(current?.id === photo.id));
    button.disabled = saving || loading;
    const image = document.createElement('img');
    image.src = `/api/photos/${encodeURIComponent(photo.id)}/thumbnail`;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 48;
    image.height = 56;
    image.addEventListener('error', () => { image.hidden = true; });
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = photo.title || photo.alt || photo.id;
    const detail = document.createElement('small');
    detail.textContent = [photo.date, photo.location?.name].filter(Boolean).join(' · ');
    copy.append(title, detail);
    button.append(image, copy);
    button.addEventListener('click', () => openPhoto(photo.id));
    els.list.append(button);
  }
  if (!visible.length) {
    const message = document.createElement('p');
    message.className = 'no-results';
    message.textContent = !folder ? 'Escolha a pasta src/content/img do blog.' : photos.length ? 'Nenhuma foto encontrada para esta busca.' : 'Nenhuma foto nesta pasta. Importe uma nova foto.';
    els.list.append(message);
  }
}

async function refreshList() {
  const result = await request('/api/photos');
  photos = result.photos;
  els.warning.hidden = !result.errors.length;
  els.warning.textContent = result.errors.length ? `${result.errors.length} arquivo(s) não puderam ser lidos.` : '';
  els.warning.title = result.errors.map((item) => `${item.id}: ${item.error}`).join('\n');
  renderList();
}

function clearPhoto() {
  current = null;
  selectedFile = null;
  gps = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  dirty = false;
  for (const input of [els.title, els.alt, els.caption, els.tags, els.place, els.latitude, els.longitude]) input.value = '';
  els.date.value = new Date().toLocaleDateString('sv-SE');
  els.image.removeAttribute('src');
  els.image.hidden = true;
  els.placeholder.hidden = false;
  els.placeholder.textContent = 'Nenhuma imagem escolhida';
  els.fileInfo.textContent = 'Nenhum arquivo';
  els.exifInfo.textContent = 'Os dados da câmera aparecerão aqui.';
  els.includeLocation.checked = false;
  els.locationFields.hidden = true;
  els.locationHint.textContent = 'Escolha uma imagem para adicionar a localização.';
  els.locationLabel.textContent = 'Publicar localização exata';
  els.privacyHint.textContent = 'A cópia publicada não guarda dados da câmera. A localização só aparece no post se você marcar a opção acima.';
  els.chooseImage.hidden = false;
  els.heading.textContent = 'Nova foto';
  els.crumb.textContent = 'Nova foto';
  els.headingHint.textContent = 'Escolha a imagem e preencha os dados.';
  els.result.textContent = '';
  els.state.textContent = 'Pronto';
  els.state.classList.remove('changed');
  updateMap();
  renderList();
  setBusy();
}

function populate(photo) {
  clearPhoto();
  current = photo;
  els.title.value = photo.title;
  els.date.value = photo.date;
  els.alt.value = photo.alt;
  els.caption.value = photo.caption;
  els.tags.value = photo.tags.join(', ');
  els.place.value = photo.location?.name || '';
  els.latitude.value = photo.location?.latitude ?? '';
  els.longitude.value = photo.location?.longitude ?? '';
  els.includeLocation.checked = !!photo.location;
  els.locationFields.hidden = !photo.location;
  els.locationLabel.textContent = 'Publicar localização';
  els.locationHint.textContent = 'Edite o lugar e as coordenadas. Para publicar apenas o nome, deixe as duas coordenadas vazias.';
  els.privacyHint.textContent = 'Desmarque a opção acima para remover a localização do post. Ao salvar, o arquivo original da imagem é preservado.';
  els.chooseImage.hidden = true;
  els.heading.textContent = 'Editar foto';
  els.headingHint.textContent = 'Altere os dados da foto e salve no mesmo post.';
  els.crumb.textContent = photo.title || photo.alt || photo.id;
  els.fileInfo.textContent = `${photo.id} · ${photo.image}`;
  els.exifInfo.textContent = 'Dados carregados do post da foto.';
  els.image.src = `/api/photos/${encodeURIComponent(photo.id)}/image`;
  els.image.hidden = false;
  els.placeholder.hidden = true;
  els.state.textContent = 'Tudo salvo';
  updateMap();
  renderList();
  setBusy();
}

async function openPhoto(id) {
  if (!await confirmLeave()) return;
  loading = true;
  setBusy();
  try { populate(await request(`/api/photos/${encodeURIComponent(id)}`)); }
  catch (error) { notice(error.message, true); }
  finally { loading = false; setBusy(); }
}

async function applyFolder(config) {
  if (config.canceled) return;
  updateFolder(config);
  photos = [];
  els.warning.hidden = true;
  clearPhoto();
  await refreshList();
}

async function chooseFolder() {
  if (!await confirmLeave()) return;
  loading = true;
  setBusy();
  try {
    if (window.editorDesktop) {
      const path = await window.desktopPickFolder();
      if (!path) return;
      await applyFolder(await request('/api/photo/folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: path }),
      }));
    } else await applyFolder(await request('/api/photo/folder/pick', { method: 'POST' }));
  } catch (error) { notice(error.message, true); }
  finally { loading = false; setBusy(); }
}

async function manualFolder() {
  if (!await confirmLeave()) return;
  const path = await window.editorDialogs.prompt('Caminho completo da pasta da galeria', folder || '');
  if (path === null) return;
  loading = true;
  setBusy();
  try {
    await applyFolder(await request('/api/photo/folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: path }),
    }));
  } catch (error) { notice(error.message, true); }
  finally { loading = false; setBusy(); }
}

function imageFormat(buffer, name) {
  const bytes = new Uint8Array(buffer);
  const extension = name.split('.').pop()?.toLowerCase();
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (jpeg && ['jpg', 'jpeg'].includes(extension)) return 'image/jpeg';
  if (png && extension === 'png') return 'image/png';
  if (webp && extension === 'webp') return 'image/webp';
  throw new Error('Use uma imagem JPEG, PNG ou WebP com a extensão correta.');
}

function titleFromName(name) {
  const words = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toLocaleUpperCase('pt-BR') + words.slice(1) : '';
}

function readCoordinates() {
  const values = [els.latitude, els.longitude].map((input) => input.value.trim().replace(',', '.'));
  if (values.some((value) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) return null;
  const [latitude, longitude] = values.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function updateMap() {
  const coordinates = els.includeLocation.checked ? readCoordinates() : gps;
  els.map.hidden = !coordinates;
  if (coordinates) {
    const { latitude, longitude } = coordinates;
    els.map.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=14/${latitude}/${longitude}`;
  } else {
    els.map.removeAttribute('href');
  }
}

async function loadImage(file) {
  if (file.size > 80_000_000) throw new Error('Escolha uma imagem de até 80 MB.');
  const buffer = await file.arrayBuffer();
  imageFormat(buffer, file.name);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const metadata = readExif(buffer);

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  selectedFile = file;
  gps = metadata.gps;
  els.image.src = previewUrl;
  els.image.hidden = false;
  els.placeholder.hidden = true;
  els.fileInfo.textContent = `${file.name}, ${size.width} por ${size.height} pixels`;
  const gpsText = gps ? `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : 'não encontrado';
  els.exifInfo.textContent = `Data da câmera: ${metadata.date || 'não encontrada'}. GPS: ${gpsText}.`;

  const title = titleFromName(file.name);
  els.title.value = title;
  els.alt.value = title;
  els.date.value = metadata.date || new Date().toLocaleDateString('sv-SE');
  els.caption.value = '';
  els.tags.value = '';
  els.includeLocation.checked = false;
  els.includeLocation.disabled = false;
  els.locationFields.hidden = true;
  els.locationFields.disabled = true;
  els.locationHint.textContent = gps
    ? 'Coordenadas encontradas na foto. Você pode conferi-las e ajustá-las antes de publicar.'
    : 'Esta foto não tem GPS. Marque a opção acima para informar a localização manualmente.';
  els.place.value = '';
  els.latitude.value = gps ? String(gps.latitude) : '';
  els.longitude.value = gps ? String(gps.longitude) : '';
  updateMap();
  markDirty();
}

async function prepareImage(file) {
  const mime = imageFormat(await file.slice(0, 16).arrayBuffer(), file.name);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (bitmap.width * bitmap.height > 100_000_000) { bitmap.close(); throw new Error('A imagem é grande demais para processar.'); }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) { bitmap.close(); throw new Error('Não foi possível processar a imagem.'); }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || blob.type !== mime) throw new Error('O navegador não conseguiu salvar esse formato de imagem.');
  return blob;
}

async function savePhoto() {
  if (saving || loading || !dirty) return;
  if (!selectedFile && !current) { notice('Escolha uma imagem.', true); return; }
  if (!folder) { notice('Escolha a pasta da galeria.', true); return; }
  const title = els.title.value.trim();
  const date = els.date.value;
  const alt = els.alt.value.trim();
  const caption = els.caption.value.trim();
  if ((!current && !title) || !date || !alt || !caption) { notice('Preencha título, data, texto alternativo e legenda.', true); return; }
  let location = null;
  if (els.includeLocation.checked) {
    const name = els.place.value.trim();
    if (!name) { notice('Informe o nome do lugar.', true); els.place.focus(); return; }
    const coordinates = readCoordinates();
    const nameOnly = current && !els.latitude.value.trim() && !els.longitude.value.trim();
    if (!coordinates && !nameOnly) { notice('Informe latitude entre -90 e 90 e longitude entre -180 e 180.', true); return; }
    location = { name, ...coordinates };
  }

  saving = true;
  setBusy();
  els.state.textContent = current ? 'Salvando' : 'Preparando imagem';
  try {
    const tags = [...new Set(els.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean))];
    let saved;
    if (current) {
      saved = await request(`/api/photos/${encodeURIComponent(current.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, date, alt, caption, tags, location, revision: current.revision }),
      });
    } else {
      const image = await prepareImage(selectedFile);
      const form = new FormData();
      form.append('image', image, selectedFile.name);
      form.append('sourceName', selectedFile.name);
      for (const [key, value] of Object.entries({ title, date, alt, caption })) form.append(key, value);
      form.append('tags', JSON.stringify(tags));
      if (location) form.append('location', JSON.stringify(location));
      els.state.textContent = 'Salvando';
      const result = await request('/api/photo/import', { method: 'POST', body: form });
      saved = result.photo;
    }
    populate(saved);
    els.state.textContent = 'Foto salva';
    els.result.textContent = `Dados salvos em ${saved.id}.`;
    notice('Foto salva na galeria.');
    try { await refreshList(); }
    catch (error) { notice(`Foto salva. Não foi possível atualizar a lista: ${error.message}`, true); }
  } catch (error) {
    els.state.textContent = 'Erro ao salvar';
    notice(error.message, true);
  } finally {
    saving = false;
    setBusy();
  }
}

els.newPhoto.addEventListener('click', async () => { if (await confirmLeave()) { clearPhoto(); els.chooseImage.focus(); } });
els.search.addEventListener('input', renderList);
els.image.addEventListener('load', () => {
  els.image.hidden = false;
  els.placeholder.hidden = true;
});
els.image.addEventListener('error', () => {
  if (!current) return;
  els.image.hidden = true;
  els.placeholder.hidden = false;
  els.placeholder.textContent = 'Imagem indisponível. Você ainda pode editar os dados do post.';
});
els.chooseImage.addEventListener('click', () => { els.file.value = ''; els.file.click(); });
els.file.addEventListener('change', async () => {
  const file = els.file.files?.[0];
  if (!file || !await confirmLeave()) return;
  loading = true;
  setBusy();
  try { await loadImage(file); }
  catch (error) { notice(error.message, true); }
  finally { loading = false; setBusy(); }
});
els.chooseFolder.addEventListener('click', chooseFolder);
els.manualFolder.addEventListener('click', manualFolder);
els.save.addEventListener('click', savePhoto);
els.includeLocation.addEventListener('change', () => {
  els.locationFields.hidden = !els.includeLocation.checked;
  els.locationFields.disabled = !els.includeLocation.checked;
  updateMap();
  markDirty();
});
for (const input of [els.latitude, els.longitude]) input.addEventListener('input', () => { updateMap(); markDirty(); });
for (const input of [els.title, els.date, els.alt, els.caption, els.tags, els.place]) input.addEventListener('input', markDirty);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); if (!current) els.chooseImage.click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); savePhoto(); }
});
window.addEventListener('beforeunload', (event) => { if (!window.editorDesktop && !window.editorAllowUnload && dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (!navigator.sendBeacon('/api/session/close', sessionId)) fetch('/api/session/close', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
});
window.addEventListener('pageshow', (event) => { if (event.persisted) fetch('/api/session/open', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {}); });

fetch('/api/session/open', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
loading = true;
clearPhoto();
request('/api/photo/config').then(applyFolder).catch((error) => notice(error.message, true)).finally(() => { loading = false; setBusy(); });
setInterval(() => fetch('/api/session/ping', { method: 'POST', body: sessionId }).catch(() => {}), 30_000);
