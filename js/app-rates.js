// app-rates.js — 금리 탭: 금융채6개월 기준금리 그래프(신한/SC제일) + 일자별 데이터 표.
// 집계는 JF.rates(순수 엔진)에 위임. 원본 시계열은 JF.ratesData(정적 데이터, 동기화 상태 아님).
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var granularity = "month"; // "month" | "week" | "day" — 확대/이동과 별개(줌 창 안에서 집계 단위만 전환)
  var hidden = {};           // bankId -> true(숨김)
  var currentYm = null;      // 표 섹션 현재 페이지("YYYY-MM"), 첫 렌더 시 최신월로 설정

  // ---- 차트 캔버스 상수(뷰박스 좌표계, 반응형 표시폭과 무관) ----
  var CHART_W = 960, CHART_H = 320;
  var CHART_M = { top: 14, right: 16, bottom: 30, left: 54 };
  var CHART_PLOT_W = CHART_W - CHART_M.left - CHART_M.right;
  var CHART_PLOT_H = CHART_H - CHART_M.top - CHART_M.bottom;
  var MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 최소 확대 한도: 7일

  // ---- 확대/이동 상태 ----
  var fullMinT = null, fullMaxT = null; // 전체 데이터 시간 범위(1회 계산, 줌아웃 한계)
  var viewMinT = null, viewMaxT = null; // 현재 보이는 시간창(휠 줌/핀치/드래그로 갱신)
  var currentSvgNode = null;            // 최신 렌더된 svg(윈도우 레벨 핸들러가 참조)
  var panState = null;                  // {startClientX, startMinT, startMaxT}
  var pinchState = null;                // {startDist, startMinT, startMaxT, midT}
  var rerenderScheduled = false;

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
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

  // ensureFullRange() — 전체 은행 데이터의 최초~최신 시각을 1회 계산해 줌아웃 한계로 고정.
  function ensureFullRange() {
    if (fullMinT != null) return;
    var times = [];
    JF.ratesData.banks.forEach(function (b) {
      (JF.ratesData.series[b.id] || []).forEach(function (row) {
        times.push(keyToTime(row[0], "day"));
      });
    });
    fullMinT = Math.min.apply(null, times);
    fullMaxT = Math.max.apply(null, times);
    viewMinT = fullMinT;
    viewMaxT = fullMaxT;
  }

  // setWindow(newMin, newMax) — 창 폭은 유지한 채 [fullMinT, fullMaxT] 안으로 밀어넣기(팬 경계 처리).
  function setWindow(newMin, newMax) {
    var w = newMax - newMin;
    if (newMin < fullMinT) { newMin = fullMinT; newMax = newMin + w; }
    if (newMax > fullMaxT) { newMax = fullMaxT; newMin = newMax - w; }
    viewMinT = Math.max(newMin, fullMinT);
    viewMaxT = Math.min(newMax, fullMaxT);
  }

  // zoomAt(anchorT, factor) — anchorT(마우스/핀치 중심 시각)가 창 내 상대위치를 유지한 채
  // factor<1이면 확대(창 좁아짐), factor>1이면 축소(창 넓어짐). 최소/최대 폭으로 클램프.
  function zoomAt(anchorT, factor) {
    var curW = viewMaxT - viewMinT;
    var fullW = fullMaxT - fullMinT;
    var newW = clampNum(curW * factor, MIN_WINDOW_MS, fullW);
    var ratio = curW > 0 ? (anchorT - viewMinT) / curW : 0.5;
    var newMin = anchorT - ratio * newW;
    setWindow(newMin, newMin + newW);
  }

  function resetZoom() {
    viewMinT = fullMinT;
    viewMaxT = fullMaxT;
    render();
  }

  // scheduleRerender() — 휠/드래그/핀치 도중에는 카드 전체(범례·세그먼트 버튼 포함)를 다시
  // 만들지 않고 svg "내용물"만 갱신한다(updateChartGeometry). 매 프레임 svg 엘리먼트 자체를
  // 새로 만들면 그 위에 붙은 리스너를 매번 다시 붙여야 하고, 그 틈에 이벤트가 옛 노드로 가는
  // 등 드래그 상태가 꼬이기 쉽다 — svg 노드를 인터랙션 내내 고정해 이 문제를 근본적으로 없앤다.
  function scheduleRerender() {
    if (rerenderScheduled) return;
    rerenderScheduled = true;
    var raf = (typeof window.requestAnimationFrame === "function")
      ? window.requestAnimationFrame
      : function (fn) { return setTimeout(fn, 16); };
    raf(function () {
      rerenderScheduled = false;
      updateChartGeometry();
    });
  }

  function clientToUserX(clientX) {
    var rect = currentSvgNode.getBoundingClientRect();
    if (!rect.width) return CHART_M.left;
    return (clientX - rect.left) / rect.width * CHART_W;
  }

  function pixToTime(userX) {
    return viewMinT + (userX - CHART_M.left) / CHART_PLOT_W * (viewMaxT - viewMinT);
  }

  function touchDist(touches) {
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function midClientX(touches) { return (touches[0].clientX + touches[1].clientX) / 2; }

  function applyPanFromClientX(clientX) {
    if (!panState || !currentSvgNode) return;
    var rect = currentSvgNode.getBoundingClientRect();
    if (!rect.width) return;
    var dxUser = (clientX - panState.startClientX) / rect.width * CHART_W;
    var timePerUserPix = (panState.startMaxT - panState.startMinT) / CHART_PLOT_W;
    var dt = -dxUser * timePerUserPix;
    setWindow(panState.startMinT + dt, panState.startMaxT + dt);
    scheduleRerender();
  }

  // ---- 인터랙션 핸들러: svg 자체(휠/mousedown/touchstart)는 구조적 재생성(buildChart) 때만
  // 새로 붙는다(인터랙션 중엔 updateChartGeometry가 노드를 바꾸지 않으므로 재부착 불필요).
  // window 레벨(mousemove/mouseup/touchmove/touchend/touchcancel)은 아래 부트스트랩에서 1회만
  // 등록하고, currentSvgNode/panState/pinchState(모듈 전역)를 참조한다. ----
  function onWheel(e) {
    e.preventDefault();
    var anchorT = pixToTime(clientToUserX(e.clientX));
    var factor = e.deltaY > 0 ? 1.15 : (1 / 1.15);
    zoomAt(anchorT, factor);
    scheduleRerender();
  }

  function startPan(clientX) {
    panState = { startClientX: clientX, startMinT: viewMinT, startMaxT: viewMaxT };
    if (currentSvgNode) currentSvgNode.className = svgBaseClass();
  }
  function endPan() {
    if (currentSvgNode) currentSvgNode.className = "rate-chart-svg";
    panState = null;
  }
  function endPinch() {
    pinchState = null;
  }

  function onMouseDown(e) {
    startPan(e.clientX);
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchState = {
        startDist: touchDist(e.touches),
        startMinT: viewMinT, startMaxT: viewMaxT,
        midT: pixToTime(clientToUserX(midClientX(e.touches)))
      };
      endPan();
    } else if (e.touches.length === 1) {
      // 합성 마우스 이벤트(모바일+마우스 겸용 기기) 발생을 막아 팬 상태가 이중으로 잡히지 않게 함.
      e.preventDefault();
      startPan(e.touches[0].clientX);
      endPinch();
    }
  }

  // onWindowMouseMove — mouseup이 브라우저 밖(또는 다른 이유)에서 유실되면 panState가 영영
  // 안 풀려 "클릭 안 해도 계속 드래그되는" 버그로 이어진다. e.buttons===0(현재 버튼 안 눌림)이면
  // 그 즉시 팬을 강제 종료하는 안전장치 — 버튼을 놓친 시점의 다음 mousemove에서 바로 복구된다.
  function onWindowMouseMove(e) {
    if (!panState) return;
    if (typeof e.buttons === "number" && e.buttons === 0) { endPan(); return; }
    applyPanFromClientX(e.clientX);
  }
  function onWindowMouseUp() { endPan(); }
  function onWindowTouchMove(e) {
    if (e.touches.length === 2 && pinchState) {
      e.preventDefault();
      var d = touchDist(e.touches);
      if (d <= 0) return;
      var scale = pinchState.startDist / d; // 손가락이 벌어질수록(d 커짐) scale<1 -> 확대(창 좁아짐)
      var startW = pinchState.startMaxT - pinchState.startMinT;
      var newW = clampNum(startW * scale, MIN_WINDOW_MS, fullMaxT - fullMinT);
      var ratio = startW > 0 ? (pinchState.midT - pinchState.startMinT) / startW : 0.5;
      var newMin = pinchState.midT - ratio * newW;
      setWindow(newMin, newMin + newW);
      scheduleRerender();
    } else if (e.touches.length === 1 && panState) {
      e.preventDefault();
      applyPanFromClientX(e.touches[0].clientX);
    }
  }
  function onWindowTouchEnd(e) {
    if (e.touches.length < 2) endPinch();
    if (e.touches.length === 0) endPan();
  }
  // touchcancel(전화 수신, 알림창 등으로 브라우저가 터치를 강제 취소하는 경우) — touches 배열
  // 형태가 브라우저마다 달라 신뢰하기 어려우므로 무조건 팬/핀치 상태를 종료한다.
  function onWindowTouchCancel() { endPan(); endPinch(); }

  // svgBaseClass() — panState가 있으면(드래그 중) "is-panning" 포함. 구조적 재생성(범례/세그먼트
  // 전환, 전체보기 등)은 드문 사용자 조작에서만 일어나므로 안전장치로 유지(평소엔 mousedown/up의
  // 직접 클래스 변경만으로 충분 — svg 노드가 인터랙션 내내 고정되어 있기 때문).
  function svgBaseClass() {
    return "rate-chart-svg" + (panState ? " is-panning" : "");
  }

  function attachInteraction(svg) {
    currentSvgNode = svg;
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("mousedown", onMouseDown);
    svg.addEventListener("touchstart", onTouchStart, { passive: false });
  }

  // computeChartNodes: 보이는 은행들의 집계 시계열을, 현재 확대/이동 창(viewMinT~viewMaxT) 기준으로
  // 그린 svg 자식 노드 배열을 반환(순수 계산, DOM 부착 없음). 월/주/일은 "창 안에서" 집계 단위만
  // 바꾸고, 확대/축소/이동은 마우스 휠·드래그·핀치로 별도 처리(줌 창은 이 함수 밖의 모듈 상태).
  function computeChartNodes(banks, seriesByBank, gran, hiddenSet) {
    var W = CHART_W, H = CHART_H, M = CHART_M, plotW = CHART_PLOT_W, plotH = CHART_PLOT_H;
    var minT = viewMinT, maxT = viewMaxT;

    var visibleBanks = banks.filter(function (b) { return !hiddenSet[b.id]; });
    var visibleByBank = {};
    banks.forEach(function (b) {
      var agg = JF.rates.aggregate(seriesByBank[b.id] || [], gran);
      visibleByBank[b.id] = agg.filter(function (p) {
        var t = keyToTime(p.key, gran);
        return t >= minT && t <= maxT;
      });
    });

    var allPoints = [];
    visibleBanks.forEach(function (b) {
      visibleByBank[b.id].forEach(function (p) { allPoints.push(p); });
    });

    if (!allPoints.length) {
      return [svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "rate-axis-text" },
        "표시할 데이터가 없습니다 (범례에서 은행을 선택하거나 전체보기를 눌러보세요)")];
    }

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

    // 포인트 마커: 줌 창 안에 보이는 점 개수가 적을 때만(성능/시인성) — day 집계라도 충분히
    // 확대하면 자연히 개수가 줄어 마커+툴팁이 나타난다.
    var MARKER_THRESHOLD = 200;

    banks.forEach(function (b) {
      if (hiddenSet[b.id]) return;
      var pts = visibleByBank[b.id];
      if (!pts.length) return;
      var d = pts.map(function (p, idx) {
        var x = xPix(keyToTime(p.key, gran));
        var y = yPix(p.value);
        return (idx === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
      nodes.push(svgEl("path", { d: d, class: "rate-line", style: "stroke:" + b.color }));

      if (pts.length <= MARKER_THRESHOLD) {
        pts.forEach(function (p) {
          var x = xPix(keyToTime(p.key, gran));
          var y = yPix(p.value);
          nodes.push(svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6, class: "rate-point", style: "fill:" + b.color },
            svgEl("title", null, b.label + " · " + p.label + " · " + p.value.toFixed(2) + "%")));
        });
      }
    });

    return nodes;
  }

  // buildChart: 구조적 렌더(초기 마운트/범례 토글/세그먼트 전환/전체보기)에서만 호출 — 새 <svg>를
  // 만들고 인터랙션 리스너를 (다시) 붙인다. 휠/드래그/핀치 도중에는 절대 호출하지 않는다
  // (updateChartGeometry가 대신 같은 노드의 내용만 갱신 — attachInteraction 참고 주석).
  function buildChart(banks, seriesByBank, gran, hiddenSet) {
    var nodes = computeChartNodes(banks, seriesByBank, gran, hiddenSet);
    var svg = svgEl("svg", {
      viewBox: "0 0 " + CHART_W + " " + CHART_H,
      class: svgBaseClass(),
      preserveAspectRatio: "none"
    }, nodes);
    attachInteraction(svg);
    return svg;
  }

  // updateChartGeometry: 인터랙션(휠/드래그/핀치) 중 재렌더 경로. 기존 svg 엘리먼트를 그대로 두고
  // 내용(축/선/마커)만 다시 채운다 — 리스너 재부착도, 카드/범례/버튼 재생성도 없다.
  function updateChartGeometry() {
    if (!currentSvgNode) return;
    var nodes = computeChartNodes(JF.ratesData.banks, JF.ratesData.series, granularity, hidden);
    currentSvgNode.textContent = "";
    nodes.forEach(function (n) { currentSvgNode.appendChild(n); });
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
        el("div", { class: "field-row" }, [
          renderGranSeg(),
          el("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: resetZoom }, "전체보기")
        ])
      ]),
      el("div", { class: "rate-chart-wrap" }, buildChart(JF.ratesData.banks, JF.ratesData.series, granularity, hidden)),
      renderLegend(JF.ratesData.banks),
      el("p", { class: "muted rate-caption" },
        "마우스 휠(또는 모바일 핀치)로 확대/축소, 드래그로 좌우 이동. " +
        "금융채6개월 기준금리 — 신한은행은 일별 고시값, SC제일은행은 최근 10영업일 평균(은행 공시 산출 방식)이라 두 값을 직접 비교할 때 참고하세요.")
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

  ensureFullRange();
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
  window.addEventListener("touchmove", onWindowTouchMove, { passive: false });
  window.addEventListener("touchend", onWindowTouchEnd);
  window.addEventListener("touchcancel", onWindowTouchCancel);

  JF.ui.renderNav("rates.html");
  render();
})();
