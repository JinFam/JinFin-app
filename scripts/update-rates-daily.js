#!/usr/bin/env node
// scripts/update-rates-daily.js — update-rate.yml의 일일 갱신 스텝.
// 입력: SC selectLoanBaseRate 원본 응답(JSON), 신한 fetch-shinhan.js 출력(JSON).
// data/rates.json(9-시리즈 canonical)을 갱신한다. 실행 후 scripts/generate-rates-data.js로
// js/rates-data.js를 재생성해야 함(별도 스텝).
//
// SC측 5개 시리즈(scfirst_6m/5y, cofix_new/balance/new_balance)는 매번 엔드포인트가 주는
// 전체 이력으로 통째로 교체(append 아님) — 이 API는 항상 전체를 반환하므로 이 쪽이 더 정확하고
// 단순하다(Phase 0 스파이크, progress.txt US-001 참고). COFIX는 신한 라벨도 동일 배열 참조
// (COFIX 단일소스화, plan §2.2 — 은행마다 다시 스크래핑하지 않음).
// 신한 6개월/5년은 신한 페이지가 오늘 값 하나만 주므로 upsert(있으면 갱신, 없으면 추가).
//
// 신한 스크래핑(Playwright, WebSquare)은 SC curl보다 훨씬 깨지기 쉽다(봇 탐지/셀렉터 변경/
// networkidle 타임아웃 등). shinhan_response.json이 없거나 형식이 이상해도 이 스크립트는
// 하드 실패하지 않고 신한 2개 시리즈만 이번 회차 갱신을 건너뛴다(기존 값 유지) — SC 5개 시리즈 +
// 레거시 rate.json(별도 스텝)은 신한 실패와 무관하게 항상 갱신된다(architect review MEDIUM-2,
// 계획의 위험 완화 문구 "최악의 경우 해당 2개 시리즈만 자동화 보류, 나머지는 예정대로 진행"과
// 일치시킴 — 이전 버전은 신한 실패 시 워크플로 전체가 죽어 이 문구와 어긋났었음).
"use strict";

const fs = require("fs");
const path = require("path");

function usageError(msg) {
  console.error("::error::" + msg);
  process.exit(1);
}

const [, , scPath, shinhanPath, dataPath] = process.argv;
if (!scPath) {
  usageError("사용법: node update-rates-daily.js <sc_response.json> [shinhan_response.json] [data/rates.json]");
}
const RATES_JSON = dataPath || path.join(__dirname, "..", "data", "rates.json");

// SC 응답이 정상 형식이어도 값이 이상하게 줄어든 경우(부분 응답 등) 전체 이력을 조용히
// 축소시키지 않도록 하는 안전장치 — 새 길이가 기존의 절반 미만이면 교체를 건너뛴다(LOW-3).
const MIN_KEEP_RATIO = 0.5;

function scSeries(scRaw, field) {
  var out = [];
  (scRaw.vector || []).forEach(function (e) {
    var lb = e.LOAN_BASE || {};
    var v = lb[field], d = lb.BASE_DT;
    if (!d || v == null || v === "" || v === "-") return;
    var f = parseFloat(v);
    if (isNaN(f)) return;
    out.push([d, f]);
  });
  out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return out;
}

function replaceIfNotShrunk(data, id, newSeries) {
  var existing = data.series[id] || [];
  if (existing.length > 0 && newSeries.length < existing.length * MIN_KEEP_RATIO) {
    console.error(
      "::warning::" + id + " 새 응답이 기존보다 크게 짧음(" + newSeries.length + " < " +
      existing.length + "*" + MIN_KEEP_RATIO + ") — 부분 응답으로 보고 이번 회차는 기존 값 유지"
    );
    return;
  }
  data.series[id] = newSeries;
}

function upsert(series, date, value) {
  var idx = series.findIndex(function (r) { return r[0] === date; });
  if (idx === -1) series.push([date, value]); else series[idx][1] = value;
  series.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
}

function readShinhanPayload(shinhanPath) {
  if (!shinhanPath || !fs.existsSync(shinhanPath)) {
    console.error("::warning::신한 응답 파일 없음(" + shinhanPath + ") — 이번 회차는 신한 6개월/5년 갱신을 건너뜀");
    return null;
  }
  var parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(shinhanPath, "utf-8"));
  } catch (e) {
    console.error("::warning::신한 응답 JSON 파싱 실패(" + e.message + ") — 이번 회차는 신한 6개월/5년 갱신을 건너뜀");
    return null;
  }
  if (!parsed.asOf || parsed.shinhan_6m == null || parsed.shinhan_5y == null) {
    console.error("::warning::신한 응답에 필수 필드 누락(" + JSON.stringify(parsed) + ") — 이번 회차는 신한 6개월/5년 갱신을 건너뜀");
    return null;
  }
  return parsed;
}

function main() {
  const data = JSON.parse(fs.readFileSync(RATES_JSON, "utf-8"));
  const scRaw = JSON.parse(fs.readFileSync(scPath, "utf-8"));

  replaceIfNotShrunk(data, "scfirst_6m", scSeries(scRaw, "FNANCL_BOND_6_MH_EXPIRE"));
  replaceIfNotShrunk(data, "scfirst_5y", scSeries(scRaw, "FNANCL_BOND_5_YR_EXPIRE"));
  replaceIfNotShrunk(data, "scfirst_cofix_new", scSeries(scRaw, "COFIX_BASE_INT"));
  replaceIfNotShrunk(data, "scfirst_cofix_balance", scSeries(scRaw, "COFIX_BASE_BS_INT"));
  replaceIfNotShrunk(data, "scfirst_cofix_new_balance", scSeries(scRaw, "COFIX_BASE_NEW_BS_INT"));
  data.series.shinhan_cofix_new = data.series.scfirst_cofix_new;
  data.series.shinhan_cofix_balance = data.series.scfirst_cofix_balance;

  const shinhan = readShinhanPayload(shinhanPath);
  if (shinhan) {
    upsert(data.series.shinhan_6m, shinhan.asOf, shinhan.shinhan_6m);
    upsert(data.series.shinhan_5y, shinhan.asOf, shinhan.shinhan_5y);
  }

  Object.keys(data.series).forEach(function (id) {
    var s = data.series[id];
    if (s.length && data.meta[id]) data.meta[id].asOf = s[s.length - 1][0];
  });

  fs.writeFileSync(RATES_JSON, JSON.stringify(data, null, 2));
  console.log(
    "data/rates.json updated: " +
    Object.keys(data.series).map(function (id) { return id + "=" + data.series[id].length; }).join(", ") +
    (shinhan ? "" : " (신한 갱신 건너뜀)")
  );
}

main();
