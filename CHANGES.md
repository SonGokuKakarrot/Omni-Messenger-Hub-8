# CHANGES.md — Audit of your actual source (v4.4.0 → Omni-Messenger-Hub v4.5.0)

This audit is based entirely on the 9 files you uploaded — not a
reconstruction. Every function name, config field, and line number below
refers to your real code. Nothing about the DSP chain, preset values,
slider ranges, or overall architecture was changed; every fix below is
either a correctness bug or a resource-usage issue.

## Root cause of the intermittent drop-out / "loud for 10-15s then quiet"

**`patchPeerConnectionPaths()` — defined, 190 lines, never called.**

`core/injector.js` has a complete, carefully-designed system for keeping
the processed mic track attached to every sender: `addTrack`/
`addTransceiver`/`addStream` interception, a patched `RTCRtpSender.
replaceTrack`, SDP bitrate hints, late-join detection (`state.
peerConnections.size > 1` → `activateAggressiveRecovery()`), mute/ended
track watching, and a self-healing `reconcileLiveSenders()` pass. All of
it is correct. **None of it was ever running**, because the one line that
wires it up — `patchPeerConnectionPaths();` — was missing. I checked this
three ways (grep, occurrence count, searching for indirect references):
the function is defined once and referenced zero times anywhere else in
the file.

With only `getUserMedia` active (which *was* running), here's what
actually happened: the very first mic track a call uses comes back from
`getUserMedia()` already processed, so a call sounds loud and correct from
the first second. But the moment the page calls `sender.replaceTrack()`
directly on an *existing* sender — which is exactly what happens during
the renegotiation triggered when someone else joins an existing group
call — that call went through the **original, unpatched** `replaceTrack`,
silently handing the raw, unprocessed mic straight to the peer. No error,
no event your code was listening for, because it wasn't listening to
anything at all. This matches your reported symptom (loud at first, drops
significantly after some seconds, especially around other people joining)
more precisely than any other issue in the file.

**Fix:** added the missing call. Confirmed by test: creating a second
`RTCPeerConnection` (simulating a late join) now correctly logs `"[Omni]
Aggressive recovery activated for late-join scenario"` — a message that
was in your code the whole time but could never fire.

## Everything else found and fixed, file by file

### core/injector.js

- **`setRemoteDescription` was rewriting the SDP the far end/SFU actually
  sent you.** Bitrate/DTX hints only affect your own outgoing encoder when
  applied to a description *you* send (your offer/answer) — mutating what
  the browser thinks the remote side sent doesn't raise your bitrate, and
  risks the browser's negotiation state and the page's own signaling
  bookkeeping disagreeing about what was actually received. Renegotiation
  (a late join) is the single most likely moment for that kind of mismatch
  to surface. Removed the SDP rewrite from this path; kept the peer
  connection bookkeeping and the post-set recovery pass it also triggers.
- **The bitrate-line rewrite (`b=AS`/`b=TIAS`) had no section boundary.**
  It was a global regex matching those tokens anywhere in the SDP. On any
  call that also negotiates video, this would rewrite the *video* track's
  bandwidth line down to the audio figure too — degrading video as a side
  effect of a mic extension. Rewrote it to only touch lines between
  `m=audio` and the next `m=` line. Verified with a synthetic audio+video
  SDP: the video section's `b=AS:2000` now survives byte-for-byte.
- **The "Sender Refresh" slider stopped working after the page loaded.**
  The health-check interval read `cfg().senderRefreshMs` exactly once, at
  the moment the interval was first created, to compute its own delay.
  Moving the slider afterward changed the stored config but had zero
  effect on the already-running interval. Extracted the interval body
  into `runHealthCheck()` and added `restartHealthCheckInterval()`, called
  every time a new config arrives (same pattern already used for
  `scheduleRecoveryPasses()`). Verified: the interval is now provably
  cleared and rebuilt with the new value on a live config change.
- **Two sliders had zero effect on the audio.** `presencePeakFreq` and
  `presencePeakQ` are real, correctly-clamped config fields, present in
  every preset — but `applyPipeline()` only ever updated `presencePeak.
  gain`, never `.frequency` or `.Q`. The "5kHz Peak Freq"/"5kHz Peak Q"
  sliders moved, saved, and did nothing. Both are now wired up.
- **The "Raw mic constraint lock" toggle didn't fully work.**
  `normalizeConstraints()` — used on every `getUserMedia()` call — forced
  echo cancellation/noise suppression/AGC off unconditionally, regardless
  of the `forceRawMic` config value. The *post-acquisition* enforcement
  (`enforceRawMicTrack`, the `applyConstraints` patch) already correctly
  checked the toggle; this earlier, more impactful call site did not.
  Turning the toggle off in the popup never actually let Chrome's native
  AEC/NS/AGC through at the point it matters most. Gated it the same way
  the rest of the file does.
- **Possible duplicate DSP pipeline on the same physical mic input.**
  `build()` is called directly (bypassing the existing `processAudioTrack`
  dedup check) from two places: the `getUserMedia` hook and the `addStream`
  patch. Neither recorded a raw→processed mapping in `state.trackMap` —
  only `processAudioTrack`'s own fallback path did. If the host page ever
  grabbed the *original* raw track object (not the processed one
  `getUserMedia` returned) and passed it to `addTrack`/`addTransceiver`
  directly, your extension would spin up a second, independent
  `AudioContext` graph on the same input — doubling CPU/battery use for no
  benefit, since only one output actually reaches the peer. Fixed by
  registering the mapping inside `build()` itself, covering every current
  and future caller in one place. Verified: attaching the exact track
  `getUserMedia` returned via `addTrack` now builds zero additional
  pipelines.
- **`addStream` (legacy API) didn't use the double-processing guard.**
  Unlike `addTrack`/`addTransceiver`, it called `build()` directly and
  unconditionally. Routed it through `processAudioTrack` for consistency;
  it now benefits from the same dedup logic as the other two attachment
  paths.
- Wired the existing `AUDIO_SEND_MAX_BITRATE` constant into the SDP
  rewrite instead of separate hardcoded `640000`/`640` literals, so the
  two can never drift apart if the bitrate is ever changed later.

### popup/popup.js

- **A real read-modify-write race.** `onControlInput`/`onCheckboxChange`
  each re-read the *entire* config from `chrome.storage.local`, patched
  one field, and wrote it back — on every single `input` event, which a
  dragged slider fires many times per second. Two of these cycles can
  overlap (both async): the second can read a snapshot from before the
  first one's write has landed, then write it back, silently discarding
  the first change. Rapid adjustments (drag a slider, then immediately
  flip a checkbox) could lose whichever update's write happened to land
  first. Replaced with a single in-memory config object that every handler
  mutates directly and synchronously — nothing left to race — with the
  actual storage write debounced to ~120ms after the last change instead
  of one write per tick. This also directly reduces CPU/storage I/O during
  a drag, which you explicitly asked me to look for.
- Hoisted the `controls` array, which was written out twice, verbatim, in
  two different functions — a silent-drift risk where adding a new slider
  to one copy but not the other would desync them. Zero behavior change.
- **Toggling the master on/off switch broke preset highlighting.** Preset
  matching compared every config key, including `enabled`. Turning
  processing off (a feature that already existed in your popup) made the
  UI immediately look like an unnamed "custom" profile even though every
  DSP value still exactly matched your chosen preset. Excluded `enabled`/
  `profileVersion` from the identity check — a preset's identity is its
  sound, not whether processing is currently paused.

### popup/popup.html

- **Added the missing "Compressor Knee" slider.** `knee` was already a
  real, fully wired config field — present in `DEFAULTS`, all three
  presets, and popup.js's control list — it simply had no HTML element, so
  it was silently unreachable from the UI even though the feature itself
  has always worked. Range (0–40dB) and default (20) match the code's own
  clamp exactly.

### content/loader.js

- **An eternal `setInterval` that never stopped.** The `MutationObserver`
  correctly disconnects itself once injection is confirmed, but the
  `setInterval` right below it didn't — it kept firing every 2.5s for the
  entire lifetime of the tab, even hours into a long call or a Messenger
  tab left open in the background all day. Each tick was cheap, but there
  was no reason to keep it running at all once its job was done. Both
  watchers now share one teardown.

### manifest.json / branding

- Renamed to **Omni-Messenger-Hub** as requested (`name`, `short_name`,
  `action.default_title`, description). Preset names — Royal Clear, Lord
  V4, Ultra Quetta — are untouched everywhere, including inside the
  popup UI itself; those are a feature you asked me to preserve, not the
  product name.
- Added an `icons`/`action.default_icon` set (16/32/48/128) — previously
  absent, so Chrome showed a generic default icon. Purely cosmetic, zero
  functional risk.
- Version bumped to 4.5.0.
- `README.md`'s own technical-specs table listed a stale Limiter Ceiling
  range (documented default +1.5dB, max +2dB) that the *code* had already
  moved past — the actual, currently-enforced clamp in `injector.js` is
  -24dB to -0.1dB, with a -0.1dB default. The code was already safe; only
  the documentation was stale. Fixed the table and a related "distortion
  fix" suggestion elsewhere in the README that referenced an unreachable
  starting value (1.8dB) under the real clamp.

## What was intentionally left alone

- Every DSP value, every preset's numbers, every slider's range, the
  signal chain order, the 640kbps/48kHz targets, the reverb/keep-alive/
  sustain design — all unchanged. Your loudness engineering is exactly as
  you built it.
- `background.js`'s `tabs` permission and its periodic tab sweep, the
  dual callback/promise handling in `queryActiveTab` (deliberate
  Chrome/Firefox compatibility, not a bug), and the aggressive-recovery
  timing tables in `injector.js` — all read carefully, all already
  correct, none touched.
- One thing I found but deliberately did *not* change: in the patched
  `replaceTrack`, calling `sender.replaceTrack(null)` (some WebRTC apps
  use this as a mute mechanism instead of `track.enabled = false`)
  triggers a delayed re-attach of a processed track. I can't confirm
  whether Messenger's own code ever actually uses `replaceTrack(null)`
  for muting, and reversing this without being sure risks fighting a
  legitimate mute path. Flagging it here rather than guessing.

## popup/popup.css — visual enhancement pass

A follow-up appearance-only pass, requested separately. Every class,
attribute, and id the JS reads (`.preset`/`.royal`/`.lord`/
`.ultraQuetta`/`.active`, `.status`/`.ok`/`.warn`, `.switch`/`.slider`,
`.field`, `.checkField`, every control id) is unchanged — confirmed by
re-running the full functional test suite and a control-id cross-check
after the edit, both still 100% clean.

- **Sliders now show an accurate fill level.** The previous CSS put a
  fixed, full-width gradient on every range input regardless of its
  actual value, so a slider at 5% and one at 95% looked visually
  identical — only the thumb position (which the browser draws
  natively) told the true story. Rewrote the track using
  `-webkit-appearance: none` plus custom `::-webkit-slider-thumb`/
  `::-webkit-slider-runnable-track` styling (the standard, reliable way
  to do this in Chromium) with a `--fill` custom property that now
  actually reflects the current value. This needed one small,
  purely-cosmetic addition in `popup.js`: an `updateFill()` helper called
  whenever a slider's value is set (on load, on preset apply, and on every
  drag tick) — it doesn't touch config, storage, or anything audio-related.
- **Numeric readouts now use a tabular monospace treatment** (small "LCD
  display" style: recessed background, glow, tabular-nums) instead of
  plain UI type, so all 22 differently-formatted values (dB, x, ms, s)
  read like a real instrument display and line up cleanly.
- **Added a fourth, deliberate "custom" identity** (cool silver-violet)
  for whenever your current values don't match a named preset. Previously
  this state silently fell back to reusing Lord V4's gold, which looked
  like an unfinished/default state rather than an intentional one.
- **Five subtle section labels** (Gain & Loudness / Drive & Dynamics /
  Equalizer / Locks & Sustain / Ambience & Timing) now break up the list
  of 22 sliders, implemented via CSS `:has()` anchored to existing field
  ids — no HTML reordering, so this can't affect functionality even if
  it ever needs adjusting later.
- Checkboxes (sustain/raw-mic/reverb/keep-alive locks) restyled as small
  toggle switches matching the header's main power switch, so every
  on/off control in the popup now reads as one consistent family instead
  of looking like two different UI kits.
- Added a small live-status pulse dot next to the hook-status text
  (respects `prefers-reduced-motion`), refined the preset card gradients
  and shadows, and tightened up spacing/contrast throughout.
- Royal Clear (green), Lord V4 (gold), and Ultra Quetta (cyan) — the
  colors themselves are unchanged from your existing design; this pass
  refined shade/contrast/glow around them, not the hues.

## Murgi Kheko Voice Gang branding

Integrated your uploaded crest artwork as the popup's permanent brand
identity, on top of the console redesign above.

- **Header logo.** The crest (cropped tightly from your original image,
  transparency preserved) now sits in the header next to the title.
  Colors for the surrounding chrome — panel background, borders, the
  default/no-preset-match accent, dividers — were sampled directly from
  the artwork's actual pixels (deep maroon `#300c18`–`#6b2436`, aged
  pewter/rose-silver `#8c7672`–`#d8c9bd`), not eyeballed, so the frame
  reads as one consistent object with the logo rather than a picture
  pasted onto an unrelated UI.
- **Background watermark.** A second, pre-blurred and pre-baked-to-16%-
  opacity copy of the crest sits behind the header via `mix-blend-mode:
  screen`, for a subtle "etched into the panel" texture rather than a
  second competing logo. Pre-blurring and baking the opacity into the
  PNG itself (rather than doing it live via CSS `opacity`/`filter`) keeps
  this to one lightweight static asset with no runtime cost.
- **Royal/Lord/Ultra Quetta keep their own functional colors exactly as
  before** — the brand palette only replaces the base "custom" state and
  the always-on frame elements (panel border, dividers, default glow), so
  you can still tell which preset is active by its color the same way you
  could before.
- **Toolbar icon recolored** to the same palette (deep maroon + pewter),
  keeping the existing simple bar-graph silhouette rather than shrinking
  the detailed crest artwork down to 16px — fine illustration detail
  reliably turns to mud at toolbar-icon sizes, so the safer choice was to
  match the *color language*, not attempt the full artwork in miniature.
- Added a few small ornamental touches tying back to the artwork's own
  frame-and-gemstone motif: a gradient hairline divider with a center
  diamond glyph below the header and below the preset section, small
  diamond bullets on the five control-group labels, and a "metal-plaque"
  double-shadow bevel on the preset cards.
- **Files added:** `popup/brand/murgi-kheko-crest.png` (the header logo)
  and `popup/brand/murgi-kheko-watermark.png` (the background texture),
  both derived from your uploaded image, cropped/processed locally —
  nothing was fetched from or sent to any external service.

## Follow-up: header overlap fix + bolder theme visibility

Two more targeted fixes, requested separately.

- **Real bug: the title was overlapping the power switch.** Measured the
  actual rendered layout rather than guessing — the "Omni Messenger Hub"
  heading's bounding box (x: 141→348px) and the power switch's bounding
  box (x: 309→365px) genuinely overlapped by ~39px, both in the same
  vertical band. Cause: the crest logo sitting beside the title left only
  ~176px for "Omni Messenger Hub" at 27px bold, forcing it to wrap across
  3 lines and grow tall enough to collide with the switch next to it.
  Restructured the header into two rows — the crest is now a full-width
  banner on its own row, with the title and switch on a second row below
  that has the full panel width to work with. Also added `min-width: 0`
  to the title's flex container, which is the standard fix for a flex
  item's text content refusing to shrink below its natural width and
  overflowing a sibling — belt-and-suspenders alongside the layout
  restructure. Verified with actual computed bounding boxes (not
  eyeballed): title/switch overlap is now false, and "Omni Messenger Hub"
  fits on a single line without truncating.
- **Theme made more visible.** The crest logo is ~6.7x larger on screen
  now (was 103×46px squeezed beside the title, now a proper 338×88px
  banner). More importantly, found that the *actual visible surface*
  (the panel's own background) wasn't tinted by the theme at all — only
  the mostly-hidden 10px margin ring around it was — which is the real
  reason the theme read as subtle regardless of any other tuning. Fixed
  the panel's own background to carry a visible accent tint, boosted the
  background gradient's color strength, and increased the watermark's
  baked-in opacity (16% → 30%) with less blur so it reads as the artwork
  itself rather than a vague glow.

## v4.5.1 — Windows verification pass

Worth being direct about scope here: a Manifest V3 extension is
cross-platform by construction — the same package already ran correctly
on Windows before this pass, since Chrome/Edge interpret the extension
identically regardless of host OS. There was no separate "Windows build"
to create. What this pass actually did:

- **Verified, didn't just assume, that the one OS-branching code path is
  correct on Windows.** `injector.js` picks faster recovery timing on
  Android/Quetta and slower, more conservative timing everywhere else
  (`isAndroidQuetta`, checked via `navigator.userAgent`). Confirmed a
  Windows Chrome/Edge user agent correctly resolves this to `false`.
  While auditing this specific path, hardened `cfg()` to always re-derive
  `isAndroidQuetta` fresh from the live user agent rather than trusting
  whatever value happens to flow through a stored/relayed config object —
  not a bug today (nothing currently persists this field), but this is
  the only OS-detection branch in the file, so making it self-verifying
  on every call is cheap, permanent insurance.
- **Added `minimum_chrome_version: "109"`** to the manifest for clarity —
  applies identically to Edge, since Edge versions its Chromium engine in
  lockstep with Chrome (Edge 109 ships the same engine as Chrome 109).
- **Added a dedicated Windows setup section to README.md** covering both
  Chrome and Edge (Edge specifically, since it's the browser Windows
  actually ships with), plus clear documentation of the two things that
  are genuinely Windows OS-level and outside any extension's reach: the
  Windows microphone privacy toggle, and driver-level microphone
  "enhancements" (noise suppression/AGC baked in below Chrome itself,
  which `getUserMedia` constraints cannot see or control). Both are
  explained as settings the person can change themselves, not something
  the extension can or should try to override.
- **Rebalanced the README's framing**, which read as Android/Quetta-first
  ("Now with 500000x MAX Profile for Android Quetta Browser!") in a way
  that could make Windows support look secondary, even though it's the
  identical package and DSP engine on both.
- Full regression re-run after every change: all JS syntax-checked, the
  complete 23-test functional suite (WebRTC hooks, SDP handling, config
  reactivity) still passing, manifest validated with every referenced
  file confirmed present.

## v4.5.2 — Repeat-drop-out hardening (PC-hosted multi-account calls)

**Being direct about what this section can and can't claim.** The
reported pattern — brief audio, then silence for 5–10s, repeating,
specifically when joining a call a PC (running several accounts) got to
first, but *not* when joining a call an Android device got to first with
even more accounts on it — depends on how Facebook/Messenger's own
server-side call infrastructure (their SFU) treats different call
topologies. I don't have visibility into that server-side behavior, and
I have no way to reproduce a live multi-account PC-hosted Messenger call
from here to test against directly. I'm not going to claim a definitive
root-cause fix I can't actually verify — that would be exactly the kind
of false confidence this project has been trying to avoid throughout.

What I did do: re-read every recovery/reconciliation function in the file
line by line specifically looking for any way *our own code* could be
contributing to or amplifying a repeating interruption, regardless of
what originally triggers it on Facebook's side.

- **Real gap found: no rate limit on sender refresh.** `queueSenderRefresh`
  had a guard against two refreshes overlapping *while one was already in
  flight*, but nothing stopping the same sender from being refreshed
  again and again over time if something kept flagging it. Every actual
  `replaceTrack()` call carries some risk of a brief glitch while the far
  end/SFU re-syncs to the new track — so if anything in a complex,
  high-churn call topology (more renegotiation activity, more mute/unmute
  events, whatever Facebook's own PC-hosted-multi-account handling looks
  like server-side) keeps flagging the same sender every few seconds, our
  own recovery logic would faithfully replace the track every single
  time, potentially adding its own churn on top of whatever's already
  happening. Added a 4-second cooldown — but **only** for the "maybe
  needs it" case (a mute event, a periodic reconciliation pass finding
  something ambiguous). A genuine disconnection (the track is missing, or
  its own `readyState` is `'ended'`) always bypasses the cooldown and
  gets fixed immediately, since rate-limiting a real recovery would make
  things worse, not better. Verified with a real behavioral test (not
  just code-reading): an anomaly that keeps recurring every ~900ms only
  gets fixed once within the 4s window, and is still fixed again once the
  window passes — not a permanent lockout, just a limit on how often we
  react.
- **Added diagnostic logging** (filter DevTools → Console for "[Omni]"):
  every time a PeerConnection is registered, every time late-join/
  aggressive-recovery activates, and every time a sender is actually
  refreshed or a refresh is skipped by the cooldown, with a reason. This
  is specifically so that *if this happens again*, there's actual evidence
  to look at — how many PeerConnections existed, when recovery activated,
  how often the sender was actually being replaced — instead of both of
  us reasoning from a symptom description alone. The logger is itself
  rate-limited to one line per 2 seconds no matter what, so it can never
  become a spam or performance problem in its own right.
- **Checked the keep-alive tone** (meant to stop an SFU's voice-activity
  detection from treating a quiet moment as "nothing to forward") —
  correctly implemented, roughly -57dBFS, no issue found there.
- **Hardened, not weakened:** the SDP bitrate/DTX hints (`usedtx=0`,
  640kbps) were a candidate suspect — a sustained high-bitrate request
  could plausibly interact with an SFU's own resource-fairness logic
  differently across call topologies — but I found no concrete evidence
  implicating them specifically, and weakening them would reduce the
  loudness/quality this extension exists to maximize. Left unchanged.

If this happens again: opening DevTools on the call tab (F12 → Console,
filter "Omni") before/during the next occurrence and sharing what it logs
would turn this from a symptom description into an actual diagnosis.

## v4.6.0 — "Twice as loud" + a real sustain bug found along the way

**The honest math first.** Gain (140dB) and Boost Ceiling (500000x) are
already at their hard maximums in Ultra Quetta MAX — physically cannot go
higher. And it wouldn't matter if they could: every preset's output runs
through a final limiter that holds the signal at a fixed ceiling (-0.1dB)
regardless of how much gain arrives before it. Verified this numerically,
not just asserted it: pushing the pre-limiter gain up by another 0.9dB
(the difference between Ultra Quetta's and a maxed-out theoretical
preset's upstream gain) changes the actual limited output by **0.046dB**
— inaudible. Doubling the raw gain numbers further would have done
nothing except make the limiter work harder for zero audible benefit.

- **Real bug found and fixed: the sustain ("anti-duck") target was
  unreachable.** It's measured on the signal *after* the limiter, whose
  ceiling is -0.1dB — but the default target was **+12dB**, and all three
  existing presets used similarly-impossible positive values (Royal=5,
  Lord=7, Ultra=12). Since the post-limiter signal can never reach a
  positive dB value, the "is it currently quiet, lift it" condition was
  permanently true, so the mechanism sat pinned at maximum gain 24/7
  instead of adaptively responding to actual quiet moments. Not unsafe —
  the limiter downstream still caught everything — but not doing its
  actual job either. Recalibrated the clamp range and all four presets'
  values to genuinely achievable targets, preserving each preset's
  relative aggressiveness (Royal gentlest → Apex most persistent).
- **New preset: Apex Overdrive.** The honest answer to "louder": tightens
  the fixed glue compressor (threshold -8→-10dB, ratio 14→16) and limiter
  release (8ms→6ms) for a signal that sits closer to the ceiling more
  consistently, pushes presence/clarity EQ further (+56dB vs Ultra's
  +48dB — louder *and* clearer, since 2-5kHz boosts both), increases
  drive/saturation, and uses the now-fixed sustain target most
  aggressively (-1dB). Reverb is turned *down* from Ultra Quetta's
  default, not up — a more reverberant signal reads as farther away,
  working against perceived loudness. These compressor/limiter timing
  changes benefit all four presets, not just the new one.
- Verified with real numbers, not just code review: a test suite addition
  confirms the actual `DynamicsCompressorNode` values in a constructed
  pipeline match the new tightened settings, and confirms the limiter
  threshold stays safely clamped even when a config payload requests an
  unsafe value above 0dB.
- **Dropout issue:** no new diagnostic evidence was available this round
  to act on beyond what v4.5.2 already hardened (the sender-refresh
  cooldown and diagnostic logging). That hardening is unrelated to and
  unaffected by this round's DSP/loudness changes — confirmed via the
  full existing test suite still passing (32/32) after these changes.

## v4.6.1 — Fixed a real "clarity" bug the simulation caught

When asked directly whether Apex Overdrive would actually sound clear, I
didn't want to just reassure — I simulated the exact filter math from the
code (Web Audio's own peaking-EQ formula) instead of guessing. It found a
real, measurable problem, not a stylistic one:

- **The presence/clarity EQ boosts were narrow resonant spikes, not
  broad tonal lifts — in three of the four presets, not just Apex.**
  Measured the actual -3dB bandwidth of each preset's presence filters:
  Royal Clear's boost (+8dB) was ~2300Hz wide — genuinely broad, reads as
  a natural tonal tilt. Lord V4's (+24dB) was ~410Hz wide. Ultra Quetta's
  (+48dB) was ~110Hz wide. Apex Overdrive's (+56dB) was ~80Hz wide — at
  that width, a boost this tall behaves like a resonant whistle/ring at
  one specific frequency, not a clarity enhancement, regardless of how
  the rest of the chain is tuned. This was already present in Ultra
  Quetta before any of this round's changes; Apex Overdrive's higher gain
  just made an existing problem more pronounced.
- **Fixed by lowering both the gain AND the Q on the three affected
  presets** (Lord: 24dB/Q2.0 → 12dB/Q1.1, Ultra: 48dB/Q3.4 → 13dB/Q1.0,
  Apex: 56dB/Q3.4 → 14dB/Q0.9) — tested several combinations before
  landing here; lowering Q alone wasn't enough on its own, since at these
  gain levels even a "moderate" Q still produces a narrow spike. Verified
  against the actual committed values: all four presets now measure
  800Hz+ wide, none narrower than Royal Clear's already-fine boost.
- Also measured actual harmonic distortion (THD) from the saturation
  stage while investigating: ~35% for Royal Clear, ~41% for both Ultra
  Quetta and Apex Overdrive (the difference between those two is
  negligible — confirms the saturator was already deep in its saturated
  region at Ultra Quetta's settings, consistent with the limiter-ceiling
  math from the previous round). This is a real, disclosed characteristic
  of how extreme these presets are by design, not something this pass
  changed or could meaningfully change without dialing back the drive
  settings that give these presets their character.

## Verification

- Every file re-checked with `node --check` after every edit.
- `manifest.json` validated as JSON, and every file path it references
  (background, popup, content scripts, web-accessible resources, icons)
  confirmed to actually exist.
- Built a mocked WebRTC + Web Audio environment matching every API your
  real `injector.js` actually calls (verified against the source, not
  assumed), and ran your *actual, patched* file through it: 23 functional
  checks, all passing, covering every fix above — including a live
  confirmation that late-join detection now genuinely fires.
- Cross-checked that every control/checkbox ID `popup.js` expects has a
  matching element in `popup.html` (this is what caught the missing
  `knee` slider in the first place).
