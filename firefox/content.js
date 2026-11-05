// This file in chrome/ and firefox/ must be kept in sync.
// Keyboard seek for video playback
// (Netflix / Disney+ / Peacock / Prime Video / Tubi / Coupang Play / YouTube)
// Runs in isolated world — guaranteed to load before page scripts,
// so we receive key events before the player can intercept them.
//
// Key → offset (seconds). Uses e.code so it works regardless of keyboard layout.
const KEY_OFFSETS = {
  ArrowLeft: -5,
  ArrowRight: 5,
  BracketLeft: -3,   // [
  BracketRight: 3,   // ]
  KeyZ: -3,          // z
  KeyX: 3,           // x
};

function isYouTubeHost() {
  const host = location.hostname;
  return host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com');
}

function isTyping(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// Recursively collect video elements hidden inside shadow DOM
function collectVideos(root, out) {
  root.querySelectorAll('video').forEach(v => out.push(v));
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) collectVideos(el.shadowRoot, out);
  });
}

// Disney+ has a hidden stub video alongside the real one. Touching the stub
// pauses playback, so we only consider videos that are actually decoding
// (readyState > 2), have a source, and are visible on screen — then pick
// the main feature (longest duration).
function findVideo() {
  const all = [];
  collectVideos(document, all);
  const candidates = all.filter(v =>
    v.readyState > 2 &&
    v.currentSrc &&
    v.duration > 0 &&
    getComputedStyle(v).display !== 'none' &&
    v.offsetWidth > 0
  );
  if (candidates.length === 0) return null;
  const playing = candidates.filter(v => !v.paused);
  const pool = playing.length ? playing : candidates;
  return pool.reduce((a, b) => (b.duration > a.duration ? b : a));
}

// Accumulate rapid key presses: if the previous seek hasn't finished yet
// (video.seeking), stack relative to its target (-5, -5 → -10).
// If the seek already completed, playback has advanced, so base off the
// actual currentTime instead.
let pendingTarget = null;
let pendingAt = 0;
let watchdog = null;

function seekVideo(offsetSec) {
  const video = findVideo();
  if (!video) return false;

  const max = isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
  const stacking =
    pendingTarget !== null && video.seeking && performance.now() - pendingAt < 2000;
  const base = stacking ? pendingTarget : video.currentTime;
  const target = Math.max(0, Math.min(max - 0.5, base + offsetSec));
  pendingTarget = target;
  pendingAt = performance.now();

  video.currentTime = target;
  guardStall(video, target);
  return true;
}

// When the player renders subtitles via native TextTrack, a seek can leave
// stale cues. Toggle the track mode to force the cue list to recalculate.
function resyncTextTracks(video) {
  const tracks = video.textTracks;
  if (!tracks) return;
  for (const t of tracks) {
    if (t.mode === 'showing') {
      t.mode = 'hidden';
      t.mode = 'showing';
    }
  }
}

// MSE players can stall when seeking into an unbuffered region — they fail to
// refetch segments. If the seek doesn't settle, retry once, then wake playback.
function guardStall(video, target) {
  clearTimeout(watchdog);
  const settled = () => {
    clearTimeout(watchdog);
    video.removeEventListener('seeked', settled);
    resyncTextTracks(video);
  };
  video.addEventListener('seeked', settled);

  watchdog = setTimeout(() => {
    video.removeEventListener('seeked', settled);
    if (video.readyState >= 3 && !video.seeking) return;
    // Seeking the same spot again prompts the player to refetch segments
    video.currentTime = target + 0.01;
    setTimeout(() => {
      if (video.paused) video.play().catch(() => {});
    }, 800);
  }, 1200);
}

// Briefly show the seek offset on screen (e.g., "◀ 5s / 3s ▶")
let toastEl = null;
let toastTimer = null;
function showToast(offsetSec) {
  if (!document.body) return;
  if (!toastEl || !toastEl.isConnected) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = [
      'position:fixed', 'top:12%', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'padding:10px 22px', 'border-radius:8px',
      'background:rgba(0,0,0,0.65)', 'color:#fff',
      'font:600 22px/1.2 sans-serif', 'pointer-events:none',
      'transition:opacity 0.2s', 'opacity:0'
    ].join(';');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = offsetSec < 0 ? `◀ ${-offsetSec}s` : `${offsetSec}s ▶`;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 600);
}

// We must block keyup/keypress too for keys we handled.
// Some players trigger their own skip on keyup, causing double-seek.
const swallowedKeys = new Set();

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (isTyping(e.target)) return;
  const offset = KEY_OFFSETS[e.code];
  if (offset === undefined) return;

  // YouTube already seeks 5s on arrow keys. stopImmediatePropagation in
  // isolated world doesn't stop page handlers, so handling arrows would
  // cause double-seek (5s + 5s). On YouTube we only handle [ / ] for 3s.
  if (isYouTubeHost() && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;

  // Ignore auto-repeat while holding a key — prevents dozens of seeks/sec
  if (e.repeat) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  let handled;
  if (location.hostname.endsWith('netflix.com')) {
    // Netflix only works on watch pages (/watch). The actual seek is
    // performed by netflix_main.js in the page context via internal APIs.
    handled = location.pathname.startsWith('/watch');
    if (handled) window.postMessage({ type: 'SEEKSTEP', offsetSec: offset }, '*');
  } else {
    handled = seekVideo(offset);
  }

  // Only block default behavior (player skip, page navigation) on success
  if (handled) {
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowedKeys.add(e.code);
    showToast(offset);
  }
}, true);

for (const type of ['keyup', 'keypress']) {
  window.addEventListener(type, (e) => {
    if (!swallowedKeys.has(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (type === 'keyup') swallowedKeys.delete(e.code);
  }, true);
}
