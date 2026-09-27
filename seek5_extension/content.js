// 키보드로 영상 위치 이동
// (Netflix / Disney+ / Peacock / Prime Video / Tubi / Coupang Play / YouTube)
// isolated world에서 실행 — 페이지 스크립트보다 먼저 로드되는 것이 보장되므로
// 플레이어가 키 이벤트를 가로채기 전에 우리가 먼저 받는다.
//
// 키 → 이동량(초). e.code 기준이라 한/영 입력 상태와 무관하게 동작한다.
const KEY_OFFSETS = {
  ArrowLeft: -5,
  ArrowRight: 5,
  BracketLeft: -3,   // [
  BracketRight: 3,   // ]
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

// shadow DOM 안에 숨어 있는 video 엘리먼트까지 재귀적으로 수집
function collectVideos(root, out) {
  root.querySelectorAll('video').forEach(v => out.push(v));
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) collectVideos(el.shadowRoot, out);
  });
}

// 디즈니플러스에는 숨겨진 스텁 video가 함께 존재한다. 스텁을 건드리면
// 재생이 멈추므로, 실제로 디코딩 중이고(readyState > 2) 소스가 있으며
// 화면에 보이는 것만 후보로 삼고 그중 본편(가장 긴 것)을 고른다.
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

// 연속 입력 누적: 앞선 이동이 아직 끝나지 않았을 때만(video.seeking)
// 그 목표 지점을 기준으로 쌓는다 (-5, -5 → -10).
// 이동이 이미 끝났다면 그 사이 재생이 진행됐으므로 반드시 실제 위치를 기준으로 삼는다.
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

// 플레이어가 자막을 native TextTrack으로 렌더링하는 경우, seek 후에도
// 이전 큐가 남아 자막이 어긋날 수 있다. 트랙을 껐다 켜서 큐 목록을 다시 계산시킨다.
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

// MSE 플레이어는 버퍼가 비워진 지점으로 이동하면 데이터를 다시 받아오지 못한 채
// 멈추는 경우가 있다. 이동이 완료되지 않으면 재시도하고, 그래도 안 되면 재생을 깨운다.
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
    // 같은 지점으로 한 번 더 seek하면 플레이어가 세그먼트를 다시 요청한다
    video.currentTime = target + 0.01;
    setTimeout(() => {
      if (video.paused) video.play().catch(() => {});
    }, 800);
  }, 1200);
}

// 화면에 "◀ 5초 / 3초 ▶" 같은 이동량을 잠깐 표시
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
  toastEl.textContent = offsetSec < 0 ? `◀ ${-offsetSec}초` : `${offsetSec}초 ▶`;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 600);
}

// 우리가 처리한 키는 keyup/keypress까지 전부 차단해야 한다.
// 플레이어가 keydown이 아닌 keyup에서 자체 스킵을 실행하면 이중으로 이동하기 때문.
const swallowedKeys = new Set();

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (isTyping(e.target)) return;
  const offset = KEY_OFFSETS[e.code];
  if (offset === undefined) return;

  // YouTube는 이미 화살표로 5초 이동한다. isolated world의 stopImmediatePropagation은
  // 페이지 핸들러를 막지 못해서, 화살표까지 처리하면 5초+5초로 이중 이동한다.
  // YouTube에서는 [ / ] 3초만 맡는다.
  if (isYouTubeHost() && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;

  // 키를 누르고 있을 때의 자동 반복은 무시 — 초당 수십 번 seek가 쌓이는 것을 막는다
  if (e.repeat) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  let handled;
  if (location.hostname.endsWith('netflix.com')) {
    // 넷플릭스는 재생 페이지(/watch)에서만 동작. 실제 seek는
    // 페이지 컨텍스트의 netflix_main.js가 내부 API로 수행한다.
    handled = location.pathname.startsWith('/watch');
    if (handled) window.postMessage({ type: 'SEEK5_EXT', offsetSec: offset }, '*');
  } else {
    handled = seekVideo(offset);
  }

  // 성공했을 때만 기본 동작(자체 스킵, 페이지 탐색)을 막는다
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
