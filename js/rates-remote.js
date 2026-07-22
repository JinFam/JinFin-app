// js/rates-remote.js — rates.html 전용 원격 데이터 로더.
// data/rates.json(공개 저장소, JinFam/JinFin-app)을 raw.githubusercontent.com에서 fetch해
// 성공하면 JF.ratesUi.refreshData()로 코드에 내장된 정적 데이터(js/rates-data.js)를 교체한다.
// 실패(오프라인/차단/404 등)하면 조용히 폴백 — 이미 렌더된 정적 데이터를 그대로 둔다.
//
// js/sync.js가 file:// 페이지에서도 원격 https fetch가 동작함을 이미 검증했으므로(비공개 저장소
// 폴링) 이 파일은 그 전례를 그대로 따른다 — 다만 이 데이터는 비공개 은행 고시금리라 인증이
// 필요 없는 공개 저장소 raw 콘텐츠를 쓴다(js/ui.js의 다른 페이지 no-fetch 정책과는 무관, 그 정책은
// 건드리지 않음 — rates.html에서만 로드되는 이 파일만의 동작).
(function () {
  "use strict";

  var RATES_JSON_URL = "https://raw.githubusercontent.com/JinFam/JinFin-app/main/data/rates.json";

  if (typeof fetch !== "function") return;

  fetch(RATES_JSON_URL, { cache: "no-store" })
    .then(function (res) { return res && res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.banks) || typeof data.series !== "object") return;
      var JF = window.JF;
      if (JF && JF.ratesUi && typeof JF.ratesUi.refreshData === "function") {
        JF.ratesUi.refreshData(data);
      }
    })
    .catch(function () {
      // 오프라인/차단/404 등 — 정적 폴백(js/rates-data.js) 그대로 유지, 콘솔 에러 없음.
    });
})();
