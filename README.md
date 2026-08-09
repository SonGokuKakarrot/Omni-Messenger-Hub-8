# Omni Messenger Hub

**Developed by Omni**

## 🔊 500000x MAX Profile — Windows, Mac, Linux & Android Quetta

This is the **loudest messenger/Instagram browser call extension ever
made**, with extreme real-time DSP control. Same extension package, same
DSP engine, on every platform — Chrome or Edge on Windows, Chrome on
Mac/Linux, and Quetta Browser on Android. See **WINDOWS SETUP** or
**ANDROID QUETTA SETUP** below for platform-specific install steps.

## Supported call pages

- `https://facebook.com/*`
- `https://*.facebook.com/*`
- `https://messenger.com/*`
- `https://*.messenger.com/*`
- `https://instagram.com/*`
- `https://*.instagram.com/*`

---

## 🚀 PRESETS

### 1. **Royal Clear** (Balanced)
Clean, loud calls with minimal distortion. Good for all-day calls.
- Gain: 24 dB (16x)
- Loudness: 4x
- Boost ceiling: 2000x
- Safe, professional-grade loudness

### 2. **Lord V4** (200000x — Previous Max)
The original extreme profile. Very aggressive.
- Gain: 106 dB (200000x multiplier)
- Compressor Ratio: 20
- Limiter Ceiling: -0.1 dB
- Best for maximum volume with some distortion tolerance

### 3. **🔊 Ultra Quetta MAX** (500000x — Loudest raw-gain ceiling)
**Maximum loudness for Facebook/Messenger/Instagram browser calls.**
- **Gain: 140 dB (the hard ceiling — cannot go higher)**
- Saturation Intensity: 5.2x
- 4.8kHz presence peak: +48 dB (voice intelligibility)
- Compressor attack: 0.00002s (near-instant response)
- Limiter ceiling: -0.1 dB (as close to full scale as possible without clipping)
- Sustain Max Gain: 300 (the hard ceiling)

### 4. **⚡ Apex Overdrive** (Max *perceived* loudness)
Same hard ceilings as Ultra Quetta (gain, ratio, and boost are already
maxed out there — see "Why this isn't just Ultra Quetta + bigger
numbers" below) but tightens everything that actually still had room:
compressor threshold/knee, presence/clarity EQ, drive/saturation, and a
now-genuinely-adaptive sustain target. Reverb is turned *down*, not up —
a drier, more direct signal reads as louder and closer than a
reverberant one.
- Gain: 140 dB (same ceiling as Ultra Quetta)
- Compressor threshold: -96 dB / knee 32 (tighter hold than Ultra Quetta)
- 4.8kHz presence peak: +56 dB
- Drive: 9.5 / Saturation Intensity: 5.8x
- Sustain Target: -1 dB (most persistent lift of all 4 presets)
- Trades a little naturalness for the loudest *consistent* output this
  engine can produce without clipping

---

## 🎛️ MANUAL LOUDNESS GUIDE

### ✅ Increase these (move slider RIGHT):

1. **Gain dB** (0–140 dB range) — Primary volume boost
2. **Loudness Trim** (0.5–500000x) — Multiplicative gain
3. **Boost ceiling** (1–500000x) — Loudness hard cap
4. **Saturation Drive** (0–20) — Harmonic distortion intensity
5. **Saturation Intensity** (0.5–6.0) — Curve aggressiveness
6. **Compressor Ratio** (1–20) — Compression ratio
7. **Sustain Max Gain** (1–300) — Anti-ducking hold
8. **Presence EQ** (-60 to +60 dB) — Upper midrange (3200 Hz)
9. **5kHz Peak** (-60 to +60 dB) — Voice presence (Android clarity)
10. **Treble EQ** (-60 to +60 dB) — High frequency boost
11. **Bass EQ** (-60 to +60 dB) — Low end (optional)

### ⬇️ Decrease these (move slider LEFT / more negative):

1. **Compressor Threshold** (-100 to 0 dB) — Make **more negative** (lower threshold = more aggressive compression)
2. **Sustain Target dB** (-24 to +12 dB) — Lower if you need stronger anti-ducking

### ☑️ Keep both checkboxes ON:

- ✅ **Anti-duck sustain lock** — Prevents volume dips during speech
- ✅ **Raw mic constraint lock** — Disables all browser noise suppression
- ✅ **Reverb keep-alive layer** — Prevents audio dropout
- ✅ **Mic activity keep-alive** — Keeps pipeline alive during silence

---

## 🎯 BEST ORDER TO ADJUST (Maximum Loudness)

1. **Start with a preset** (Royal Clear → Lord V4 → Ultra Quetta MAX)
2. **Increase Gain dB first** (biggest impact on volume)
3. **Lower Compressor Threshold to -82 or -88 dB** (activates aggressive compression)
4. **Raise Compressor Ratio to 20** (maximum compression)
5. **Increase Saturation Drive to 5.0–7.0** (adds harmonic punch)
6. **Boost Presence EQ to +42 to +50 dB** (voice clarity)
7. **Boost 4.8kHz Peak to +40 to +48 dB** (Android clarity on calls)
8. **Adjust Sustain Max Gain to 240** (smooth anti-ducking)
9. **Fine-tune Limiter Ceiling if distorting** (reduce from +1.5 to -1.0 dB)

---

## ⚠️ DISTORTION / CLIPPING FIX

If you hear crackling, popping, or distortion:

1. **Lower Saturation Drive** (7.0 → 5.0 → 2.5)
2. **Lower Saturation Intensity** (5.2 → 4.0 → 2.0)
3. **Lower Gain dB** (140 → 128 → 100)
4. **Reduce Limiter Ceiling** (-0.1 → -1.0 → -3.0)
5. **Lower Sustain Max Gain** (300 → 240 → 100)

If still distorted, switch to **Royal Clear** preset (safe mode).

---

## 🏗️ ARCHITECTURE

- **`core/injector.js`** — DSP pipeline + WebRTC hooks (32KB)
  - Multi-stage audio processing (high-pass → dual compressors → EQ → saturation → sustain → limiter)
  - Real-time track refresh & sender optimization
  - Raw microphone constraint enforcement
  
- **`content/loader.js`** — Extension injector (1.5KB)
  - Loads core engine at document start
  
- **`content/service.js`** — Config sync (2.7KB)
  - Storage listener + periodic config sync to injector
  
- **`popup/popup.html`** — UI (5.1KB)
  - 20+ real-time sliders
  - 3 preset buttons (Royal Clear, Lord V4, Ultra Quetta MAX)
  
- **`popup/popup.js`** — Control logic (6.4KB)
  - Storage persistence
  - Preset switching
  
- **`popup/popup.css`** — Styling (7.1KB)
  - Theme system (royal/lord/ultraQuetta)
  - Dark mode optimized

---

## 🖥️ WINDOWS SETUP (Chrome & Edge)

This is the same extension package used on PC and Android — Manifest V3
extensions are cross-platform by design, so there's no separate "Windows
build." Edge is Chromium-based and versions in lockstep with Chrome (Edge
109 ships the same engine as Chrome 109), so these steps work identically
in either browser; just swap the address bar URL.

1. **Download and unzip** the extension folder anywhere on disk (e.g.,
   `C:\Users\<you>\Documents\omni-messenger-hub`) — don't delete this
   folder afterward, Chrome/Edge loads the extension directly from it.
2. **Chrome:** go to `chrome://extensions`. **Edge:** go to
   `edge://extensions`.
3. Enable **Developer mode** (toggle, usually top-right).
4. Click **Load unpacked** → select the unzipped folder.
5. Open Facebook, Messenger, or Instagram and **reload the tab** (a tab
   that was already open before you loaded the extension won't have the
   content script yet).
6. Join a call, then click the toolbar icon to confirm the status shows
   **Active** — pin the icon (puzzle-piece icon → pin) if you don't see
   it in the toolbar.

### Two things Windows controls that no browser extension can reach

These aren't bugs in the extension — they're OS-level settings that sit
below what any browser extension's JavaScript is allowed to touch, so if
something still seems off after setup, check these first:

- **Windows microphone privacy permission.** Settings → Privacy & security
  → Microphone → make sure **"Let apps access your microphone"** is on,
  and that Chrome/Edge specifically is allowed. If this is off, Windows
  blocks the microphone before it ever reaches the browser, and no
  extension can override that.
- **Microphone "enhancements" at the driver level.** Windows Sound settings
  → your microphone → Properties → *Enhancements* (or *Advanced*) tab can
  have its own noise suppression / automatic gain control baked in by the
  audio driver, running *underneath* Chrome entirely. This extension's
  "Raw mic constraint lock" only controls what Chrome itself asks the
  microphone to do (`echoCancellation`/`noiseSuppression`/`autoGainControl`
  via `getUserMedia`); it has no way to reach a driver-level effect chain
  that sits underneath both the browser and the extension.

If you want the absolute rawest possible signal for this extension's own
DSP chain to work with, turning off any driver-level "enhancements" for
your microphone in Windows' own Sound settings is worth doing — but that's
a Windows setting to change yourself, not something this extension can
flip for you.

---

## 📱 ANDROID QUETTA SETUP

1. **Download extension ZIP** from GitHub
2. **Unpack to a local folder** (e.g., `/sdcard/Downloads/omni-messenger-hub`)
3. **Enable Developer Mode** on Quetta Browser
4. **Load Unpacked Extension** → select unpacked folder
5. **Open Facebook/Messenger/Instagram Web** in Quetta
6. **Reload the tab** (Ctrl+R or pull refresh)
7. **Join a call** — extension activates automatically
8. **Click extension icon** → select preset or adjust sliders
9. **Test with friend** — you should sound 500000x louder

---

## 🔧 TECHNICAL SPECS

| Parameter | Min | Default | Max | Unit |
|-----------|-----|---------|-----|------|
| Gain | 0 | 128.0 | 140 | dB |
| Loudness Trim | 0.5 | 1.6 | 500000 | x |
| Boost Ceiling | 1 | 500000 | 500000 | x |
| Saturation Drive | 0 | 5.0 | 20 | — |
| Saturation Intensity | 0.5 | 4.0 | 6.0 | — |
| Compressor Threshold | -100 | -82 | 0 | dB |
| Compressor Ratio | 1 | 20 | 20 | — |
| Compressor Attack | 0.00001 | 0.00003 | 1 | s |
| Presence EQ (3.2k) | -60 | +42 | +60 | dB |
| 5kHz Peak | -60 | +40 | +60 | dB |
| Limiter Ceiling | -24 | -0.1 | -0.1 | dB |
| Sustain Target | -24 | -6 | -1 | dB |
| Sustain Max Gain | 1 | 240 | 300 | — |
| Audio Bitrate (SDP) | — | 640 kbps | — | — |
| Sample Rate | — | 48 kHz | — | — |

---

## 🔬 Why "make it 2x louder" isn't just bigger numbers

Gain (140 dB) and Boost Ceiling (500000x) are already at their hard
maximums in Ultra Quetta MAX — the sliders physically cannot go higher.
Pushing them further wouldn't do anything anyway: every preset's output
runs through a final limiter whose whole job is to hold the signal at a
fixed, safe ceiling (-0.1 dB, essentially full digital scale) no matter
how much gain arrives before it. Once the pre-limiter signal is already
enormously over that ceiling — which it already is by design — adding
*more* upstream gain changes the final output by a fraction of a
decibel, completely inaudible. Going any higher than -0.1 dB would mean
actual digital clipping, which is the one thing this whole project has
been built to avoid.

So "louder" has to come from somewhere else: **Apex Overdrive** gets
there by tightening the compressor (lower threshold, wider knee) so the
signal sits closer to the ceiling more of the time, pushing the presence/
clarity EQ further (louder *and* clearer, since boosting 2-5kHz is both —
human hearing is most sensitive there), increasing drive/saturation for
more perceived loudness at the same peak level, and fixing a real bug
found along the way: the sustain ("anti-duck") target was calibrated to
an unreachable value (+12 dB on a signal that's capped at -0.1 dB), so it
sat permanently maxed instead of adaptively lifting quiet moments. Fixed
across all four presets — Apex Overdrive's target (-1 dB) is the most
persistent of the four.

---

## 🛠️ v4.5.1 fixes

This build fixes the intermittent drop-out/quiet-after-joining issue and a
handful of smaller bugs found during a full audit, without changing any
DSP values, presets, or ranges above. Full explanation of each fix,
including the root cause of the drop-out issue, is in **`CHANGES.md`**.

---

## 📝 NOTES

- **No remote calls or data transmission** — 100% local processing
- **Android Quetta optimized** — WebRTC hooks work best on Quetta/Chromium
- **Extreme settings = extreme volume + potential distortion** — use Royal Clear if overwhelmed
- **Best on calls with good mic hardware** — cheap mics will sound cheap, just louder
- **Profile version: 9** — auto-upgrades from v8 with new 500000x defaults

---

## ✨ Credits

Developed by **Omni**. For personal use on Messenger, Instagram, and Facebook calls.
