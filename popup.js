const KEYS = { enabled: true, autoPopup: true, markerAvatars: false };

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

function refreshStatus() {
  withActiveTab((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'ytct:status' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setStatus('Open a YouTube video, then reopen this popup.');
        return;
      }
      setStatus(res.status === 'idle' ? 'Waiting for a video…' : String(res.status));
    });
  });
}

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
