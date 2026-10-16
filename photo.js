import { readExif } from './photo-exif.js';

const $ = (selector) => document.querySelector(selector);
const els = {
  file: $('#photo-file'), chooseImage: $('#photo-choose-image'), image: $('#photo-image'), placeholder: $('#photo-placeholder'),
  fileInfo: $('#photo-file-info'), exifInfo: $('#photo-exif-info'), map: $('#photo-map'),
  title: $('#photo-title'), date: $('#photo-date'), alt: $('#photo-alt'), caption: $('#photo-caption'),
  tags: $('#photo-tags'), includeLocation: $('#photo-include-location'), place: $('#photo-place'),
  folderPath: $('#photo-folder-path'), chooseFolder: $('#photo-choose-folder'), manualFolder: $('#photo-manual-folder'),
  save: $('#photo-save'), state: $('#photo-save-state'), result: $('#photo-result'), toast: $('#toast'),
};

let folder = null;
let selectedFile = null;
let gps = null;
let previewUrl = null;
let dirty = false;
let saving = false;
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
  els.save.disabled = !folder || !selectedFile;
}

function markDirty() {
  dirty = true;
  els.state.textContent = 'Alterações não salvas';
  els.state.classList.add('changed');
  els.result.textContent = '';
  els.save.disabled = !folder || !selectedFile;
}

async function chooseFolder() {
  try {
    updateFolder(await request('/api/photo/folder/pick', { method: 'POST' }));
  } catch (error) { notice(error.message, true); }
}

async function manualFolder() {
  const path = window.prompt('Caminho completo da pasta da galeria', folder || '');
  if (path === null) return;
  try {
    updateFolder(await request('/api/photo/folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: path }),
    }));
  } catch (error) { notice(error.message, true); }
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
  els.map.hidden = !gps;
  if (gps) els.map.href = `https://www.openstreetmap.org/?mlat=${gps.latitude}&mlon=${gps.longitude}#map=14/${gps.latitude}/${gps.longitude}`;

  const title = titleFromName(file.name);
  els.title.value = title;
  els.alt.value = title;
  els.date.value = metadata.date || new Date().toLocaleDateString('sv-SE');
  els.caption.value = '';
  els.tags.value = '';
  els.includeLocation.checked = false;
  els.includeLocation.disabled = !gps;
  els.place.value = '';
  els.place.disabled = true;
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
  if (saving || !dirty) return;
  if (!selectedFile) { notice('Escolha uma imagem.', true); return; }
  if (!folder) { notice('Escolha a pasta da galeria.', true); return; }
  const title = els.title.value.trim();
  const date = els.date.value;
  const alt = els.alt.value.trim();
  const caption = els.caption.value.trim();
  if (!title || !date || !alt || !caption) { notice('Preencha título, data, texto alternativo e legenda.', true); return; }
  if (els.includeLocation.checked && (!gps || !els.place.value.trim())) { notice('Informe o nome do lugar.', true); return; }

  saving = true;
  els.save.disabled = true;
  els.state.textContent = 'Preparando imagem';
  try {
    const image = await prepareImage(selectedFile);
    const form = new FormData();
    form.append('image', image, selectedFile.name);
    form.append('sourceName', selectedFile.name);
    form.append('title', title);
    form.append('date', date);
    form.append('alt', alt);
    form.append('caption', caption);
    form.append('tags', JSON.stringify([...new Set(els.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean))]));
    if (els.includeLocation.checked) form.append('location', JSON.stringify({ name: els.place.value.trim(), ...gps }));
    els.state.textContent = 'Salvando';
    const result = await request('/api/photo/import', { method: 'POST', body: form });
    dirty = false;
    els.state.textContent = 'Foto salva';
    els.state.classList.remove('changed');
    els.result.textContent = `Foto salva: ${result.imageName} e ${result.markdownName}.`;
    notice('Foto salva na galeria.');
  } catch (error) {
    els.save.disabled = false;
    els.state.textContent = 'Erro ao salvar';
    notice(error.message, true);
  } finally {
    saving = false;
  }
}

els.chooseImage.addEventListener('click', () => { els.file.value = ''; els.file.click(); });
els.file.addEventListener('change', async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  try { await loadImage(file); }
  catch (error) { notice(error.message, true); }
});
els.chooseFolder.addEventListener('click', chooseFolder);
els.manualFolder.addEventListener('click', manualFolder);
els.save.addEventListener('click', savePhoto);
els.includeLocation.addEventListener('change', () => { els.place.disabled = !els.includeLocation.checked; markDirty(); });
for (const input of [els.title, els.date, els.alt, els.caption, els.tags, els.place]) input.addEventListener('input', markDirty);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); els.chooseImage.click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); savePhoto(); }
});
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (!navigator.sendBeacon('/api/session/close', sessionId)) fetch('/api/session/close', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
});
window.addEventListener('pageshow', (event) => { if (event.persisted) fetch('/api/session/open', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {}); });

fetch('/api/session/open', { method: 'POST', body: sessionId, keepalive: true }).catch(() => {});
request('/api/photo/config').then(updateFolder).catch((error) => notice(error.message, true));
setInterval(() => fetch('/api/session/ping', { method: 'POST', body: sessionId }).catch(() => {}), 30_000);
