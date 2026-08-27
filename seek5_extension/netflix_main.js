// 넷플릭스 전용 — 페이지 컨텍스트(MAIN world)에서 실행.
// video.currentTime을 직접 바꾸면 넷플릭스 플레이어가 깨지므로 내부 API로 seek한다.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.type !== 'SEEK5_EXT') return;
  try {
    const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const ids = vp.getAllPlayerSessionIds();
    const id = ids.find(s => s.startsWith('watch')) || ids[0];
    if (!id) return;
    const player = vp.getVideoPlayerBySessionId(id);
    const target = player.getCurrentTime() + e.data.offsetSec * 1000;
    player.seek(Math.max(0, Math.min(player.getDuration(), target)));
  } catch (err) {
    // 플레이어가 아직 준비되지 않은 경우 무시
  }
});
