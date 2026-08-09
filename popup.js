(() => {
  const EXT = globalThis.browser ?? globalThis.chrome;
  if (!EXT?.runtime || !EXT?.storage?.local) return;

  const PRESETS = {
    royal: {
      name: 'Royal Clear',
      description: 'Balanced & clean',
      config: {
        profileVersion: 9,
        enabled: true,
        gainDb: 65.0,
        thresholdDb: -50,
        knee: 15,
        ratio: 8,
        attack: 0.0005,
        release: 0.04,
        lowShelfDb: 8,
        presenceDb: 12,
        highShelfDb: 10,
        presencePeakDb: 8,
        presencePeakFreq: 5000,
        presencePeakQ: 1.5,
        limiterDb: -1.5,
        drive: 0.8,
        loudness: 1.0,
        saturationCurveIntensity: 0.8,
        maxBoost: 50000,
        sustain: true,
        sustainTargetDb: -10,
        sustainMaxGain: 80,
        forceRawMic: true,
        reverbEnabled: false,
        reverbDelay: 0.02,
        reverbFeedback: 0.2,
        reverbWet: 0.1,
        keepAlive: true,
        keepAliveGain: 0.0008,
        senderRefreshMs: 300
      }
    },
    lord: {
      name: 'Lord V4',
      description: 'Extreme volume',
      config: {
        profileVersion: 9,
        enabled: true,
        gainDb: 100.0,
        thresholdDb: -65,
        knee: 18,
        ratio: 18,
        attack: 0.00008,
        release: 0.028,
        lowShelfDb: 16,
        presenceDb: 16,
        highShelfDb: 20,
        presencePeakDb: 12,
        presencePeakFreq: 5000,
        presencePeakQ: 1.1,
        limiterDb: -0.5,
        drive: 2.2,
        loudness: 1.15,
        saturationCurveIntensity: 1.8,
        maxBoost: 150000,
        sustain: true,
        sustainTargetDb: -7,
        sustainMaxGain: 140,
        forceRawMic: true,
        reverbEnabled: true,
        reverbDelay: 0.05,
        reverbFeedback: 0.4,
        reverbWet: 0.2,
        keepAlive: true,
        keepAliveGain: 0.0015,
        senderRefreshMs: 200
      }
    },
    ultraQuetta: {
      name: 'Ultra Quetta MAX',
      description: 'Loudest call mode - browser max',
      config: {
        profileVersion: 9,
        enabled: true,
        gainDb: 140.0,
        thresholdDb: -88,
        knee: 28,
        ratio: 20,
        attack: 0.00002,
        release: 0.012,
        lowShelfDb: 30,
        presenceDb: 14,
        highShelfDb: 38,
        presencePeakDb: 13,
        presencePeakFreq: 4800,
        presencePeakQ: 1.0,
        limiterDb: -0.1,
        drive: 7.0,
        loudness: 1.8,
        saturationCurveIntensity: 5.2,
        maxBoost: 500000,
        sustain: true,
        sustainTargetDb: -2,
        sustainMaxGain: 300,
        forceRawMic: true,
        reverbEnabled: true,
        reverbDelay: 0.09,
        reverbFeedback: 0.62,
        reverbWet: 0.42,
        keepAlive: true,
        keepAliveGain: 0.004,
        senderRefreshMs: 250
      }
    },
    apex: {
      name: 'Apex Overdrive',
      description: 'Max perceived loudness, tightest hold',
      config: {
        profileVersion: 9,
        enabled: true,
        gainDb: 140.0,
        thresholdDb: -96,
        knee: 32,
        ratio: 20,
        attack: 0.00001,
        release: 0.010,
        lowShelfDb: 30,
        presenceDb: 15,
        highShelfDb: 42,
        presencePeakDb: 14,
        presencePeakFreq: 4800,
        presencePeakQ: 0.9,
        limiterDb: -0.1,
        drive: 9.5,
        loudness: 2.0,
        saturationCurveIntensity: 5.8,
        maxBoost: 500000,
        sustain: true,
        sustainTargetDb: -1,
        sustainMaxGain: 300,
        forceRawMic: true,
        reverbEnabled: true,
        reverbDelay: 0.06,
        reverbFeedback: 0.5,
        reverbWet: 0.22,
        keepAlive: true,
        keepAliveGain: 0.004,
        senderRefreshMs: 250
      }
    }
  };

  const HAS_PROMISE_API = typeof globalThis.browser !== 'undefined' && EXT === globalThis.browser;
  let currentPreset = 'royal';

  function storageSet(key, value) {
    if (HAS_PROMISE_API) return EXT.storage.local.set({ [key]: value });
    return new Promise((resolve) => {
      try {
        EXT.storage.local.set({ [key]: value }, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  function storageGet(key) {
    if (HAS_PROMISE_API) return EXT.storage.local.get(key);
    return new Promise((resolve) => {
      try {
        EXT.storage.local.get(key, (res) => {
          if (EXT.runtime?.lastError) resolve({});
          else resolve(res || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  async function applyPreset(presetName) {
    const preset = PRESETS[presetName];
    if (!preset) return;
    
    currentPreset = presetName;
    const config = { ...preset.config };
    liveConfig = config;
    
    await storageSet('micMaximizerConfig', config);
    
    // Update UI
    updatePresetButtons(presetName);
    updateControlsFromConfig(config);
    
    console.log(`[Omni] Applied preset: ${preset.name}`);
  }

  function updatePresetButtons(active) {
    document.querySelectorAll('.preset').forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    const activeBtn = document.querySelector(`.preset.${active}`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-pressed', 'true');
    }
    document.body.dataset.theme = active;
  }

  function clearPresetButtons() {
    document.querySelectorAll('.preset').forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    delete document.body.dataset.theme;
    currentPreset = 'custom';
  }

  function valuesMatch(expected, actual) {
    if (typeof expected === 'number') {
      return Math.abs(Number(actual) - expected) < 0.000001;
    }
    return expected === actual;
  }

  const PRESET_IDENTITY_IGNORED_KEYS = new Set(['enabled', 'profileVersion']);

  function getMatchingPreset(config) {
    return Object.entries(PRESETS).find(([, preset]) => (
      Object.entries(preset.config).every(([key, value]) => (
        PRESET_IDENTITY_IGNORED_KEYS.has(key) || valuesMatch(value, config[key])
      ))
    ))?.[0] || null;
  }

  function syncPresetSelection(config) {
    const matchedPreset = getMatchingPreset(config);
    if (matchedPreset) {
      currentPreset = matchedPreset;
      updatePresetButtons(matchedPreset);
    } else {
      clearPresetButtons();
    }
  }

  const CONTROL_IDS = [
    'gainDb', 'thresholdDb', 'knee', 'ratio', 'attack', 'release',
    'lowShelfDb', 'presenceDb', 'presencePeakDb', 'presencePeakFreq',
    'presencePeakQ', 'highShelfDb', 'limiterDb', 'drive', 'loudness',
    'saturationCurveIntensity', 'sustainTargetDb', 'sustainMaxGain',
    'keepAliveGain', 'maxBoost', 'reverbDelay', 'reverbFeedback', 'reverbWet',
    'senderRefreshMs'
  ];
  const CHECKBOX_IDS = ['enabled', 'sustain', 'forceRawMic', 'reverbEnabled', 'keepAlive'];

  function updateFill(input) {
    if (!input) return;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const value = parseFloat(input.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const pct = ((value - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${Math.min(100, Math.max(0, pct))}%`);
  }

  function updateControlsFromConfig(config) {
    // Update all control sliders to match preset
    CONTROL_IDS.forEach((controlId) => {
      const input = document.getElementById(controlId);
      const output = document.getElementById(`${controlId}Val`);
      if (input && config[controlId] !== undefined) {
        input.value = config[controlId];
        if (output) output.textContent = formatOutput(controlId, config[controlId]);
        updateFill(input);
      }
    });

    // Update checkboxes
    CHECKBOX_IDS.forEach((checkId) => {
      const checkbox = document.getElementById(checkId);
      if (checkbox && config[checkId] !== undefined) {
        checkbox.checked = Boolean(config[checkId]);
      }
    });
  }

  function formatOutput(controlId, value) {
    if (controlId === 'senderRefreshMs') return `${Math.round(value)} ms`;
    if (controlId.includes('Freq')) return `${Math.round(value)} Hz`;
    if (controlId.includes('Q')) return value.toFixed(2);
    if (controlId === 'keepAliveGain') return value.toFixed(5);
    if (controlId === 'sustainMaxGain') return `${Math.round(value)}x`;
    if (controlId.includes('Gain') || controlId.includes('Db')) return `${value.toFixed(1)} dB`;
    if (controlId.includes('Bitrate')) return `${Math.round(value / 1000)} kbps`;
    if (controlId === 'maxBoost') return `${Math.round(value).toLocaleString()}x`;
    return value.toFixed(value < 1 ? 4 : 2);
  }

  let liveConfig = null;
  let saveTimer = null;

  function queueConfigSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (liveConfig) storageSet('micMaximizerConfig', liveConfig);
    }, 120);
  }

  async function ensureLiveConfig() {
    if (!liveConfig) liveConfig = await loadConfig();
    return liveConfig;
  }

  async function onControlInput(id, el) {
    const config = await ensureLiveConfig();
    const value = parseFloat(el.value);
    config[id] = value;

    const output = document.getElementById(`${id}Val`);
    if (output) output.textContent = formatOutput(id, value);
    updateFill(el);

    queueConfigSave();
    syncPresetSelection(config);
  }

  async function onCheckboxChange(id, el) {
    const config = await ensureLiveConfig();
    config[id] = el.checked;
    queueConfigSave();
    syncPresetSelection(config);
  }

  async function init() {
    // Load current config
    const config = await loadConfig();
    liveConfig = config;
    updateControlsFromConfig(config);
    syncPresetSelection(config);
    
    // Setup preset buttons
    document.querySelectorAll('.preset').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const presetName = btn.dataset.preset;
        if (presetName) await applyPreset(presetName);
      });
    });

    // Setup control inputs
    CONTROL_IDS.forEach((controlId) => {
      const input = document.getElementById(controlId);
      if (input) input.addEventListener('input', (e) => onControlInput(controlId, e.target));
    });

    // Setup checkboxes
    CHECKBOX_IDS.forEach((checkId) => {
      const checkbox = document.getElementById(checkId);
      if (checkbox) checkbox.addEventListener('change', (e) => onCheckboxChange(checkId, e.target));
    });

    await refreshHookStatus();
  }

  async function refreshHookStatus() {
    const status = document.querySelector('.status');
    if (!status) return;
    
    try {
      const response = await EXT.runtime.sendMessage({ type: 'MICMAX_STATUS_REQUEST' });
      if (response?.ok) {
        status.textContent = '✅ Hook Active | Current Facebook, Messenger, or Instagram tab is injected';
        status.classList.remove('warn');
        status.classList.add('ok');
      } else if (response?.reason === 'not_target_page') {
        status.textContent = '⚠️ Not active here. Open a Facebook, Messenger, or Instagram tab.';
        status.classList.remove('ok');
        status.classList.add('warn');
      } else {
        status.textContent = '⚠️ Waiting for this call page hook to load...';
        status.classList.remove('ok');
        status.classList.add('warn');
      }
    } catch (_) {
      status.textContent = '⚠️ Open Messenger/Instagram call to activate';
      status.classList.remove('ok');
      status.classList.add('warn');
    }
  }

  async function loadConfig() {
    try {
      const res = await storageGet('micMaximizerConfig');
      return res.micMaximizerConfig || PRESETS.royal.config;
    } catch (_) {
      return PRESETS.royal.config;
    }
  }

  // Initialize on load
  document.addEventListener('DOMContentLoaded', init);
  
  // Periodic status refresh
  setInterval(refreshHookStatus, 3000);

  console.log('[Omni Messenger Hub] popup loaded');
})();
