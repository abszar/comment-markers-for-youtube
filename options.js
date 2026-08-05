const DEFAULTS = {
  enabled: true,
  autoPopup: true,
  popupDuration: 5,
  popupCenter: false,
  markerColor: '#ffffff',
  markerAvatars: false,
  avatarSize: 15,
  maxComments: 400,
  maxMarkers: 120,
  minLikes: 0,
  debug: false,
  disabledVideos: []
};

const FIELDS = Object.keys(DEFAULTS);

const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ preview */

// where the fake markers sit, and which ones stand for a multi-comment spot
const PREVIEW_MARKS = [
  { at: 7 }, { at: 15, multi: true }, { at: 23 }, { at: 39 },
  { at: 48, multi: true }, { at: 61 }, { at: 74 }, { at: 88 }
];

function buildPreview() {
  const bar = el('previewBar');
  PREVIEW_MARKS.forEach((m) => {
    const tick = document.createElement('div');
    tick.className = `tick${m.multi ? ' multi' : ''}`;
    tick.style.left = `${m.at}%`;
    bar.appendChild(tick);

    const av = document.createElement('div');
    av.className = 'pav';
    av.style.left = `${m.at}%`;
    bar.appendChild(av);
  });
}

function paintPreview() {
  const colour = el('markerColor').value;
  const size = `${el('avatarSize').value}px`;
  document.querySelectorAll('#previewBar .tick').forEach((t) => { t.style.background = colour; });
  document.querySelectorAll('#previewBar .pav').forEach((a) => {
    a.style.width = size;
    a.style.height = size;
  });
  el('preview').classList.toggle('show-avatars', el('markerAvatars').checked);
}

function paintSwatches() {
  const current = el('markerColor').value.toLowerCase();
  document.querySelectorAll('.sw').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === current));
  });
}

function paintDuration() {
  el('popupDurationValue').textContent = `${el('popupDuration').value}s`;
  el('avatarSizeValue').textContent = `${el('avatarSize').value}px`;
}

function paintDisabled() {
  chrome.storage.sync.get({ disabledVideos: [] }, (res) => {
    const n = (res.disabledVideos || []).length;
    el('disabledCount').textContent = n;
    el('clearDisabled').disabled = n === 0;
    el('clearDisabled').style.opacity = n === 0 ? 0.45 : 1;
  });
}

function repaint() {
  paintPreview();
  paintSwatches();
  paintDuration();
  paintDisabled();
}

/* ------------------------------------------------------------ form <-> data */

function fill(values) {
  for (const k of FIELDS) {
    const node = el(k);
    if (!node) continue;
    if (node.type === 'checkbox') node.checked = Boolean(values[k]);
    else node.value = values[k];
  }
  repaint();
}

function collect() {
  const out = {};
  for (const k of FIELDS) {
    const node = el(k);
    if (!node) continue;
    if (node.type === 'checkbox') out[k] = node.checked;
    else if (node.type === 'number' || node.type === 'range') out[k] = Number(node.value) || DEFAULTS[k];
    else out[k] = node.value;
  }
  return out;
}

function flash(text) {
  const s = el('saved');
  if (text) s.textContent = text;
  s.classList.add('show');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => s.classList.remove('show'), 2400);
}

/* ------------------------------------------------------------------- wiring */

buildPreview();

chrome.storage.sync.get(DEFAULTS, (res) => fill({ ...DEFAULTS, ...(res || {}) }));

document.querySelectorAll('.sw').forEach((b) => {
  b.addEventListener('click', () => {
    el('markerColor').value = b.dataset.color;
    repaint();
    autoSave();
  });
});

/* changes persist as you make them - no need to remember the Save button */
let saveTimer = null;
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set(collect(), () => flash('Saved - reload your YouTube tab to apply.'));
  }, 250);
}

FIELDS.forEach((k) => {
  const node = el(k);
  if (!node) return;
  node.addEventListener('change', autoSave);
  node.addEventListener('input', autoSave);
});

el('markerColor').addEventListener('input', repaint);
el('markerAvatars').addEventListener('change', paintPreview);
el('popupDuration').addEventListener('input', paintDuration);
el('avatarSize').addEventListener('input', repaint);

el('save').addEventListener('click', () => {
  chrome.storage.sync.set(collect(), () => flash('Saved - reload your YouTube tab to apply.'));
});

el('clearDisabled').addEventListener('click', () => {
  chrome.storage.sync.set({ disabledVideos: [] }, () => {
    paintDisabled();
    flash('Cleared - the extension runs on every video again.');
  });
});

el('reset').addEventListener('click', () => {
  fill(DEFAULTS);
  chrome.storage.sync.set(DEFAULTS, () => flash('Reset to defaults.'));
});
