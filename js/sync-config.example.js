// js/sync-config.example.js — GitHub 동기화 설정 템플릿.
//
// 사용법: 이 파일을 js/sync-config.js 로 복사하고 owner/repo 값을 채운 뒤,
// 동기화가 필요한 페이지의 <script src="js/sync.js"> "앞"에
//   <script src="js/sync-config.js"></script>
// 를 추가한다. (없으면 JF.sync는 완전 no-op → 기존 로컬 동작 그대로.)
//
// ⚠️ 토큰(PAT)은 절대 이 파일에 넣지 않는다. 토큰은 앱 UI에서 각자 1회 입력 →
//    브라우저 localStorage("jinfinance:sync:token")에만 저장된다.
//    이 파일에는 비밀이 없으므로 공유 repo에 커밋해도 안전하다.
window.JF = window.JF || {};
window.JF.syncConfig = {
  owner: "YOUR_ORG",      // 조직(Org) 이름 — fine-grained PAT의 Resource owner와 동일
  repo: "jinfinance-sync", // 비공개 저장소 이름
  branch: "main",          // 대상 브랜치
  dir: "state",            // 섹션 JSON 파일이 들어갈 폴더 (state/expenses.json ...)
  pollMs: 5000,            // 폴링 주기(ms) — 5초 권장(변경 없으면 304라 사용량 거의 없음)
  label: ""                // 이 기기 사용자 라벨(updatedBy 기본값). 앱 UI에서 각자 지정 가능.
};
