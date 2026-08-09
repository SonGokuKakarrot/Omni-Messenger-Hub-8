// Omni Messenger Hub background module.
// Local diagnostics only: no remote fetches, no webhooks, no token/session reads.

const EXT = globalThis.browser ?? globalThis.chrome;
const HEARTBEAT_TTL_MS = 15000;
const TARGET_URL_RE = /^https:\/\/([^/]+\.)?(facebook|messenger|instagram)\.com\//i;
const state = {
  installedAt: Date.now(),
  lastHeartbeat: 0,
  hookActiveTabs: new Map()
};

function reply(sendResponse, payload) {
  try { sendResponse(payload); } catch (_) {}
}

function isTargetUrl(url = '') {
  return TARGET_URL_RE.test(url);
}

function rememberHeartbeat(sender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) return;
  state.hookActiveTabs.set(tabId, {
    at: Date.now(),
    url: sender.tab.url || sender.url || ''
  });
}

function forgetTab(tabId) {
  if (tabId != null) state.hookActiveTabs.delete(tabId);
}

function pruneStaleTabs() {
  const now = Date.now();
  for (const [tabId, info] of state.hookActiveTabs) {
    if (now - info.at > HEARTBEAT_TTL_MS) forgetTab(tabId);
  }
}

function queryActiveTab(callback) {
  if (!EXT?.tabs?.query) {
    callback(null);
    return;
  }

  try {
    const maybePromise = EXT.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      callback(tabs?.[0] || null);
    });

    if (maybePromise?.then) {
      maybePromise.then((tabs) => callback(tabs?.[0] || null)).catch(() => callback(null));
    }
  } catch (_) {
    callback(null);
  }
}

function buildStatusForTab(tab) {
  pruneStaleTabs();

  if (!tab?.url || !isTargetUrl(tab.url)) {
    return {
      ok: false,
      reason: 'not_target_page',
      installedAt: state.installedAt,
      lastHeartbeat: state.lastHeartbeat,
      activeTabs: [...state.hookActiveTabs.keys()]
    };
  }

  const info = state.hookActiveTabs.get(tab.id);
  const fresh = Boolean(info && Date.now() - info.at <= HEARTBEAT_TTL_MS);

  return {
    ok: fresh,
    reason: fresh ? 'active_on_current_tab' : 'waiting_for_current_tab',
    installedAt: state.installedAt,
    lastHeartbeat: info?.at || state.lastHeartbeat,
    activeTabs: [...state.hookActiveTabs.keys()],
    tabId: tab.id
  };
}

if (EXT?.runtime?.onInstalled) {
  EXT.runtime.onInstalled.addListener(() => {
    console.log('[Omni Messenger Hub] installed');
  });
}

if (EXT?.runtime?.onMessage) {
  EXT.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'MICMAX_HEARTBEAT') {
      state.lastHeartbeat = Date.now();
      rememberHeartbeat(sender);
      reply(sendResponse, { ok: true });
      return false;
    }

    if (message.type === 'MICMAX_STATUS_REQUEST') {
      queryActiveTab((tab) => reply(sendResponse, buildStatusForTab(tab)));
      return true;
    }

    if (message.type === 'MICMAX_RESET_STATUS') {
      state.lastHeartbeat = 0;
      state.hookActiveTabs.clear();
      reply(sendResponse, { ok: true });
      return false;
    }

    return false;
  });
}

// Optional: clean up inactive tabs
setInterval(() => {
  if (EXT?.tabs?.query) {
    EXT.tabs.query({ status: 'complete' }, (tabs) => {
      const activeIds = new Set(tabs.map(t => t.id));
      for (const id of state.hookActiveTabs.keys()) {
        if (!activeIds.has(id)) forgetTab(id);
      }
      pruneStaleTabs();
    });
  }
}, 30000);

if (EXT?.tabs?.onRemoved) {
  EXT.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));
}

if (EXT?.tabs?.onUpdated) {
  EXT.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && !isTargetUrl(changeInfo.url)) forgetTab(tabId);
    if (tab?.url && !isTargetUrl(tab.url)) forgetTab(tabId);
  });
}

console.log('[Omni Messenger Hub] background service started');
