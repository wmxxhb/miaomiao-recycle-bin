import { CATEGORIES, createActions, matchesFilters } from './shared.js';
import { PetViewer } from './viewer.js';
import { EYES } from './eyes.js';
import { glassyCatalog, DEFAULT_GLASSY } from './glassy.js';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
let catalog, actions, current, viewer;
let selectionToken = 0, loadingFormId, loadPromise, appearanceToken = 0;
let filters = { query: '', forms: [], categories: [], behavior: 'all', duration: 'all' };

async function request(url) {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本地素材暂时无法读取。');
  return result;
}
function checkbox(label, value, checked, onChange, count) {
  const wrapper = el('label'), input = document.createElement('input');
  input.type = 'checkbox'; input.value = value; input.checked = checked;
  input.addEventListener('change', onChange); wrapper.append(input, el('span', label));
  if (count !== undefined) wrapper.append(el('small', String(count), 'form-count'));
  return wrapper;
}
function filterGroup(target, field, values) {
  $(target).replaceChildren(...values.map(({ value, label, count }) => checkbox(label, value, filters[field].includes(value), event => {
    filters[field] = event.target.checked ? [...filters[field], value] : filters[field].filter(v => v !== value);
    renderList();
  }, count)));
}
function renderFilters() {
  filterGroup('formFilters', 'forms', catalog.forms.map(f => ({ value: f.id, label: f.name, count: f.clips.length })));
  filterGroup('categoryFilters', 'categories', CATEGORIES.map(c => ({ value: c, label: c })));
  $('search').value = filters.query; $('durationFilter').value = filters.duration;
  document.querySelector(`input[name="behavior"][value="${filters.behavior}"]`).checked = true;
}
function resetFilters() {
  filters = { query: '', forms: [], categories: [], behavior: 'all', duration: 'all' };
  renderFilters(); renderList();
}
function renderList() {
  const items = actions.filter(a => matchesFilters(a, filters));
  if ($('sort').value === 'short') items.sort((a, b) => a.durationSeconds - b.durationSeconds);
  if ($('sort').value === 'long') items.sort((a, b) => b.durationSeconds - a.durationSeconds);
  if ($('sort').value === 'name') items.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  $('resultCount').textContent = items.length; $('emptyState').hidden = Boolean(items.length);
  const multipleForms = new Set(items.map(a => a.formId)).size > 1;
  const fragment = document.createDocumentFragment();
  for (const action of items) {
    const row = el('div', undefined, 'action-row'); row.setAttribute('role', 'listitem');
    const button = el('button', undefined, 'select-action'); button.type = 'button'; button.dataset.key = action.key;
    button.setAttribute('aria-label', `预览 ${action.label} · ${action.formName}`);
    button.setAttribute('aria-pressed', String(current?.key === action.key));
    const copy = el('span', undefined, 'action-copy');
    copy.append(el('span', action.label, 'action-name'), el('span', action.id, 'action-id'));
    if (multipleForms) copy.append(el('span', action.formName, 'action-form'));
    button.append(copy, el('span', `${action.durationSeconds.toFixed(2)}s`, 'action-time'));
    button.addEventListener('click', () => void selectAction(action));
    row.append(button); fragment.append(row);
  }
  $('actionGrid').replaceChildren(fragment);
  if (items.length && !items.some(a => a.key === current?.key)) void selectAction(items.find(a => a.id === 'Idle') || items[0]);
}
function renderCurrent() {
  $('currentName').textContent = current.label; $('currentClip').textContent = current.id;
  $('formHeading').textContent = current.formName.replace('(', ' · ').replace(')', '');
  const form = catalog.forms.find(f => f.id === current.formId);
  $('formWarning').hidden = !form.warnings.length;
  document.querySelectorAll('.select-action').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === current.key)));
}
function stageStatus(text, busy = false) {
  $('renderState').textContent = text; $('renderState').hidden = !text;
  $('stage').setAttribute('aria-busy', String(busy));
}
async function selectAction(action) {
  const token = ++selectionToken;
  current = action; renderCurrent();
  updateTransport(0, action.durationSeconds, false); $('fallbackPoster').hidden = true;
  $('stageMessage').hidden = Boolean(viewer);
  if (!viewer) {
    if (action.previewUrl) { $('fallbackPoster').src = action.previewUrl; $('fallbackPoster').hidden = false; }
    return;
  }
  try {
    if (viewer.form?.id !== action.formId || loadingFormId) {
      stageStatus('正在加载模型…', true);
      const form = catalog.forms.find(f => f.id === action.formId);
      if (loadingFormId !== form.id) { loadingFormId = form.id; loadPromise = viewer.load(form); }
      await loadPromise;
      if (token !== selectionToken) return;
      loadingFormId = null;
    }
    if (token !== selectionToken) return;
    viewer.setClip(action); stageStatus(''); $('canvasMount').dataset.loaded = action.key;
  } catch (error) {
    if (token !== selectionToken) return;
    loadingFormId = null; stageStatus('预览加载失败');
    $('stageMessage').hidden = false; $('stageMessage').textContent = `无法播放：${error.message}。请刷新重试。`;
    if (action.previewUrl) { $('fallbackPoster').src = action.previewUrl; $('fallbackPoster').hidden = false; }
  }
}
function renderGlassyControls(selection = viewer?.glassy || DEFAULT_GLASSY) {
  $('glassyMode').value = selection.mode;
  $('glassyColor').value = selection.colorId; $('glassyParticle').value = selection.particleId;
  $('glassyCustom').hidden = selection.mode !== 'normal';
  const color = catalog.glassy.colors.find(c => c.id === Number(selection.colorId));
  if(!color)return;
  $('glassySwatch').style.setProperty('--color1', color.ui_color_1);
  $('glassySwatch').style.setProperty('--color2', color.ui_color_2);
}
async function changeGlassy() {
  if (!viewer) return;
  const token = ++appearanceToken;
  const selection = { mode: $('glassyMode').value, colorId: Number($('glassyColor').value), particleId: Number($('glassyParticle').value) };
  renderGlassyControls(selection); $('glassyHint').textContent = '正在加载炫彩…';
  try {
    await viewer.setGlassy(selection);
    if (token === appearanceToken) $('glassyHint').textContent = '炫彩为简化材质预览。';
  } catch (error) {
    if (token !== appearanceToken) return;
    renderGlassyControls(); $('glassyHint').textContent = `加载失败：${error.message}。可重新选择。`;
  }
}
function setTab(active) {
  for (const name of ['filter', 'appearance']) {
    const selected = name === active;
    $(name + 'Tab').setAttribute('aria-selected', String(selected));
    $(name + 'Tab').tabIndex = selected ? 0 : -1;
    $(name + 'Panel').hidden = !selected;
  }
}
function wireEvents() {
  for (const name of ['filter', 'appearance']) {
    $(name + 'Tab').addEventListener('click', () => setTab(name));
    $(name + 'Tab').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'filter' : event.key === 'End' ? 'appearance' : name === 'filter' ? 'appearance' : 'filter';
      setTab(next); $(next + 'Tab').focus();
    });
  }
  const option = (value, text) => { const node = el('option', text); node.value = value; return node; };
  $('eyeSelect').replaceChildren(...[...new Set(EYES.map(e => e.group))].map(name => {
    const group = document.createElement('optgroup'); group.label = name;
    group.append(...EYES.filter(e => e.group === name).map(e => option(e.id, e.label))); return group;
  }));
  $('eyeSelect').disabled = !viewer; $('eyeSelect').addEventListener('change', event => viewer?.setEye(event.target.value));
  const hidden = [...catalog.glassy.hidden].sort((a, b) => (a.id === 1000 ? -1 : b.id === 1000 ? 1 : a.id - b.id));
  $('glassyMode').replaceChildren(option('none', '无炫彩'), option('normal', '常规炫彩'), ...hidden.map(h => option(`hidden:${h.id}`, h.name)));
  $('glassyColor').replaceChildren(...catalog.glassy.colors.map(c => option(c.id, `${c.id} · ${c.name}`)));
  $('glassyParticle').replaceChildren(...catalog.glassy.particles.map(p => option(p.id, `${p.id} · ${p.name}`)));
  for (const id of ['glassyMode', 'glassyColor', 'glassyParticle']) {
    $(id).disabled = !viewer; $(id).addEventListener('change', () => void changeGlassy());
  }
  renderGlassyControls();
  $('search').addEventListener('input', event => { filters.query = event.target.value; renderList(); });
  document.querySelectorAll('input[name="behavior"]').forEach(input => input.addEventListener('change', event => { filters.behavior = event.target.value; renderList(); }));
  $('durationFilter').addEventListener('change', event => { filters.duration = event.target.value; renderList(); });
  $('sort').addEventListener('change', renderList);
  $('resetFilters').addEventListener('click', resetFilters); $('clearEmpty').addEventListener('click', resetFilters);
  $('playPause').addEventListener('click', () => {
    if (!viewer?.action) return;
    if (viewer.time >= viewer.duration && !viewer.playing) viewer.sample(0);
    viewer.playing = !viewer.playing; updateTransport(viewer.time, viewer.duration, viewer.playing);
  });
  for (const [id, direction] of [['previousFrame', -1], ['nextFrame', 1]]) $(id).addEventListener('click', () => {
    if (!viewer?.action) return;
    viewer.playing = false; viewer.sample(viewer.time + direction / 30);
  });
  $('timeline').addEventListener('input', event => { if (viewer?.action) { viewer.playing = false; viewer.sample(Number(event.target.value)); } });
  $('speed').addEventListener('change', event => { if (viewer) viewer.speed = Number(event.target.value); });
  $('loop').addEventListener('change', event => { if (viewer) viewer.loop = event.target.checked; });
  $('inPlace').addEventListener('change', event => { if (viewer?.currentClip) { viewer.inPlace = event.target.checked; viewer.setClip(current); } });
  $('autoEyes').addEventListener('change', event => { if (viewer) { viewer.autoEyes = event.target.checked; viewer.sample(viewer.time); } });
  $('showOutline').addEventListener('change', event => { if (viewer) { viewer.outline = event.target.checked; viewer.sample(viewer.time); } });
  $('resetCamera').addEventListener('click', () => viewer?.fitCamera()); $('frontCamera').addEventListener('click', () => viewer?.view()); $('sideCamera').addEventListener('click', () => viewer?.view(true));
  document.querySelectorAll('[data-bg]').forEach(button => button.addEventListener('click', () => {
    $('stage').dataset.background = button.dataset.bg;
    document.querySelectorAll('[data-bg]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  document.addEventListener('keydown', event => {
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); $('playPause').click(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); $('nextFrame').click(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); $('previousFrame').click(); }
  });
}
let lastTimePaint = 0;
function updateTransport(time, duration, playing) {
  const now = performance.now();
  $('playPause').dataset.playing = String(playing); $('playPause').setAttribute('aria-label', playing ? '暂停' : '播放');
  if (playing && now - lastTimePaint < 55) return;
  lastTimePaint = now; $('currentTime').textContent = time.toFixed(2); $('totalTime').textContent = duration.toFixed(2);
  $('timeline').max = duration; $('timeline').value = time;
}
try {
  const family=new URLSearchParams(location.search).get('family');
  const data=await request('/api/catalog'+(family?'?family='+encodeURIComponent(family):''));
  const glassy=data.glassyUrl?await request(data.glassyUrl):{colors:{},particles:{},hidden:{}};
  catalog = { ...data, glassy: glassyCatalog(glassy,data.glassyBase) }; actions = createActions(catalog);
  filters.forms=[catalog.forms[0].id];
  $('familySelect').replaceChildren(...catalog.families.map(f=>{const option=el('option',f.name);option.value=f.id;return option;}));
  $('familySelect').value=catalog.family;
  $('familySelect').onchange=()=>{location.search='?family='+encodeURIComponent($('familySelect').value);};
  $('libraryCount').textContent = catalog.totalTracks;
  try { viewer = new PetViewer($('canvasMount'), updateTransport, catalog.glassy); }
  catch {
    $('stageMessage').hidden = false; $('stageMessage').textContent = '无法启用 3D。请使用 Chrome 或 Edge，并开启硬件加速。'; stageStatus('');
  }
  wireEvents(); renderFilters();
  if(!catalog.glassy.colors.length){$('glassyMode').replaceChildren(new Option('未导入炫彩素材','none'));$('glassyMode').disabled=true;$('glassyHint').textContent='可选炫彩素材未导入，基础动作预览可用。';}
  current = actions.find(a => a.formId === catalog.forms[0].id && a.id === 'Idle') || actions[0];
  renderList(); await selectAction(current);
} catch (error) {
  stageStatus('素材读取失败'); $('stageMessage').hidden = false;
  $('stageMessage').textContent = `${error.message} 请参照 docs/assets.md 导入素材，再运行 npm run studio。`;
}
