#!/usr/bin/env node
// scripts/fetch-shinhan.js — 신한은행 주요시장금리(금융채6개월/5년) 오늘자 값을 헤드리스
// 브라우저로 읽어 stdout에 JSON 한 줄로 출력. 신한 페이지는 WebSquare 프레임워크라 SC처럼
// 단순 curl로 안 되고(plan §2.3), 헤더 텍스트로 컬럼을 찾음(사이트가 순서를 바꿔도 안 깨지게).
// update-rate.yml에서: npx playwright install chromium 후 node scripts/fetch-shinhan.js 호출.
"use strict";

const { chromium } = require("playwright");

function pickByHeader(headers, cells, headerSubstr) {
  var idx = -1;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].indexOf(headerSubstr) === 0) { idx = i; break; }
  }
  if (idx === -1 || idx >= cells.length) return null;
  var v = cells[idx];
  return v && v !== "" ? v : null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(
      "https://www.shinhan.com/hpe/index.jsp?w2xPath=/hpe/customer/CS08/CS08017RP01.xml",
      { waitUntil: "networkidle", timeout: 30000 }
    );
    await page.waitForTimeout(4000);

    const dump = await page.evaluate(function () {
      function gridData(id) {
        var g = document.getElementById(id);
        if (!g) return null;
        var headers = [];
        g.querySelectorAll("th").forEach(function (th) { headers.push(th.textContent.trim()); });
        var cells = [];
        var firstRow = g.querySelector("tbody tr");
        if (firstRow) firstRow.querySelectorAll("td").forEach(function (td) { cells.push(td.textContent.trim()); });
        return { headers: headers, cells: cells };
      }
      return { g1: gridData("grd_주요시장금리1"), g2: gridData("grd_주요시장금리2") };
    });

    if (!dump.g1 || !dump.g2) throw new Error("그리드를 찾을 수 없음(페이지 구조 변경 가능성)");

    var asOfRaw = dump.g1.cells[0]; // "YYYY.MM.DD"
    var asOf = asOfRaw ? asOfRaw.replace(/\./g, "-") : null;
    var sixMonth = pickByHeader(dump.g1.headers, dump.g1.cells, "금융채6개월");
    var fiveYear = pickByHeader(dump.g2.headers, dump.g2.cells, "금융채5년");

    if (!asOf || !sixMonth || !fiveYear) {
      throw new Error("필수 값 누락: asOf=" + asOf + " 6m=" + sixMonth + " 5y=" + fiveYear);
    }

    console.log(JSON.stringify({ asOf: asOf, shinhan_6m: parseFloat(sixMonth), shinhan_5y: parseFloat(fiveYear) }));
  } finally {
    await browser.close();
  }
})().catch(function (e) {
  console.error("::error::신한 스크래핑 실패: " + e.message);
  process.exit(1);
});
