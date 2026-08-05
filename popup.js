const KEYS = { enabled: true, autoPopup: true, markerAvatars: false };
const MAX_REMEMBERED = 300;

let currentVideoId = null;

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function withActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id === undefined) { setStatus('No active tab.'); return; }
    cb(tab);
  });
}

/* ------------------------------------------------------- per-video toggle */

function paintVideoRow() {
  const row = document.getElementById('videoRow');
  const box = document.getElementById('videoEnabled');
  if (!currentVideoId) {
    row.classList.add('disabled');
    box.checked = true;
    return;
  }
  row.classList.remove('disabled');
  chrome.storage.sync.get({ disabledVideos: [] }, (res) => {
    const list = res.disabledVideos || [];
    box.checked = list.indexOf(currentVideoId) === -1;
  });
}

document.getElementById('videoEnabled').addEventListener('change', (e) => {
  if (!currentVideoId) return;
  chrome.storage.sync.get({ disabledVideos: [] }, (res) => {
    let list = (res.disabledVideos || []).filter((id) => id !== currentVideoId);
    if (!e.target.checked) {
      list.push(currentVideoId);
      // storage.sync is small; keep the newest entries only
      if (list.length > MAX_REMEMBERED) list = list.slice(list.length - MAX_REMEMBERED);
    }
    chrome.storage.sync.set({ disabledVideos: list }, () => {
      setStatus(e.target.checked
        ? 'On for this video - reload the tab if markers are missing.'
        : 'Off for this video.');
    });
  });
});

/* ---------------------------------------------------------------- status */

function refreshStatus() {
  withActiveTab((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'ytct:status' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        currentVideoId = null;
        paintVideoRow();
        setStatus('Open a YouTube video, then reopen this popup.');
        return;
      }
      currentVideoId = res.videoId || null;
      paintVideoRow();
      setStatus(res.status === 'idle' ? 'Waiting for a video…' : String(res.status));
    });
  });
}

/* --------------------------------------------------------- global toggles */

chrome.storage.sync.get(KEYS, (res) => {
  const v = { ...KEYS, ...(res || {}) };
  for (const key of Object.keys(KEYS)) {
    document.getElementById(key).checked = Boolean(v[key]);
  }
});

for (const key of Object.keys(KEYS)) {
  document.getElementById(key).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
  });
}

document.getElementById('rescan').addEventListener('click', () => {
  setStatus('Rescanning…');
  withActiveTab((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'ytct:rescan' }, () => {
      if (chrome.runtime.lastError) { setStatus('Not a YouTube tab.'); return; }
      setTimeout(refreshStatus, 800);
    });
  });
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refreshStatus();
