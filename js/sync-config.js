// js/sync-config.js — GitHub 동기화 설정(실제 값). 비밀 없음(토큰 미포함) → 공유 안전.
// 토큰(PAT)은 앱 UI에서 각자 1회 입력 → localStorage("jinfinance:sync:token")에만 저장.
window.JF = window.JF || {};
window.JF.syncConfig = {
  owner: "JinFam",         // 조직(Org) — fine-grained PAT의 Resource owner와 동일
  repo: "JinFin-sync",     // 비공개 저장소
  branch: "main",          // 기본 브랜치(GitHub 신규 repo 기본값)
  dir: "state",            // 섹션 JSON 폴더 (state/expenses.json ...)
  pollMs: 5000,            // 폴링 주기(ms) — 5초. 변경 없을 땐 304(조건부요청)라 사용량 거의 없음.
  label: ""                // 이 기기 사용자 라벨(updatedBy). 앱 UI에서 각자 지정.
};
