// js/rates.js — JF.rates: 순수 금리 시계열 집계 엔진. DOM/JF.ui/location/fetch 금지.
// 입력 시계열은 JF.ratesData.series[bankId] = [[날짜"YYYY-MM-DD", 금리], ...] 오름차순 배열.
// Node 테스트 지원을 위한 UMD 가드(loan.js/calc.js와 동일 패턴).
var JF = (typeof window !== 'undefined')
  ? (window.JF = window.JF || {})
  : (typeof global !== 'undefined' ? (global.JF = global.JF || {}) : {});

(function (JF) {
  "use strict";

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function monthKey(dateStr) {
    return String(dateStr).slice(0, 7); // "YYYY-MM"
  }

  // mondayOf(dateStr) — 해당 날짜가 속한 주(월요일 시작)의 월요일 날짜("YYYY-MM-DD").
  function mondayOf(dateStr) {
    var p = String(dateStr).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    var dt = new Date(y, m - 1, d);
    var dow = dt.getDay(); // 0=일 ... 6=토
    var offset = (dow + 6) % 7; // 0=월 ... 6=일
    dt.setDate(dt.getDate() - offset);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  // yymmdd(dateStr) — "YY.MM.DD" 라벨. 전체 이력(10년+)을 한 축에 그리므로 연도 없는
  // "MM/DD"는 연도 간 모호(예: 07/13이 2016년인지 2026년인지 구분 불가) — 항상 연도 포함.
  function yymmdd(dateStr) {
    var p = String(dateStr).split('-');
    return p[0].slice(2) + '.' + p[1] + '.' + p[2];
  }

  // aggregate(series, granularity) — granularity: "day" | "week" | "month".
  // series: [[date, rate], ...] 오름차순. 반환: [{key, label, value}] key 오름차순.
  // day: 원본 그대로(반올림 없음). week/month: 평균, 소수 2자리 반올림.
  function aggregate(series, granularity) {
    series = series || [];
    if (granularity === 'day') {
      return series.map(function (row) {
        return { key: row[0], label: yymmdd(row[0]), value: row[1] };
      });
    }

    var keyFn = granularity === 'week' ? mondayOf : monthKey;
    var order = [];
    var sums = {};
    var counts = {};

    for (var i = 0; i < series.length; i++) {
      if (series[i][1] == null) continue; // null-safe: 결측(diffSeries의 구멍 등)은 0으로 취급하지 않고 집계에서 제외
      var k = keyFn(series[i][0]);
      if (!(k in sums)) {
        sums[k] = 0;
        counts[k] = 0;
        order.push(k);
      }
      sums[k] += series[i][1];
      counts[k] += 1;
    }

    order.sort();
    return order.map(function (k) {
      var label = granularity === 'week' ? (yymmdd(k) + '주') : k;
      return { key: k, label: label, value: round2(sums[k] / counts[k]) };
    });
  }

  // mergeByDate(seriesMap) — seriesMap: { bankId: [[date,rate],...], ... }.
  // 반환: [{ date, <bankId>: rate|null, ... }] 날짜 오름차순, 전체 은행 합집합 날짜.
  function mergeByDate(seriesMap) {
    var bankIds = Object.keys(seriesMap);
    var byDate = {};
    var dates = [];

    bankIds.forEach(function (id) {
      (seriesMap[id] || []).forEach(function (row) {
        var d = row[0];
        if (!(d in byDate)) {
          byDate[d] = {};
          dates.push(d);
        }
        byDate[d][id] = row[1];
      });
    });

    dates.sort();
    return dates.map(function (d) {
      var out = { date: d };
      bankIds.forEach(function (id) {
        out[id] = (byDate[d] && byDate[d][id] != null) ? byDate[d][id] : null;
      });
      return out;
    });
  }

  // listMonths(seriesMap) — 데이터가 존재하는 모든 "YYYY-MM" 오름차순 목록(합집합).
  function listMonths(seriesMap) {
    var set = {};
    Object.keys(seriesMap).forEach(function (id) {
      (seriesMap[id] || []).forEach(function (row) {
        set[monthKey(row[0])] = true;
      });
    });
    return Object.keys(set).sort();
  }

  // monthRows(mergedRows, ym) — mergeByDate() 결과에서 "YYYY-MM"에 해당하는 행만, 날짜 오름차순.
  function monthRows(mergedRows, ym) {
    return (mergedRows || []).filter(function (r) { return monthKey(r.date) === ym; });
  }

  // diffSeries(seriesA, seriesB) — 두 시계열의 날짜 합집합에서 (A - B)를 계산.
  // 둘 중 하나라도 그 날짜에 값이 없으면 diff도 null(허위 0 방지, 라인이 끊김).
  // 반환: [[date, diffOrNull], ...] 날짜 오름차순 — aggregate()에 그대로 넣을 수 있는 형태.
  function diffSeries(seriesA, seriesB) {
    var merged = mergeByDate({ a: seriesA || [], b: seriesB || [] });
    return merged.map(function (row) {
      var diff = (row.a == null || row.b == null) ? null : round2(row.a - row.b);
      return [row.date, diff];
    });
  }

  // parseBokBaseRateTable(html) — 한국은행 기준금리 페이지(<table class="fixed">, 캡션
  // "한국은행 기준금리 추이") HTML 문자열을 파싱해 [[date, rate], ...] 오름차순 배열로 반환.
  // 순수 문자열 정규식 파싱(DOM 불필요) — 브라우저 fetch 응답 텍스트와 Node 테스트 양쪽에서 동일 동작.
  // 월/일이 한 자리 표기("7월 6일")일 가능성까지 대비해 \d{1,2}로 매칭 후 코드에서 0-패딩한다.
  function parseBokBaseRateTable(html) {
    var tableMatch = String(html || "").match(/<table class="fixed">[\s\S]*?<\/table>/);
    if (!tableMatch) return [];
    var tableHtml = tableMatch[0];
    var rowRe = /<tr>\s*<td class="fb">(\d{4})<\/td>\s*<td>(\d{1,2})월\s*(\d{1,2})일<\/td>\s*<td>([\d.]+)<\/td>\s*<\/tr>/g;
    var rows = [];
    var m;
    while ((m = rowRe.exec(tableHtml))) {
      var rate = parseFloat(m[4]);
      if (isNaN(rate)) continue;
      rows.push([m[1] + "-" + pad2(parseInt(m[2], 10)) + "-" + pad2(parseInt(m[3], 10)), rate]);
    }
    rows.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return rows;
  }

  // latestValue(series) — series: [[date, rate], ...] 오름차순. 마지막 행의 rate를 반환.
  // series가 null/undefined/배열이 아니거나 빈 배열이면 null.
  function latestValue(series) {
    if (!Array.isArray(series) || series.length === 0) return null;
    return series[series.length - 1][1];
  }

  JF.rates = {
    monthKey: monthKey,
    mondayOf: mondayOf,
    aggregate: aggregate,
    mergeByDate: mergeByDate,
    listMonths: listMonths,
    monthRows: monthRows,
    diffSeries: diffSeries,
    parseBokBaseRateTable: parseBokBaseRateTable,
    latestValue: latestValue
  };
})(JF);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JF.rates;
}
