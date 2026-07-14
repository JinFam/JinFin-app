// app-rates.js — 금리 탭: 금융채6개월 기준금리 그래프(신한/SC제일) + 일자별 데이터 표.
// 집계는 JF.rates(순수 엔진)에 위임. 원본 시계열은 JF.ratesData(정적 데이터, 동기화 상태 아님).
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var granularity = "month"; // "month" | "week" | "day"
  var hidden = {};           // bankId -> true(숨김)
  var currentYm = null;      // 표 섹션 현재 페이지("YYYY-MM"), 첫 렌더 시 최신월로 설정

  function svgEl(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      node.setAttribute(k, v);
    });
    if (children != null) {
      var list = Array.isArray(children) ? children : [children];
      list.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string" || typeof c === "number") {
          node.appendChild(document.createTextNode(String(c)));
        } else {
          node.appendChild(c);
        }
      });
    }
    return node;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // key(month="YYYY-MM" | week/day="YYYY-MM-DD") -> epoch ms(해당 시점의 로컬 자정).
  function keyToTime(key, gran) {
    var full = gran === "month" ? (key + "-01") : key;
    var p = full.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
  }

  // 전체 이력(10년+)을 한 축에 그리므로 week/day 라벨도 연도 필수(없으면 연도 간 모호).
  function formatAxisDate(date, gran) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    var yy = String(y).slice(2);
    if (gran === "month") return y + "." + pad2(m);
    return yy + "." + pad2(m) + "." + pad2(d);
  }

  // buildChart: 보이는 은행들의 집계 시계열을 실제 시간축(연속) 위에 겹쳐 그린 SVG 반환.
  // "확대"가 아니라 월/주/일 "전환"이므로 X축 범위는 항상 전체 이력(각 은행 데이터 시작~오늘).
  function buildChart(banks, seriesByBank, gran, hiddenSet) {
    var W = 960, H = 320;
    var M = { top: 14, right: 16, bottom: 30, left: 54 };
    var plotW = W - M.left - M.right;
    var plotH = H - M.top - M.bottom;

    var visibleBanks = banks.filter(function (b) { return !hiddenSet[b.id]; });
    var aggByBank = {};
    banks.forEach(function (b) {
      aggByBank[b.id] = JF.rates.aggregate(seriesByBank[b.id] || [], gran);
    });

    var allPoints = [];
    visibleBanks.forEach(function (b) {
      aggByBank[b.id].forEach(function (p) { allPoints.push(p); });
    });

    if (!allPoints.length) {
      return svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "rate-chart-svg" }, [
        svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "rate-axis-text" },
          "표시할 데이터가 없습니다 (범례에서 은행을 선택하세요)")
      ]);
    }

    var times = allPoints.map(function (p) { return keyToTime(p.key, gran); });
    var minT = Math.min.apply(null, times);
    var maxT = Math.max.apply(null, times);
    if (minT === maxT) { minT -= 1; maxT += 1; }

    var values = allPoints.map(function (p) { return p.value; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    var padV = Math.max((maxV - minV) * 0.1, 0.05);
    minV -= padV; maxV += padV;
    if (minV === maxV) { minV -= 0.5; maxV += 0.5; }

    function xPix(t) { return M.left + (t - minT) / (maxT - minT) * plotW; }
    function yPix(v) { return M.top + (1 - (v - minV) / (maxV - minV)) * plotH; }

    var nodes = [];

    var yTicks = 5;
    for (var i = 0; i <= yTicks; i++) {
      var v = minV + (maxV - minV) * (i / yTicks);
      var y = yPix(v);
      nodes.push(svgEl("line", { x1: M.left, x2: W - M.right, y1: y, y2: y, class: "rate-grid-line" }));
      nodes.push(svgEl("text", { x: M.left - 8, y: y + 3, "text-anchor": "end", class: "rate-axis-text" }, v.toFixed(2) + "%"));
    }

    var xTicks = 6;
    for (var j = 0; j <= xTicks; j++) {
      var t = minT + (maxT - minT) * (j / xTicks);
      var x = xPix(t);
      nodes.push(svgEl("line", { x1: x, x2: x, y1: M.top, y2: H - M.bottom, class: "rate-grid-line rate-grid-line-v" }));
      nodes.push(svgEl("text", { x: x, y: H - M.bottom + 16, "text-anchor": "middle", class: "rate-axis-text" }, formatAxisDate(new Date(t), gran)));
    }

    banks.forEach(function (b) {
      if (hiddenSet[b.id]) return;
      var pts = aggByBank[b.id];
      if (!pts.length) return;
      var d = pts.map(function (p, idx) {
        var x = xPix(keyToTime(p.key, gran));
        var y = yPix(p.value);
        return (idx === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
      nodes.push(svgEl("path", { d: d, class: "rate-line", style: "stroke:" + b.color }));

      if (gran !== "day") {
        pts.forEach(function (p) {
          var x = xPix(keyToTime(p.key, gran));
          var y = yPix(p.value);
          nodes.push(svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6, class: "rate-point", style: "fill:" + b.color },
            svgEl("title", null, b.label + " · " + p.label + " · " + p.value.toFixed(2) + "%")));
        });
      }
    });

    return svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "rate-chart-svg", preserveAspectRatio: "xMidYMid meet" }, nodes);
  }

  function renderGranSeg() {
    var opts = [["month", "월"], ["week", "주"], ["day", "일"]];
    return el("div", { class: "seg-group" }, opts.map(function (o) {
      return el("button", {
        type: "button",
        class: "btn btn-sm seg-btn" + (granularity === o[0] ? " is-active" : ""),
        onClick: function () { granularity = o[0]; render(); }
      }, o[1]);
    }));
  }

  function renderLegend(banks) {
    return el("div", { class: "rate-legend" }, banks.map(function (b) {
      var isHidden = !!hidden[b.id];
      return el("button", {
        type: "button",
        class: "rate-legend-chip" + (isHidden ? " is-hidden" : ""),
        onClick: function () { hidden[b.id] = !hidden[b.id]; render(); }
      }, [
        el("span", { class: "rate-legend-dot", style: { background: b.color } }),
        el("span", {}, b.label)
      ]);
    }));
  }

  function renderChartSection() {
    var host = document.getElementById("rates-chart");
    if (!host) return;
    host.textContent = "";
    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("h2", { class: "card-title" }, "금리 그래프"),
        renderGranSeg()
      ]),
      el("div", { class: "rate-chart-wrap" }, buildChart(JF.ratesData.banks, JF.ratesData.series, granularity, hidden)),
      renderLegend(JF.ratesData.banks),
      el("p", { class: "muted rate-caption" },
        "금융채6개월 기준금리. 신한은행은 일별 고시값, SC제일은행은 최근 10영업일 평균(은행 공시 산출 방식) — 산출 방식이 달라 두 값을 직접 비교할 때 참고하세요.")
    ]));
  }

  function renderTableSection() {
    var host = document.getElementById("rates-table");
    if (!host) return;

    var seriesMap = JF.ratesData.series;
    var merged = JF.rates.mergeByDate(seriesMap);
    var months = JF.rates.listMonths(seriesMap);
    host.textContent = "";
    if (!months.length) return;

    if (!currentYm || months.indexOf(currentYm) === -1) currentYm = months[months.length - 1];
    var idx = months.indexOf(currentYm);
    var rows = JF.rates.monthRows(merged, currentYm);

    function fmt(v) { return v == null ? "-" : v.toFixed(2) + "%"; }

    var theadRow = el("tr", {}, [el("th", {}, "날짜")].concat(JF.ratesData.banks.map(function (b) {
      return el("th", { class: "num" }, b.label);
    })));

    var bodyRows = rows.length
      ? rows.map(function (r) {
          return el("tr", {}, [el("td", {}, r.date)].concat(JF.ratesData.banks.map(function (b) {
            return el("td", { class: "num" }, fmt(r[b.id]));
          })));
        })
      : [el("tr", {}, el("td", { colspan: JF.ratesData.banks.length + 1, class: "muted" }, "해당 월 데이터 없음"))];

    var table = el("table", { class: "table" }, [
      el("thead", {}, theadRow),
      el("tbody", {}, bodyRows)
    ]);

    var pager = el("div", { class: "field-row" }, [
      el("button", {
        class: "btn btn-sm", type: "button", disabled: idx <= 0,
        onClick: function () { currentYm = months[idx - 1]; renderTableSection(); }
      }, "◀ 이전 달"),
      el("input", {
        type: "month", value: currentYm, min: months[0], max: months[months.length - 1],
        onChange: function (e) {
          var v = e.target.value;
          if (months.indexOf(v) !== -1) { currentYm = v; renderTableSection(); }
        }
      }),
      el("button", {
        class: "btn btn-sm", type: "button", disabled: idx >= months.length - 1,
        onClick: function () { currentYm = months[idx + 1]; renderTableSection(); }
      }, "다음 달 ▶"),
      el("span", { class: "muted" }, (idx + 1) + " / " + months.length + " 개월")
    ]);

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("h2", { class: "card-title" }, "금리 데이터 (일자별)")
      ]),
      pager,
      el("div", { class: "table-wrap jf-section" }, table)
    ]));
  }

  function render() {
    renderChartSection();
    renderTableSection();
  }

  JF.ui.renderNav("rates.html");
  render();
})();
