#!/usr/bin/env node
// scripts/generate-rates-data.js — data/rates.json(canonical) -> js/rates-data.js(생성물).
// update-rate.yml이 매일 data/rates.json을 갱신한 뒤 이 스크립트로 js/rates-data.js를
// 재생성한다. js/rates-data.js를 직접 손으로 고치지 말 것 — 다음 재생성 때 덮어써진다.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "rates.json");
const OUT_PATH = path.join(ROOT, "js", "rates-data.js");

function main() {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data.banks) || typeof data.series !== "object") {
    throw new Error("data/rates.json: banks[]/series{} 형식이 아님");
  }

  const body =
    "window.JF = window.JF || {};\n\n" +
    "// 이 파일은 생성됨 — 직접 수정 금지. 원본은 data/rates.json이며,\n" +
    "// scripts/generate-rates-data.js로 이 파일을 재생성한다(update-rate.yml이 매일 자동 실행).\n" +
    "(function (JF) {\n" +
    '  "use strict";\n\n' +
    "  JF.ratesData = " + JSON.stringify(data, null, 2).replace(/\n/g, "\n  ") + ";\n" +
    "})(window.JF);\n";

  fs.writeFileSync(OUT_PATH, body);
  console.log("generated " + OUT_PATH + " from " + DATA_PATH);
  console.log(data.banks.length + " series, " +
    Object.values(data.series).reduce((n, s) => n + s.length, 0) + " total points");
}

main();
