[REPLACED normalizeConstraints]
function normalizeConstraints(constraints) {
  // Default to requesting audio when no constraints provided
  if (!constraints) constraints = { audio: true };

  // If the page provided explicit constraints and we're not forcing raw mic,
  // respect the page's intent.
  if (!cfg().forceRawMic && (!constraints || typeof constraints !== 'object')) return constraints;

  // Make a shallow copy so we don't mutate the page object.
  const next = { ...constraints };

  // If page asked audio: true, convert to an object so we can augment it
  if (next.audio === true) next.audio = {};
  // If audio is still not an object (e.g., false), return as-is
  if (typeof next.audio !== 'object') return next;

  // Apply our raw-mic preference (clears/overrides browser processing flags)
  next.audio = rawMicAudioConstraints(next.audio);

  // If the user saved a deviceId via the popup, prefer it when the page
  // hasn't already specified a deviceId (exact or ideal).
  try {
    const userDeviceId = cfg()?.deviceId;
    if (userDeviceId && typeof userDeviceId === 'string' && userDeviceId.length) {
      const hasDeviceConstraint =
        next.audio.deviceId ||
        (next.audio.advanced && Array.isArray(next.audio.advanced) && next.audio.advanced.some(a => a.deviceId));
      if (!hasDeviceConstraint) {
        // Request the selected device exactly. If this fails due to site
        // policy or permission, the normal getUserMedia fallback will run.
        next.audio.deviceId = { exact: String(userDeviceId) };
      }
    }
  } catch (_) {
    // Swallow errors here — this is a best-effort preference.
  }

  return next;
}
