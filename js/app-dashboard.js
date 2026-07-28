// app-dashboard.js — 컴포넌트 1: 월별 현금흐름 대시보드 (AC-1.x)
// JF.calc 를 소비만 한다(재구현 금지). 금액은 원 저장 / 만원 표시.
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var mode = "hybrid"; // hybrid | plan | actual
  var showVar = false;
  var loanSchedules = {}; // 자동 모드 대출 항목용 스케줄 맵(render() 시작부에서 재계산)

  function man(n) { return JF.format.toMan(n); }           // 원 -> 만원(정수)
  function manCell(n) { return JF.format.formatManNum(n); } // 콤마+천원 소수, "만" 없음(호출부가 붙임/셀은 바)

  // ---- 항목별 월 셀 값 (모드에 따라 selector 전환) --------------------
  function cellFor(item, month) {
    if (!JF.calc.occursIn(item, month, loanSchedules)) return null;
    if (mode === "plan") return JF.calc.effectiveValueFor(item, month, loanSchedules).plannedAmount;
    if (mode === "actual") {
      var ev = JF.calc.effectiveValueFor(item, month, loanSchedules);
      var a = item.actualsByMonth && item.actualsByMonth[month];
      return (a != null) ? a : (ev.actualAmount != null ? ev.actualAmount : ev.plannedAmount);
    }
    return JF.calc.monthlyValueFor(item, month, state.meta.currentMonth, loanSchedules); // hybrid
  }

  function salaryFor(month) {
    return JF.calc.salaryForMonth(state.income, month);
  }

  function extraFor(month) {
    var total = 0;
    (state.income.extraIncomes || []).forEach(function (x) {
      if (x.month !== month) return;
      var planned = x.plannedAmount || 0;
      var actual = (x.actualAmount != null ? x.actualAmount : planned);
      if (mode === "plan") total += planned;
      else if (mode === "actual") total += actual;
      else total += (JF.format.ymCompare(month, state.meta.currentMonth) < 0 ? actual : planned);
    });
    return total;
  }

  function bonusFor(month) {
    // returns { amount, star } for the given mode
    var total = 0, star = 0;
    (state.income.bonusEvents || []).forEach(function (ev) {
      if (!JF.calc.bonusOccursIn(ev, month)) return;
      var planned = ev.plannedAmount, val;
      if (mode === "plan") { val = planned; }
      else if (mode === "actual") {
        val = ev.recurring
          ? (ev.actualsByYear && ev.actualsByYear[month.slice(0, 4)] != null ? ev.actualsByYear[month.slice(0, 4)] : planned)
          : (ev.actualAmount != null ? ev.actualAmount : planned);
      } else { // hybrid
        var actual = ev.recurring
          ? (ev.actualsByYear && ev.actualsByYear[month.slice(0, 4)] != null ? ev.actualsByYear[month.slice(0, 4)] : planned)
          : (ev.actualAmount != null ? ev.actualAmount : planned);
        val = (JF.format.ymCompare(month, state.meta.currentMonth) < 0) ? actual : planned;
      }
      total += val;
      if (ev.starTag > star) star = ev.starTag;
    });
    return { amount: total, star: star };
  }

  function balanceFor(row) {
    if (mode === "plan") return row.balanceEndPlan;
    if (mode === "actual") return row.balanceEndActual;
    return row.balanceEnd;
  }

  // ---- KPI 타일 ------------------------------------------------------
  function renderKpis(rows) {
    var host = document.getElementById("dash-kpis");
    host.innerHTML = "";
    var cur = state.meta.currentMonth;
    var inHorizon = rows.some(function (r) { return r.month === cur; });
    var curRow = rows.filter(function (r) { return r.month === cur; })[0] || rows[0];
    var firstNeg = rows.filter(function (r) { return balanceFor(r) < 0; })[0];
    var lowest = rows.reduce(function (a, r) { return balanceFor(r) < balanceFor(a) ? r : a; }, rows[0]);

    function tile(label, value, sub, danger) {
      return el("div", { class: "kpi-tile" }, [
        el("div", { class: "kpi-label" }, label),
        el("div", { class: "kpi-value" + (danger ? " negative" : "") }, value),
        el("div", { class: "kpi-sub" }, sub || "")
      ]);
    }
    host.appendChild(tile(
      inHorizon ? ("현재 통장 (" + cur + ")") : ("통장 (" + (curRow ? curRow.month : "-") + ")"),
      curRow ? manCell(balanceFor(curRow)) + "만" : "-",
      inHorizon ? "이번 달 말 예상 잔액" : ("현재월 " + cur + "은 기간 밖 — 기간 첫 달 표시")));
    host.appendChild(tile("시드 잔액", manCell(state.account.seedBalance) + "만", "시작 통장(수동 입력)"));
    host.appendChild(tile("최저 잔액", lowest ? manCell(balanceFor(lowest)) + "만" : "-", lowest ? lowest.month : "", lowest && balanceFor(lowest) < 0));
    host.appendChild(tile("최초 마이너스", firstNeg ? firstNeg.month : "없음", firstNeg ? manCell(balanceFor(firstNeg)) + "만" : "기간 내 안전", !!firstNeg));
  }

  // ---- 컨트롤(모드/기간/백업) ---------------------------------------
  function renderControls() {
    var host = document.getElementById("dash-controls");
    host.innerHTML = "";

    function modeBtn(key, label) {
      return el("button", {
        class: "btn btn-sm " + (mode === key ? "btn-primary" : "btn-secondary"),
        onClick: function () { mode = key; render(); }
      }, label);
    }
    var modeRow = el("div", { class: "field-row" }, [
      el("span", { class: "muted" }, "표시 모드:"),
      modeBtn("hybrid", "혼합(과거실제·미래계획)"),
      modeBtn("plan", "계획"),
      modeBtn("actual", "실제"),
      el("button", {
        class: "btn btn-sm " + (showVar ? "btn-primary" : "btn-ghost"),
        onClick: function () { showVar = !showVar; render(); }
      }, "계획−실제 차이")
    ]);

    var start = el("input", { type: "month", value: state.meta.horizon.start });
    var end = el("input", { type: "month", value: state.meta.horizon.end });
    var horizonRow = el("div", { class: "field-row" }, [
      el("span", { class: "muted" }, "기간:"),
      start, el("span", { class: "muted" }, "~"), end,
      el("button", {
        class: "btn btn-sm btn-secondary",
        onClick: function () {
          if (start.value && end.value && JF.format.ymCompare(start.value, end.value) <= 0) {
            state.meta.horizon.start = start.value;
            state.meta.horizon.end = end.value;
            JF.store.save(state); render();
          }
        }
      }, "적용")
    ]);

    var backupRow = el("div", { class: "field-row" }, [
      el("span", { class: "muted" }, JF.store.lastBackupInfo()),
      el("button", { class: "btn btn-sm btn-secondary", onClick: function () { JF.store.exportJson(state); render(); } }, "내보내기(백업)"),
      (function () {
        var f = el("input", { type: "file", accept: "application/json", style: { display: "none" },
          onChange: function (e) {
            if (e.target.files && e.target.files[0]) {
              JF.store.importJson(e.target.files[0], function (s) {
                if (!s.meta) s.meta = {};
                s.meta.currentMonth = JF.format.ym(new Date()); // 가져온 파일의 stale currentMonth 갱신(#7)
                state = s; JF.store.save(state); render();
              });
            }
          } });
        var b = el("button", { class: "btn btn-sm btn-ghost", onClick: function () { f.click(); } }, "가져오기(복원)");
        return el("span", null, [b, f]);
      })()
    ]);

    var seedInput = el("input", { type: "number", value: man(state.account.seedBalance), min: "0", step: "0.1" });
    var seedRow = el("div", { class: "field-row" }, [
      el("span", { class: "muted" }, "시작 통장 잔액(만원):"), seedInput,
      el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
        state.account.seedBalance = JF.format.fromMan(seedInput.value);
        JF.store.save(state); render();
      } }, "저장")
    ]);

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, "표시 설정")),
      el("div", { class: "card-body stack" }, [modeRow, horizonRow, seedRow, backupRow])
    ]));
  }

  // ---- 메인 표 -------------------------------------------------------
  function renderTable(rows) {
    var table = document.getElementById("dash-table");
    table.innerHTML = "";
    var months = rows.map(function (r) { return r.month; });

    // 수입 값(헤더의 ★ 배치를 위해 먼저 계산) — 성과급 별표를 날짜 위에 표기해 데이터 셀 폭을 일정하게 유지(#4)
    var salaryVals = {}, bonusVals = {}, extraVals = {}, starVals = {};
    // 월급 섹션별(동시 발생하는 여러 수입원, 예: 본인/배우자) 행 데이터 — 섹션당 한 행.
    var salaryTracks = (state.income.salaries || []).map(function (sal) {
      return { label: sal.label, valuesByMonth: {}, labelByMonth: {}, titleByMonth: {}, prevSegLabel: undefined };
    });
    months.forEach(function (m) {
      salaryVals[m] = salaryFor(m); // 합산(순계 계산용, 아래 netVals가 그대로 사용)
      var breakdown = JF.calc.salaryBreakdownForMonth(state.income, m);
      breakdown.forEach(function (b, i) {
        var track = salaryTracks[i];
        if (!track) return;
        track.valuesByMonth[m] = b.amount;
        track.titleByMonth[m] = b.segmentLabel; // 모든 달에 호버 툴팁으로 적용 중인 구간명 표시
        if (b.segmentLabel && b.segmentLabel !== track.prevSegLabel) track.labelByMonth[m] = b.segmentLabel; // 구간 전환월에만 배지
        track.prevSegLabel = b.segmentLabel;
      });
      var bon = bonusFor(m);
      bonusVals[m] = bon.amount || 0;
      if (bon.star) starVals[m] = bon.star;
      extraVals[m] = extraFor(m);
    });

    // 헤더 — 성과급이 있는 달은 날짜(월) 위에 ★ 표기
    var head = el("tr", null, [el("th", { class: "text-left" }, "항목")].concat(
      months.map(function (m) {
        var s = starVals[m];
        var lbl = m.replace("-", ".");
        return el("th", { class: "text-right" }, s
          ? [el("div", { class: "th-star" }, "★".repeat(Math.min(3, s))), lbl]
          : lbl);
      })
    ));
    var thead = el("thead", null, head);

    var tbody = el("tbody", null, []);

    function dataRow(label, valuesByMonth, opts) {
      opts = opts || {};
      var labelNode = opts.href ? el("a", { href: opts.href, class: "row-link" }, label) : label;
      var cells = [el("th", { class: "text-left" + (opts.rowClass ? " " + opts.rowClass : "") }, labelNode)];
      months.forEach(function (m) {
        var v = valuesByMonth[m];
        var txt = (v == null) ? "" : manCell(v);
        var cls = "num text-right";
        if (opts.negative && v != null && v < 0) cls += " negative";
        var star = opts.starByMonth && opts.starByMonth[m];
        var badgeLabel = opts.labelByMonth && opts.labelByMonth[m];
        var titleAttr = opts.titleByMonth && opts.titleByMonth[m];
        var content = txt;
        if (star) content = [txt + " ", el("span", { class: "badge badge-star" }, "★".repeat(Math.min(3, star)))];
        else if (badgeLabel) content = [txt + " ", el("span", { class: "badge badge-muted" }, badgeLabel)];
        cells.push(el("td", { class: cls, title: titleAttr || null }, content));
      });
      return el("tr", { class: opts.rowClass || null }, cells);
    }

    // 수입
    tbody.appendChild(el("tr", null, [el("th", { colspan: months.length + 1, class: "text-left muted" }, "수입")]));
    // 월급 섹션별 행(섹션 이름이 있으면 "월급 (본인 월급)" 형태로 구분, 없으면 그냥 "월급").
    salaryTracks.forEach(function (track) {
      var rowLabel = "월급" + (track.label ? " (" + track.label + ")" : "");
      tbody.appendChild(dataRow(rowLabel, track.valuesByMonth, {
        href: "income.html#salary-card",
        labelByMonth: track.labelByMonth,
        titleByMonth: track.titleByMonth
      }));
    });
    tbody.appendChild(dataRow("성과급", bonusVals, { href: "income.html#bonus-card" }));
    tbody.appendChild(dataRow("추가 수입", extraVals, { href: "income.html#extra-card" }));

    // 지출 — 대출(개별, 강조) + 특수(개별, 강조) + 고정-카드/고정-이체/생활/교육/추가
    tbody.appendChild(el("tr", null, [el("th", { colspan: months.length + 1, class: "text-left muted" }, "지출")]));
    // 대출 개별행(탭 순서와 동일하게 특수보다 위). 특수처럼 집계 제외, 개별행 전용.
    (state.loanExpenses || []).forEach(function (li) {
      var vals = {};
      months.forEach(function (m) { var v = cellFor(li, m); if (v != null) vals[m] = v; });
      tbody.appendChild(dataRow(li.name, vals, { rowClass: "row-highlight",
        href: "expenses.html?tab=" + encodeURIComponent("대출") + "&open=" + encodeURIComponent(li.id) }));
    });
    (state.specials || []).forEach(function (sp) {
      var vals = {};
      months.forEach(function (m) { var v = cellFor(sp, m); if (v != null) vals[m] = v; });
      tbody.appendChild(dataRow(sp.name, vals, { rowClass: "row-highlight",
        href: "expenses.html?tab=" + encodeURIComponent("특수") + "&open=" + encodeURIComponent(sp.id) }));
    });
    // 고정-카드/고정-이체/생활/교육/추가 집계 (breakdown 사용은 hybrid 전용이므로 셀 합으로 재계산해 모드 일관성 유지)
    ["고정-카드", "고정-이체", "생활", "교육", "추가"].forEach(function (type) {
      var vals = {}, any = false;
      months.forEach(function (m) {
        var sum = 0, hit = false;
        (state.expenses || []).forEach(function (it) {
          if (it.type !== type) return;
          var v = cellFor(it, m);
          if (v != null) { sum += v; hit = true; }
        });
        if (hit) { vals[m] = sum; any = true; }
      });
      if (any) tbody.appendChild(dataRow(type, vals, { href: "expenses.html?tab=" + encodeURIComponent(type) }));
    });

    // 요약
    tbody.appendChild(el("tr", null, [el("th", { colspan: months.length + 1, class: "text-left muted" }, "요약")]));
    var expenseVals = {}, netVals = {}, balVals = {}, varVals = {};
    rows.forEach(function (r) {
      var m = r.month;
      var exp = 0;
      // 대출(loanExpenses)도 포함 — rollforward 기반 '통장 잔액'과 '비용 합계'/'총계' 숫자가 어긋나지 않게.
      (state.expenses || []).concat(state.specials || []).concat(state.loanExpenses || []).forEach(function (it) {
        var v = cellFor(it, m); if (v != null) exp += v;
      });
      expenseVals[m] = exp;
      netVals[m] = (salaryVals[m] + bonusVals[m] + extraVals[m]) - exp;
      balVals[m] = balanceFor(r);
      varVals[m] = r.balanceEndPlan - r.balanceEndActual;
    });
    tbody.appendChild(dataRow("비용 합계", expenseVals));
    tbody.appendChild(dataRow("총계(순증감)", netVals, { negative: true }));
    tbody.appendChild(dataRow("통장 잔액", balVals, { negative: true, rowClass: "row-negative-src" }));

    // 계획−실제 차이 (AC-1.3): 잔액 차이 + 항목별 차이
    if (showVar) {
      tbody.appendChild(dataRow("계획−실제(잔액차이)", varVals, { negative: true }));
      // 월 -> itemId -> variance 맵
      var vmap = {};
      rows.forEach(function (r) {
        vmap[r.month] = {};
        (r.itemVariance || []).forEach(function (iv) { vmap[r.month][iv.id] = iv.variance; });
      });
      tbody.appendChild(el("tr", null, [el("th", { colspan: months.length + 1, class: "text-left muted" }, "항목별 계획−실제 차이 (양수=계획보다 덜 씀)")]));
      (state.loanExpenses || []).forEach(function (li) {
        var vv = {}, any = false;
        months.forEach(function (m) { if (vmap[m] && vmap[m][li.id] != null) { vv[m] = vmap[m][li.id]; any = true; } });
        if (any) tbody.appendChild(dataRow(li.name, vv, { negative: true, rowClass: "row-highlight" }));
      });
      (state.specials || []).forEach(function (sp) {
        var vv = {}, any = false;
        months.forEach(function (m) { if (vmap[m] && vmap[m][sp.id] != null) { vv[m] = vmap[m][sp.id]; any = true; } });
        if (any) tbody.appendChild(dataRow(sp.name, vv, { negative: true, rowClass: "row-highlight" }));
      });
      ["고정-카드", "고정-이체", "생활", "교육"].forEach(function (type) {
        var vv = {}, any = false;
        months.forEach(function (m) {
          var sum = 0, hit = false;
          (state.expenses || []).forEach(function (it) {
            if (it.type !== type) return;
            if (vmap[m] && vmap[m][it.id] != null) { sum += vmap[m][it.id]; hit = true; }
          });
          if (hit) { vv[m] = sum; any = true; }
        });
        if (any) tbody.appendChild(dataRow(type + " 차이", vv, { negative: true }));
      });
    }

    table.appendChild(thead);
    table.appendChild(tbody);
  }

  function render() {
    // 자동 모드 대출 항목의 월별 금액을 rollforward/셀 계산에 반영하려면 먼저 스케줄을 만든다.
    loanSchedules = JF.ui.buildLoanSchedules(state);
    var rows = JF.calc.rollforward(state, state.meta.currentMonth, loanSchedules);
    renderKpis(rows);
    renderControls();
    renderTable(rows);
    document.getElementById("dash-note").textContent =
      "혼합 모드: 현재월(" + state.meta.currentMonth + ") 이전은 실제값으로 잠기고 이후는 계획값으로 예측됩니다. " +
      "특수 항목(취득세·주담대·차용)은 강조 표시되며, 통장 잔액이 음수인 달은 빨간색으로 경고합니다. " +
      "성과급(★)은 유입 예정 시기에 표시됩니다.";
  }

  function boot() {
    JF.ui.renderNav("index.html");
    state = JF.store.load();
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
