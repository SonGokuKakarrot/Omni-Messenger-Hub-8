(() => {
  if (window.__micMaxInjectorReady) return;
  window.__micMaxInjectorReady = true;

  // Omni Messenger Hub — 500000x Facebook/Messenger/Instagram browser-call MAX profile
  const DEFAULTS = {
    profileVersion: 9,
    enabled: true,
    gainDb: 128.0,
    thresholdDb: -82,
    knee: 20,
    ratio: 20,
    attack: 0.00003,
    release: 0.016,
    lowShelfDb: 24,
    presenceDb: 42,
    highShelfDb: 32,
    presencePeakFreq: 4800,
    presencePeakQ: 3.0,
    presencePeakDb: 40,
    limiterDb: -0.1,
    drive: 5.0,
    loudness: 1.6,
    maxBoost: 500000,
    saturationCurveIntensity: 4.0,
    sustain: true,
    sustainTargetDb: -6,
    sustainMaxGain: 240,
    forceRawMic: true,
    reverbEnabled: true,
    reverbDelay: 0.07,
    reverbFeedback: 0.58,
    reverbWet: 0.36,
    keepAlive: true,
    keepAliveGain: 0.0035,
    senderRefreshMs: 250,
    desktopCallSafeMode: true,
    isAndroidQuetta: /Android|Quetta/i.test(navigator.userAgent)
  };
  const MSG_CFG = 'MIC_MAXIMIZER_CONFIG';
  const state = {
    config: { ...DEFAULTS },
    origMD: null,
    origLegacy: null,
    pipelines: new Set(),
    trackMap: new WeakMap(),
    processedTracks: new WeakSet(),
    processedMeta: new WeakMap(),
    constrainedTracks: new WeakSet(),
    senderWatchTracks: new WeakSet(),
    peerConnections: new Set(),
    pcAuditTimers: new WeakMap(),
    senderRecords: new Set(),
    senderBySender: new WeakMap(),
    streamBySender: new WeakMap(),
    refreshingSenders: new WeakSet(),
    lastRefreshAt: new WeakMap(),
    recoverTimers: new Set(),
    sourceTracks: new Set(),
    origApplyConstraints: null,
    lastAudioConstraints: { audio: true },
    lateJoinDetected: false,
    aggressiveRecoveryActive: false,
    healthCheckTimer: null,
    callModeActive: false
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
  const dbToLinear = (db) => Math.pow(10, db / 20);

  // Minimal, self-rate-limited diagnostics. Filter DevTools -> Console for
  // "[Omni]" to see these. Capped at one line per 2s regardless of how
  // often it's called, so a pathological repeat scenario can never turn
  // this into a spam/perf problem in its own right.
  let lastLogAt = 0;
  function diag(message) {
    const now = Date.now();
    if (now - lastLogAt < 2000) return;
    lastLogAt = now;
    try { console.log(`[Omni] ${message}`); } catch (_) { /* console unavailable */ }
  }

  function describeMediaError(error) {
    if (!error) return 'unknown media error';
    const parts = [error.name || error.constructor?.name || 'Error'];
    if (error.message) parts.push(error.message);
    if (error.constraint) parts.push(`constraint=${error.constraint}`);
    return parts.join(': ');
  }

  function cfg(input = state.config) {
    const merged = { ...DEFAULTS, ...(input || {}) };
    // Always re-derive from the live user agent rather than trusting
    // whatever came through a stored/relayed config object -- this is the
    // only OS-branching flag in the file (desktop Windows/Mac/Linux use
    // slower, more conservative recovery timing; Android/Quetta uses
    // faster timing tuned for a more resource-constrained environment),
    // so keeping it self-verifying on every call is cheap insurance.
    merged.isAndroidQuetta = /Android|Quetta/i.test(navigator.userAgent);
    merged.enabled = Boolean(merged.enabled);
    merged.maxBoost = clamp(merged.maxBoost, 1, 500000);
    merged.loudness = clamp(merged.loudness, 0.5, merged.maxBoost);
    merged.gainDb = clamp(merged.gainDb, 0, 140);
    merged.drive = clamp(merged.drive, 0, 20);
    merged.saturationCurveIntensity = clamp(merged.saturationCurveIntensity, 0.5, 6);
    merged.thresholdDb = clamp(merged.thresholdDb, -100, 0);
    merged.knee = clamp(merged.knee, 0, 40);
    merged.ratio = clamp(merged.ratio, 1, 20);
    merged.attack = clamp(merged.attack, 0.00001, 1);
    merged.release = clamp(merged.release, 0.01, 1);
    merged.lowShelfDb = clamp(merged.lowShelfDb, -60, 60);
    merged.presenceDb = clamp(merged.presenceDb, -60, 60);
    merged.highShelfDb = clamp(merged.highShelfDb, -60, 60);
    merged.presencePeakDb = clamp(merged.presencePeakDb, -60, 60);
    merged.presencePeakFreq = clamp(merged.presencePeakFreq, 1000, 12000);
    merged.presencePeakQ = clamp(merged.presencePeakQ, 0.5, 10);
    // WebRTC microphone encoders expect normalized PCM. Keep the final
    // ceiling below 0 dBFS even when the UI exposes extreme values.
    merged.limiterDb = clamp(merged.limiterDb, -24, -0.1);
    merged.sustain = Boolean(merged.sustain);
    merged.sustainTargetDb = clamp(merged.sustainTargetDb, -24, -1);
    merged.sustainMaxGain = clamp(merged.sustainMaxGain, 1, 300);
    merged.forceRawMic = Boolean(merged.forceRawMic);
    merged.reverbEnabled = Boolean(merged.reverbEnabled);
    merged.reverbDelay = clamp(merged.reverbDelay, 0.01, 0.35);
    merged.reverbFeedback = clamp(merged.reverbFeedback, 0, 0.75);
    merged.reverbWet = clamp(merged.reverbWet, 0, 0.6);
    merged.keepAlive = Boolean(merged.keepAlive);
    merged.keepAliveGain = clamp(merged.keepAliveGain, 0, 0.006);
    merged.senderRefreshMs = state.aggressiveRecoveryActive ? 150 : clamp(merged.senderRefreshMs, 150, 1500);
    merged.desktopCallSafeMode = merged.desktopCallSafeMode !== false;

    // Desktop Meta WebRTC calls run a second server/browser voice pipeline
    // after this extension. The Android profile's extreme clipped/reverbed
    // signal is fine for Quetta and for desktop voice-message recording, but
    // on desktop calls it can be classified as invalid/noise and transmitted
    // as silence. When a PeerConnection exists on desktop, keep the extension
    // loud but inside a speech-shaped range that WebRTC reliably forwards.
    if (merged.desktopCallSafeMode && !merged.isAndroidQuetta && state.callModeActive) {
      merged.gainDb = Math.min(merged.gainDb, 86);
      merged.loudness = Math.min(merged.loudness, 3.5);
      merged.drive = Math.min(merged.drive, 2.4);
      merged.saturationCurveIntensity = Math.min(merged.saturationCurveIntensity, 2.4);
      merged.lowShelfDb = Math.min(merged.lowShelfDb, 18);
      merged.presenceDb = Math.min(merged.presenceDb, 24);
      merged.presencePeakDb = Math.min(merged.presencePeakDb, 18);
      merged.highShelfDb = Math.min(merged.highShelfDb, 24);
      merged.thresholdDb = Math.max(merged.thresholdDb, -72);
      merged.sustainTargetDb = Math.min(merged.sustainTargetDb, -6);
      merged.sustainMaxGain = Math.min(merged.sustainMaxGain, 120);
      merged.reverbWet = Math.min(merged.reverbWet, 0.12);
      merged.reverbFeedback = Math.min(merged.reverbFeedback, 0.25);
      merged.keepAliveGain = Math.min(merged.keepAliveGain, 0.0012);
    }
    return merged;
  }

  function makeSaturationCurve(amount = 0.5, intensity = 1) {
    const k = Math.max(0.0001, amount * 100 * intensity);
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function setParam(param, value, ctx) {
    if (!param) return;
    const safeValue = clamp(value, param.minValue ?? -Infinity, param.maxValue ?? Infinity);
    const now = ctx?.currentTime || 0;
    try {
      if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
      if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(safeValue, now, 0.003);
      else param.value = safeValue;
    } catch (_) {
      try { param.value = safeValue; } catch (_) {}
    }
  }

  function applyPipeline(pipeline, raw) {
    if (!pipeline || !raw) return;
    const c = raw.enabled ? raw : {
      ...raw,
      lowShelfDb: 0,
      presenceDb: 0,
      presencePeakDb: 0,
      highShelfDb: 0,
      thresholdDb: -6,
      knee: 0,
      ratio: 1,
      loudness: 1,
      gainDb: 0,
      drive: 0,
      saturationCurveIntensity: 0.5,
      limiterDb: -0.5
    };
    const { ctx, nodes } = pipeline;
    setParam(nodes.low.gain, c.lowShelfDb, ctx);
    setParam(nodes.pres.gain, c.presenceDb, ctx);
    if (nodes.presencePeak) {
      setParam(nodes.presencePeak.gain, c.presencePeakDb, ctx);
      setParam(nodes.presencePeak.frequency, c.presencePeakFreq, ctx);
      setParam(nodes.presencePeak.Q, c.presencePeakQ, ctx);
    }
    setParam(nodes.high.gain, c.highShelfDb, ctx);
    setParam(nodes.comp1.threshold, c.thresholdDb, ctx);
    setParam(nodes.comp1.knee, c.knee, ctx);
    setParam(nodes.comp1.ratio, c.ratio, ctx);
    setParam(nodes.comp1.attack, c.attack, ctx);
    setParam(nodes.comp1.release, c.release, ctx);
    setParam(nodes.loudness.gain, c.loudness, ctx);
    setParam(nodes.gain.gain, dbToLinear(c.gainDb), ctx);
    nodes.saturator.curve = makeSaturationCurve(c.drive, c.saturationCurveIntensity);
    if (nodes.reverbDelay) setParam(nodes.reverbDelay.delayTime, c.reverbDelay, ctx);
    if (nodes.reverbFeedback) setParam(nodes.reverbFeedback.gain, c.reverbEnabled ? c.reverbFeedback : 0, ctx);
    if (nodes.reverbWet) setParam(nodes.reverbWet.gain, c.reverbEnabled ? c.reverbWet : 0, ctx);
    if (nodes.keepAliveGain) setParam(nodes.keepAliveGain.gain, c.keepAlive ? c.keepAliveGain : 0, ctx);
    if (nodes.sustain && !c.sustain) setParam(nodes.sustain.gain, 1, ctx);
    setParam(nodes.limiter.threshold, c.limiterDb, ctx);
  }

  function updateAllPipelines(inputConfig = state.config) {
    for (const pipeline of state.pipelines) applyPipeline(pipeline, inputConfig);
  }

  function resumePipeline(pipeline) {
    const ctx = pipeline?.ctx;
    if (!ctx || ctx.state === 'closed' || typeof ctx.resume !== 'function') return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function resumeAllPipelines() {
    for (const pipeline of state.pipelines) resumePipeline(pipeline);
  }

  function rmsDbFromAnalyser(analyser, buffer) {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = (buffer[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    return 20 * Math.log10(Math.max(rms, 0.00001));
  }

  function startSustainController(pipeline) {
    if (!pipeline || pipeline.sustainTimer) return;
    const { ctx, nodes } = pipeline;
    const buffer = new Uint8Array(nodes.meter.fftSize);
    let currentGain = 1;
    pipeline.sustainTimer = setInterval(() => {
      const c = cfg();
      if (!c.sustain || !nodes.sustain) {
        currentGain = 1;
        setParam(nodes.sustain?.gain, 1, ctx);
        return;
      }
      const db = rmsDbFromAnalyser(nodes.meter, buffer);
      const target = c.sustainTargetDb;
      if (db < target) {
        const lift = 1 + Math.min(0.35, Math.max(0.01, (target - db) * 0.012));
        currentGain = Math.min(c.sustainMaxGain, currentGain * lift);
      } else {
        currentGain = Math.max(1, currentGain * 0.9);
      }
      setParam(nodes.sustain.gain, currentGain, ctx);
    }, 100);
  }

  function createAudioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      return new AC({ latencyHint: 'interactive', sampleRate: 48000 });
    } catch (_) {
      return new AC({ latencyHint: 'interactive' });
    }
  }

  function createKeepAliveNoise(ctx) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  function build(stream, inputConfig) {
    const ctx = createAudioContext();
    if (!ctx || !stream.getAudioTracks().length) return stream;
    stream.getAudioTracks().forEach(enforceRawMicTrack);

    const source = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    hp.Q.value = 0.8;

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 200;

    const pres = ctx.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = 3200;
    pres.Q.value = 1.5;

    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = 'peaking';
    presencePeak.frequency.value = 5000;
    presencePeak.Q.value = 2.2;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 6000;

    const comp1 = ctx.createDynamicsCompressor();
    const comp2 = ctx.createDynamicsCompressor();
    comp2.threshold.value = -10;
    comp2.knee.value = 4;
    comp2.ratio.value = 16;
    comp2.attack.value = 0.0005;
    comp2.release.value = 0.04;

    const loudness = ctx.createGain();
    const gain = ctx.createGain();
    const saturator = ctx.createWaveShaper();
    saturator.oversample = '4x';
    const sustain = ctx.createGain();
    sustain.gain.value = 1;

    const reverbDelay = ctx.createDelay(0.5);
    const reverbFeedback = ctx.createGain();
    const reverbWet = ctx.createGain();
    const keepAliveGain = ctx.createGain();
    keepAliveGain.gain.value = 0;
    const keepAliveSource = createKeepAliveNoise(ctx);

    const limiter = ctx.createDynamicsCompressor();
    limiter.knee.value = 1;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.00008;
    limiter.release.value = 0.006;

    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    meter.smoothingTimeConstant = 0.15;

    const dst = ctx.createMediaStreamDestination();
    source.connect(hp);
    hp.connect(low);
    low.connect(pres);
    pres.connect(presencePeak);
    presencePeak.connect(high);
    high.connect(comp1);
    comp1.connect(comp2);
    comp2.connect(loudness);
    loudness.connect(gain);
    gain.connect(saturator);
    saturator.connect(sustain);
    saturator.connect(reverbDelay);
    reverbDelay.connect(reverbFeedback);
    reverbFeedback.connect(reverbDelay);
    reverbDelay.connect(reverbWet);
    reverbWet.connect(sustain);
    sustain.connect(limiter);
    limiter.connect(meter);
    keepAliveSource.connect(keepAliveGain);
    keepAliveGain.connect(meter);
    meter.connect(dst);
    keepAliveSource.start(0);

    const pipeline = {
      ctx,
      nodes: { low, pres, presencePeak, high, comp1, loudness, gain, saturator, sustain, reverbDelay, reverbFeedback, reverbWet, keepAliveGain, limiter, meter },
      keepAliveSource,
      sustainTimer: null
    };
    applyPipeline(pipeline, inputConfig);
    state.pipelines.add(pipeline);
    startSustainController(pipeline);
    resumePipeline(pipeline);

    const outAudioTracks = dst.stream.getAudioTracks();
    outAudioTracks.forEach((track) => {
      state.processedTracks.add(track);
      state.processedMeta.set(track, { source: stream, pipeline });
    });

    // Map every raw source audio track to this pipeline's output so any
    // later code path that encounters the SAME raw track object again
    // (e.g. addTrack called directly with it, bypassing the processed
    // stream this function returns) reuses this existing pipeline instead
    // of silently building a second, redundant one for the same mic input.
    const primaryOut = outAudioTracks[0];
    if (primaryOut) {
      stream.getAudioTracks().forEach((srcTrack) => {
        if (srcTrack !== primaryOut) state.trackMap.set(srcTrack, primaryOut);
      });
    }

    const out = new MediaStream([
      ...outAudioTracks,
      ...stream.getTracks().filter((track) => track.kind !== 'audio')
    ]);

    const stop = () => {
      state.pipelines.delete(pipeline);
      if (pipeline.sustainTimer) clearInterval(pipeline.sustainTimer);
      stream.getAudioTracks().forEach((track) => state.sourceTracks.delete(track));
      try { pipeline.keepAliveSource?.stop(); } catch (_) {}
      try { ctx.close(); } catch (_) {}
    };
    outAudioTracks.forEach((track) => track.addEventListener('ended', stop, { once: true }));
    stream.getTracks().forEach((track) => track.addEventListener('ended', scheduleRecoveryPasses, { once: true }));
    return out;
  }

  function rawMicAudioConstraints(audio = {}) {
    const base = audio && typeof audio === 'object' ? audio : {};
    const processingOff = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      googEchoCancellation: false,
      googEchoCancellation2: false,
      googEchoCancellation3: false,
      googDAEchoCancellation: false,
      googExperimentalEchoCancellation: false,
      googHybridEchoCancellation: false,
      googHybridAec: false,
      googEchoCancellationHybrid: false,
      googAutoGainControl: false,
      googAutoGainControl2: false,
      googNoiseSuppression: false,
      googNoiseSuppression2: false,
      googExperimentalNoiseSuppression: false,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
      googAudioMirroring: false,
      googBeamforming: false,
      mozAutoGainControl: false,
      mozNoiseSuppression: false
    };
    return {
      ...base,
      ...processingOff,
      channelCount: { ideal: 1, max: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
      advanced: [
        ...(Array.isArray(base.advanced) ? base.advanced : []),
        processingOff,
        { channelCount: 1 },
        { sampleRate: 48000 },
        { sampleSize: 16 }
      ]
    };
  }

  function enforceRawMicTrack(track) {
    if (!track || track.kind !== 'audio' || !cfg().forceRawMic) return;
    state.sourceTracks.add(track);
    // Do not force track.enabled=true here: Facebook/Messenger/Instagram use
    // that flag for user mute and sender state. Overriding it can fight the
    // site and trigger sender replacement loops.
    try { track.contentHint = 'speech'; } catch (_) {}
    if (typeof track.applyConstraints === 'function' && !state.constrainedTracks.has(track)) {
      state.constrainedTracks.add(track);
      try { track.applyConstraints(rawMicAudioConstraints()).catch(() => {}); } catch (_) {}
    }
  }

  function enforceAllSourceConstraints() {
    for (const track of [...state.sourceTracks]) {
      if (!track || track.readyState === 'ended') {
        state.sourceTracks.delete(track);
        continue;
      }
      enforceRawMicTrack(track);
    }
  }

  function patchTrackConstraints() {
    const proto = window.MediaStreamTrack?.prototype;
    if (!proto || proto.__micMaxTrackPatched || typeof proto.applyConstraints !== 'function') return;
    state.origApplyConstraints = proto.applyConstraints;
    proto.applyConstraints = function applyConstraints(constraints = {}) {
      const next = cfg().enabled && cfg().forceRawMic && this.kind === 'audio'
        ? rawMicAudioConstraints(constraints)
        : constraints;
      return state.origApplyConstraints.call(this, next);
    };
    proto.__micMaxTrackPatched = true;
  }

  function normalizeConstraints(constraints) {
    if (!constraints) return { audio: true };
    if (!cfg().forceRawMic) return constraints;
    const next = { ...constraints };
    if (typeof next.audio === 'object') next.audio = rawMicAudioConstraints(next.audio);
    return next;
  }

  function wantsAudio(constraints) {
    if (constraints === true) return true;
    if (!constraints || typeof constraints !== 'object') return false;
    return 'audio' in constraints ? Boolean(constraints.audio) : true;
  }

  function processedStreamFor(originalStream, rawTrack, processedTrack) {
    if (!originalStream || typeof originalStream.getTracks !== 'function') return new MediaStream([processedTrack]);
    return new MediaStream(originalStream.getTracks().map((track) => (track === rawTrack ? processedTrack : track)));
  }

  function rememberSenderStreams(sender, streams = []) {
    if (!sender || !streams.length) return;
    state.streamBySender.set(sender, streams);
    if (typeof sender.setStreams === 'function') {
      try { sender.setStreams(...streams); } catch (_) {}
    }
  }

  function isDesktopBrowser() {
    return !cfg().isAndroidQuetta;
  }

  function liveAudioTrack(stream) {
    if (!stream || typeof stream.getAudioTracks !== 'function') return null;
    return stream.getAudioTracks().find((track) => track.readyState !== 'ended') || null;
  }

  function processedSourceIsLive(track) {
    if (!track || !state.processedTracks.has(track)) return true;
    const meta = state.processedMeta.get(track);
    if (!meta) return true;
    resumePipeline(meta.pipeline);
    const sourceTrack = liveAudioTrack(meta.source);
    // A muted source can be transient or user/app-controlled. Replacing the
    // sender during these normal mute windows is a common cause of 10–15s
    // dropouts, so only require the backing track to still exist and be live.
    return Boolean(sourceTrack && sourceTrack.readyState !== 'ended');
  }

  function trackNeedsRefresh(track) {
    if (!track || track.kind !== 'audio') return true;
    if (track.readyState === 'ended') return true;
    if (!state.processedTracks.has(track)) return true;
    return !processedSourceIsLive(track);
  }

  function rebuildProcessedTrack(track) {
    const meta = state.processedMeta.get(track);
    const sourceTrack = liveAudioTrack(meta?.source);
    if (!sourceTrack) return track;
    try {
      const rebuiltStream = build(new MediaStream([sourceTrack]), state.config);
      return liveAudioTrack(rebuiltStream) || track;
    } catch (_) {
      return track;
    }
  }

  function cloneForSender(track) {
    const liveTrack = track?.readyState === 'ended' ? rebuildProcessedTrack(track) : track;
    if (!liveTrack || liveTrack.readyState === 'ended') return liveTrack;

    // Desktop Meta calling pages are more sensitive to sender-track churn than
    // Android/Quetta. Reusing the destination track preserves the WebAudio clock
    // and avoids a Chrome desktop failure mode where cloned destination tracks
    // can be accepted by replaceTrack() but transmit silence. Android keeps the
    // clone path because it already works well there and isolates each sender.
    if (isDesktopBrowser() || typeof liveTrack.clone !== 'function') return liveTrack;

    try {
      const clone = liveTrack.clone();
      state.processedTracks.add(clone);
      const meta = state.processedMeta.get(liveTrack);
      if (meta) state.processedMeta.set(clone, meta);
      return clone;
    } catch (_) {
      return liveTrack;
    }
  }

  function processAudioTrack(track, forSender = false) {
    if (!track || track.kind !== 'audio') return track;
    if (state.processedTracks.has(track)) {
      const nextTrack = track.readyState === 'ended' ? rebuildProcessedTrack(track) : track;
      return forSender ? cloneForSender(nextTrack) : nextTrack;
    }

    const existing = state.trackMap.get(track);
    if (existing) {
      const nextTrack = existing.readyState === 'ended' ? rebuildProcessedTrack(existing) : existing;
      if (nextTrack && nextTrack !== existing && nextTrack.readyState !== 'ended') state.trackMap.set(track, nextTrack);
      if (nextTrack && nextTrack.readyState !== 'ended') return forSender ? cloneForSender(nextTrack) : nextTrack;
    }

    const processedStream = build(new MediaStream([track]), state.config);
    const processedTrack = liveAudioTrack(processedStream) || track;
    if (processedTrack !== track) {
      state.processedTracks.add(processedTrack);
      state.trackMap.set(track, processedTrack);
      track.addEventListener('ended', () => {
        try { processedTrack.stop(); } catch (_) {}
      }, { once: true });
    }
    return forSender ? cloneForSender(processedTrack) : processedTrack;
  }

  function tuneAudioSender(sender) {
    if (!sender || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;
    try {
      const params = sender.getParameters() || {};
      const encodings = Array.isArray(params.encodings) && params.encodings.length ? params.encodings : [{}];
      params.encodings = encodings.map((encoding) => ({
        ...encoding,
        // Preserve Meta's active/mute state and only request a higher audio
        // bitrate. Non-standard priority fields and forced active=true can make
        // desktop browser behavior diverge from the page's call state.
        dtx: false,
        maxBitrate: Math.max(Number(encoding.maxBitrate) || 0, 640000)
      }));
      sender.setParameters(params).catch(() => {});
    } catch (_) {}
  }

  function schedulePeerConnectionAudit(pc, reason = 'pc-event') {
    if (!pc || !state.peerConnections.has(pc)) return;
    const closed = ['closed', 'failed'].includes(pc.connectionState || pc.iceConnectionState || '');
    if (closed) {
      state.peerConnections.delete(pc);
      if (!state.peerConnections.size) {
        state.callModeActive = false;
        state.config = cfg(state.config);
        updateAllPipelines(state.config);
      }
      return;
    }

    const existing = state.pcAuditTimers.get(pc);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      state.pcAuditTimers.delete(pc);
      resumeAllPipelines();
      reconcileLiveSenders();
    }, state.aggressiveRecoveryActive ? 25 : 75);
    state.pcAuditTimers.set(pc, timer);
  }

  function rememberPeerConnection(pc) {
    if (!pc || state.peerConnections.has(pc)) return;
    state.peerConnections.add(pc);
    if (!state.callModeActive) {
      state.callModeActive = true;
      state.config = cfg(state.config);
      updateAllPipelines(state.config);
    }
    diag(`new RTCPeerConnection registered (${state.peerConnections.size} total tracked)`);
    
    // LATE JOIN DETECTION: PC joins after existing connections
    if (state.peerConnections.size > 1 && !state.lateJoinDetected) {
      state.lateJoinDetected = true;
      diag('late-join pattern detected (2nd+ PeerConnection) -- activating aggressive recovery');
      activateAggressiveRecovery();
    }
    
    if (typeof pc.addEventListener === 'function') {
      const audit = (event) => schedulePeerConnectionAudit(pc, event?.type || 'pc-event');
      ['negotiationneeded', 'signalingstatechange', 'connectionstatechange', 'iceconnectionstatechange'].forEach((type) => {
        pc.addEventListener(type, audit, { passive: true });
      });
      pc.addEventListener('connectionstatechange', () => {
        if (['closed', 'failed'].includes(pc.connectionState)) {
          state.peerConnections.delete(pc);
          if (!state.peerConnections.size) {
            state.callModeActive = false;
            state.config = cfg(state.config);
            updateAllPipelines(state.config);
          }
        }
      });
    }
  }

  function activateAggressiveRecovery() {
    if (state.aggressiveRecoveryActive) return;
    state.aggressiveRecoveryActive = true;
    
    // AGGRESSIVE RECOVERY FOR ANDROID/QUETTA LATE JOINERS
    [0, 40, 80, 150, 300, 600, 1200].forEach((delay) => {
      const timer = setTimeout(() => {
        state.recoverTimers.delete(timer);
        resumeAllPipelines();
        reconcileLiveSenders();
      }, delay);
      state.recoverTimers.add(timer);
    });
    
    // Sender refresh remains capped so calls stay alive without runaway replacement loops
    console.log('[Omni] Aggressive recovery activated for late-join scenario');
  }

  function rememberSender(sender, track, pc = null) {
    if (!sender) return null;
    let record = state.senderBySender.get(sender);
    if (!record) {
      record = { sender, track: null, pc: null, kind: null };
      state.senderBySender.set(sender, record);
      state.senderRecords.add(record);
    }
    if (track) {
      record.track = track;
      record.kind = track.kind;
    }
    if (!record.kind && sender.track?.kind) record.kind = sender.track.kind;
    if (pc) record.pc = pc;
    return record;
  }

  function recordIsClosed(record) {
    const pc = record?.pc;
    if (!pc) return false;
    return ['closed', 'failed'].includes(pc.connectionState || pc.iceConnectionState || '');
  }

  async function reacquireProcessedTrackForSender() {
    if (!state.origMD) return null;
    try {
      const constraints = normalizeConstraints(state.lastAudioConstraints || { audio: true });
      const stream = await state.origMD(constraints);
      const rawTrack = liveAudioTrack(stream);
      if (!rawTrack) return null;
      return processAudioTrack(rawTrack, true);
    } catch (_) {
      return null;
    }
  }

  async function replaceSenderTrack(sender, track) {
    if (!sender || typeof sender.replaceTrack !== 'function') return null;
    try {
      const replacement = track?.readyState === 'ended' ? await reacquireProcessedTrackForSender() : processAudioTrack(track, true);
      if (!replacement) return null;
      await sender.replaceTrack(replacement);
      rememberSenderStreams(sender, state.streamBySender.get(sender) || []);
      tuneAudioSender(sender);
      rememberSender(sender, replacement);
      watchSenderTrack(sender, replacement);
      return replacement;
    } catch (_) {
      return null;
    }
  }

  // A genuine disconnection (no track, or the track's own readyState is
  // 'ended') always needs fixing immediately and bypasses the cooldown
  // below -- rate-limiting a real recovery would make things worse, not
  // better. The cooldown exists for the other, "maybe" case: something
  // (a mute event, a periodic reconciliation pass, a renegotiation on a
  // complex multi-participant call) repeatedly flags the same sender as
  // possibly needing attention. Every actual replaceTrack call risks a
  // brief glitch on the receiving end while the SFU re-syncs to it, so if
  // whatever is triggering this keeps firing every few seconds, refusing
  // to act on it more than once per cooldown window directly reduces how
  // much churn our own recovery logic can add on top of it.
  const SENDER_REFRESH_COOLDOWN_MS = 4000;

  function queueSenderRefresh(sender, track) {
    resumeAllPipelines();
    if (!sender || state.refreshingSenders.has(sender)) return;
    const isDefiniteDisconnection = !track || track.readyState === 'ended';
    if (!isDefiniteDisconnection) {
      const last = state.lastRefreshAt.get(sender) || 0;
      if (Date.now() - last < SENDER_REFRESH_COOLDOWN_MS) {
        diag('sender refresh skipped (cooldown active, not a definite disconnection)');
        return;
      }
    }
    state.refreshingSenders.add(sender);
    state.lastRefreshAt.set(sender, Date.now());
    diag(`sender refresh: ${isDefiniteDisconnection ? 'track ended/missing' : 'flagged as needing refresh'}`);
    const refreshDelay = state.aggressiveRecoveryActive ? 20 : 40;
    setTimeout(() => {
      replaceSenderTrack(sender, track).finally(() => state.refreshingSenders.delete(sender));
    }, refreshDelay);
  }

  function watchSenderTrack(sender, track) {
    if (!sender || !track || track.kind !== 'audio') return;
    rememberSender(sender, track);
    if (!state.processedTracks.has(track) || state.senderWatchTracks.has(track)) return;
    state.senderWatchTracks.add(track);
    track.addEventListener('ended', () => queueSenderRefresh(sender, track), { once: true });
    track.addEventListener('mute', () => {
      // Do not replace on ordinary WebRTC mute events; they are expected during
      // silence, app transitions, and remote negotiation. Only recover if the
      // track actually ended or lost its source.
      setTimeout(() => { if (trackNeedsRefresh(track)) queueSenderRefresh(sender, track); }, 500);
    }, { passive: true });
    track.addEventListener('unmute', () => tuneAudioSender(sender), { passive: true });
  }

  function scheduleRecoveryPasses() {
    for (const timer of state.recoverTimers) clearTimeout(timer);
    state.recoverTimers.clear();
    
    // ADAPTIVE RECOVERY FOR ANDROID/QUETTA
    const recoveryIntervals = state.config.isAndroidQuetta 
      ? [0, 50, 100, 200, 400, 800, 1500]
      : [0, 120, 400, 1000, 2000, 4000, 7500];
    
    recoveryIntervals.forEach((delay) => {
      const timer = setTimeout(() => {
        state.recoverTimers.delete(timer);
        resumeAllPipelines();
        reconcileLiveSenders();
      }, delay);
      state.recoverTimers.add(timer);
    });
  }

  function reconcileLiveSenders() {
    if (!cfg().enabled) return;
    resumeAllPipelines();
    for (const pc of [...state.peerConnections]) {
      if (typeof pc.getSenders === 'function') {
        try {
          for (const sender of pc.getSenders()) {
            const track = sender?.track;
            if (track?.kind === 'audio') rememberSender(sender, track, pc);
          }
        } catch (_) {}
      }
      if (typeof pc.getTransceivers === 'function') {
        try {
          for (const transceiver of pc.getTransceivers()) {
            const sender = transceiver?.sender;
            const receiverTrack = transceiver?.receiver?.track;
            const midLooksAudio = String(transceiver?.mid || '').toLowerCase().includes('audio');
            if (sender && (sender.track?.kind === 'audio' || receiverTrack?.kind === 'audio' || midLooksAudio)) {
              const record = rememberSender(sender, sender.track || null, pc);
              if (record) record.kind = 'audio';
            }
          }
        } catch (_) {}
      }
    }

    for (const record of [...state.senderRecords]) {
      if (recordIsClosed(record)) {
        state.senderRecords.delete(record);
        continue;
      }
      const sender = record.sender;
      const track = sender?.track || record.track;
      const isAudioRecord = track?.kind === 'audio' || record.kind === 'audio';
      if (!sender || !isAudioRecord) continue;
      if (!track) continue;
      if (trackNeedsRefresh(track)) queueSenderRefresh(sender, track);
      else {
        tuneAudioSender(sender);
        watchSenderTrack(sender, track);
      }
    }
  }

  function patchPeerConnectionPaths() {
    const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (PC?.prototype && !PC.prototype.__micMaxPcPatched) {
      const originalAddTrack = PC.prototype.addTrack;
      if (typeof originalAddTrack === 'function') {
        PC.prototype.addTrack = function addTrack(track, ...streams) {
          rememberPeerConnection(this);
          if (cfg().enabled && track?.kind === 'audio') {
            const processedTrack = processAudioTrack(track, true);
            const patchedStreams = streams.length
              ? streams.map((stream) => processedStreamFor(stream, track, processedTrack))
              : [new MediaStream([processedTrack])];
            const sender = originalAddTrack.call(this, processedTrack, ...patchedStreams);
            rememberSenderStreams(sender, patchedStreams);
            tuneAudioSender(sender);
            rememberSender(sender, processedTrack, this);
            if (typeof sender?.replaceTrack === 'function') watchSenderTrack(sender, processedTrack);
            return sender;
          }
          return originalAddTrack.call(this, track, ...streams);
        };
      }

      const originalAddStream = PC.prototype.addStream;
      if (typeof originalAddStream === 'function') {
        PC.prototype.addStream = function addStream(stream) {
          rememberPeerConnection(this);
          const rawTrack = stream?.getAudioTracks?.()[0];
          if (cfg().enabled && rawTrack) {
            const processedTrack = processAudioTrack(rawTrack, true);
            const processedStream = processedStreamFor(stream, rawTrack, processedTrack);
            return originalAddStream.call(this, processedStream);
          }
          return originalAddStream.call(this, stream);
        };
      }

      const originalAddTransceiver = PC.prototype.addTransceiver;
      if (typeof originalAddTransceiver === 'function') {
        PC.prototype.addTransceiver = function addTransceiver(trackOrKind, init = undefined) {
          rememberPeerConnection(this);
          if (cfg().enabled && trackOrKind?.kind === 'audio') {
            const processedTrack = processAudioTrack(trackOrKind, true);
            const patchedInit = init?.streams
              ? { ...init, streams: init.streams.map((stream) => processedStreamFor(stream, trackOrKind, processedTrack)) }
              : init;
            const transceiver = originalAddTransceiver.call(this, processedTrack, patchedInit);
            if (patchedInit?.streams) rememberSenderStreams(transceiver?.sender, patchedInit.streams);
            tuneAudioSender(transceiver?.sender);
            rememberSender(transceiver?.sender, processedTrack, this);
            if (typeof transceiver?.sender?.replaceTrack === 'function') watchSenderTrack(transceiver.sender, processedTrack);
            return transceiver;
          }
          const transceiver = originalAddTransceiver.call(this, trackOrKind, init);
          if (cfg().enabled && trackOrKind === 'audio') {
            // Do not attach/reacquire a microphone for an empty audio
            // transceiver. Meta creates receive/sendrecv transceivers before
            // permission and signaling are complete on desktop; forcing a local
            // track here can break its negotiated audio/video call setup. The
            // actual microphone is processed when Meta supplies a real track via
            // getUserMedia(), addTrack(), or replaceTrack(track).
            const record = rememberSender(transceiver?.sender, transceiver?.sender?.track || null, this);
            if (record) record.kind = 'audio';
            tuneAudioSender(transceiver?.sender);
          }
          return transceiver;
        };
      }

      const originalCreateOffer = PC.prototype.createOffer;
      if (typeof originalCreateOffer === 'function') {
        PC.prototype.createOffer = function createOffer(...args) {
          rememberPeerConnection(this);
          return originalCreateOffer.apply(this, args).then((offer) => {
            schedulePeerConnectionAudit(this, 'createOffer');
            return offer;
          });
        };
      }

      const originalCreateAnswer = PC.prototype.createAnswer;
      if (typeof originalCreateAnswer === 'function') {
        PC.prototype.createAnswer = function createAnswer(...args) {
          rememberPeerConnection(this);
          return originalCreateAnswer.apply(this, args).then((answer) => {
            schedulePeerConnectionAudit(this, 'createAnswer');
            return answer;
          });
        };
      }

      const originalSetLocalDescription = PC.prototype.setLocalDescription;
      if (typeof originalSetLocalDescription === 'function') {
        PC.prototype.setLocalDescription = function setLocalDescription(desc) {
          rememberPeerConnection(this);
          const result = originalSetLocalDescription.call(this, desc);
          Promise.resolve(result).then(() => schedulePeerConnectionAudit(this, 'setLocalDescription')).catch(() => {});
          return result;
        };
      }

      const originalSetRemoteDescription = PC.prototype.setRemoteDescription;
      if (typeof originalSetRemoteDescription === 'function') {
        PC.prototype.setRemoteDescription = function setRemoteDescription(desc) {
          rememberPeerConnection(this);
          // Keep the remote SDP byte-for-byte. Meta's desktop call stack owns
          // signaling and SFU negotiation; the extension should observe state
          // and process local microphone tracks, not mutate remote media
          // capabilities.
          const result = originalSetRemoteDescription.call(this, desc);
          Promise.resolve(result).then(scheduleRecoveryPasses).catch(() => {});
          return result;
        };
      }

      PC.prototype.__micMaxPcPatched = true;
    }

    const Sender = window.RTCRtpSender;
    if (Sender?.prototype && !Sender.prototype.__micMaxSenderPatched) {
      const originalReplaceTrack = Sender.prototype.replaceTrack;
      if (typeof originalReplaceTrack === 'function') {
        Sender.prototype.replaceTrack = function replaceTrack(track) {
          const currentKind = this.track?.kind;
          const shouldProcess = cfg().enabled && (track?.kind === 'audio' || (!track && currentKind === 'audio'));
          if (shouldProcess && !track) {
            const record = rememberSender(this, this.track || null);
            if (record) record.kind = 'audio';


            queueSenderRefresh(this, this.track || null);
            // Meta desktop call pages may briefly call replaceTrack(null) while
            // renegotiating devices/transceivers. Passing that null through can
            // leave the local sender permanently silent even after our recovery
            // runs. Keep the current processed microphone attached and let an
            // explicit user mute continue to flow through track.enabled instead.
            return Promise.resolve();

          }
          const nextTrack = shouldProcess && track?.kind === 'audio' ? processAudioTrack(track, true) : track;
          const result = originalReplaceTrack.call(this, nextTrack);
          if (nextTrack?.kind === 'audio') {
            rememberSender(this, nextTrack);
            Promise.resolve(result).then(() => {
              tuneAudioSender(this);
              rememberSenderStreams(this, state.streamBySender.get(this) || []);
              watchSenderTrack(this, nextTrack);
            }).catch(() => {});
          }
          return result;
        };
      }
      Sender.prototype.__micMaxSenderPatched = true;
    }
  }

  async function getStreamWithFallback(orig, constraints, ctx) {
    try {
      return await orig.call(ctx, normalizeConstraints(constraints));
    } catch (error) {
      diag(`getUserMedia with raw constraints failed; retrying page constraints (${describeMediaError(error)})`);
      try {
        return await orig.call(ctx, constraints);
      } catch (fallbackError) {
        diag(`getUserMedia failed (${describeMediaError(fallbackError)})`);
        throw fallbackError;
      }
    }
  }

  async function wrapped(orig, constraints, ctx) {
    if (wantsAudio(constraints)) state.lastAudioConstraints = constraints || { audio: true };
    if (!cfg().enabled) return orig.call(ctx, constraints);
    return getStreamWithFallback(orig, constraints, ctx).then((stream) => {
      if (!stream || !stream.getAudioTracks().length) return stream;
      return build(stream, state.config);
    });
  }

  // Main hooks
  if (navigator.mediaDevices?.getUserMedia) {
    state.origMD = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function getUserMedia(constraints) {
      return wrapped(state.origMD, constraints, navigator.mediaDevices);
    };
  }

  if (navigator.getUserMedia) {
    state.origLegacy = navigator.getUserMedia.bind(navigator);
    navigator.getUserMedia = (constraints, ok, fail) => {
      wrapped(state.origLegacy, constraints, navigator).then(ok).catch((err) => fail && fail(err));
    };
  }

  patchTrackConstraints();
  // CRITICAL FIX: this call was missing entirely. Every addTrack/
  // addTransceiver/addStream/replaceTrack hook, the late-join
  // detector, and the whole sender-recovery system below are defined but
  // do nothing until this runs. Without it, only the getUserMedia hook
  // was ever active — which explains why audio was loud when a call
  // first starts (the very first track came from our hook) but silently
  // reverted to the raw, unprocessed mic the moment the page called
  // replaceTrack() directly on an existing sender, e.g. exactly what
  // happens during the renegotiation triggered when someone else joins
  // an existing group call. See CHANGES.md for the full trace.
  patchPeerConnectionPaths();

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== MSG_CFG) return;
    state.config = cfg(event.data.payload);
    updateAllPipelines(state.config);
    scheduleRecoveryPasses();
    restartHealthCheckInterval();
  });

  ['focus', 'pageshow', 'online', 'pointerdown', 'touchstart'].forEach((type) => {
    window.addEventListener(type, scheduleRecoveryPasses, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRecoveryPasses();
  });

  function runHealthCheck() {
    // Lightweight health check only. Sender replacement is event/recovery
    // driven to avoid leaking cloned tracks and confusing site WebRTC state.
    enforceAllSourceConstraints();
    resumeAllPipelines();
    reconcileLiveSenders();
  }

  function restartHealthCheckInterval() {
    if (state.healthCheckTimer) clearInterval(state.healthCheckTimer);
    state.healthCheckTimer = setInterval(runHealthCheck, Math.max(1000, cfg().senderRefreshMs));
  }

  restartHealthCheckInterval();
  window.postMessage({ type: 'MIC_MAXIMIZER_READY' }, '*');
})();
