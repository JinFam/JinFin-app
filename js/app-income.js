// app-income.js — 컴포넌트 2: 수입 관리 (AC-2.x)
// 월급 기본+월별 override, 성과급 BonusEvent CRUD(계획→실제, recurring 매년, ★). 원 저장 / 만원 입력.
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var openExtraId = null;      // 추가 수입: 펼쳐진 항목 id

  function man(n) { return JF.format.toMan(n); }
  function fromMan(m) { return JF.format.fromMan(m); }
  function uid(prefix) { return prefix + "-" + Math.random().toString(36).slice(2, 8); }
  function save() { JF.store.save(state); render(); }

  // ---- 월급 (기본 + 기간별) --------------------------------------------
  function renderSalary() {
    var host = document.getElementById("salary-card");
    host.innerHTML = "";
    var body = el("div", { class: "card-body stack" }, []);

    // 기본 월급
    var defaultInput = el("input", { type: "number", value: man(state.income.salaryDefault), min: "0", step: "0.1" });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "기본 월급(만원):"), defaultInput,
      el("button", { class: "btn btn-sm btn-primary", onClick: function () {
        state.income.salaryDefault = fromMan(defaultInput.value); save();
      } }, "저장")
    ]));
    body.appendChild(el("div", { class: "muted" }, "기간별 월급이 설정되기 전(첫 구간 이전)의 달에 적용됩니다."));

    // 기간별 월급
    body.appendChild(el("div", { class: "subhead" }, "기간별 월급"));
    body.appendChild(el("div", { class: "muted" }, "각 구간은 fromMonth부터 다음 구간 전까지 계속 적용됩니다(별도 종료월 없음)."));

    var segs = state.income.salarySegments || (state.income.salarySegments = []);
    segs.slice().sort(function (a, b) { return JF.format.ymCompare(a.fromMonth, b.fromMonth); }).forEach(function (seg) {
      var monthInput = el("input", { type: "month", value: seg.fromMonth, min: state.meta.horizon.start });
      var amountInput = el("input", { type: "number", value: man(seg.amount), min: "0", step: "0.1" });
      var labelInput = el("input", { type: "text", value: seg.label || "", placeholder: "예: 이직 후 월급" });
      body.appendChild(el("div", { class: "field-row" }, [
        el("label", null, "시작월:"), monthInput,
        el("label", null, "월급(만원):"), amountInput,
        el("label", null, "제목(선택):"), labelInput,
        el("button", { class: "btn btn-sm btn-primary", onClick: function () {
          seg.fromMonth = monthInput.value;
          seg.amount = fromMan(amountInput.value);
          seg.label = labelInput.value;
          save();
        } }, "저장"),
        el("button", { class: "btn btn-sm btn-danger push-right", onClick: function () {
          state.income.salarySegments = state.income.salarySegments.filter(function (s) { return s.id !== seg.id; });
          save();
        } }, "삭제")
      ]));
    });

    // 기간 추가
    var newMonth = el("input", { type: "month", value: state.meta.horizon.start, min: state.meta.horizon.start });
    var newAmount = el("input", { type: "number", value: "0", min: "0", step: "0.1" });
    var newLabel = el("input", { type: "text", value: "", placeholder: "예: 이직 후 월급" });
    body.appendChild(el("div", { class: "field-row" }, [
      el("label", null, "시작월:"), newMonth,
      el("label", null, "월급(만원):"), newAmount,
      el("label", null, "제목(선택):"), newLabel,
      el("button", { class: "btn btn-sm btn-secondary", onClick: function () {
        if (!newMonth.value) return;
        var seg = JF.schema.emptySalarySegment();
        seg.id = uid("sal");
        seg.fromMonth = newMonth.value;
        seg.amount = fromMan(newAmount.value);
        seg.label = newLabel.value;
        state.income.salarySegments.push(seg);
        save();
      } }, "+ 기간 추가")
    ]));

    var card = el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, "월급")),
      body
    ]);
    host.appendChild(card);
  }

  // ---- 추가 수입 -------------------------------------------------------
  function addExtra(kind) {
    var e = JF.schema.emptyExtraIncome();
    e.id = uid("xinc");
    e.kind = kind;
    e.month = state.meta.horizon.start;
    e.label = kind === "추가수당" ? "새 추가수당" : "새 비정기수입";
    state.income.extraIncomes.push(e);
    save();
  }

  function removeExtra(id) {
    state.income.extraIncomes = state.income.extraIncomes.filter(function (x) { return x.id !== id; });
    if (openExtraId === id) openExtraId = null;
    save();
  }

  // 접힌 한 줄 요약: [월] [종류 배지] [이름] [계획 금액] [펼치기/닫기]
  function extraSummaryRow(item) {
    return el("div", { class: "field-row" }, [
      el("span", null, item.month),
      el("span", { class: "badge badge-muted" }, item.kind),
      el("span", null, item.label),
      el("span", { class: "num" }, JF.format.formatMan(item.plannedAmount)),
      el("button", { class: "btn btn-sm btn-secondary push-right", onClick: function () {
        openExtraId = (openExtraId === item.id ? null : item.id); render();
      } }, openExtraId === item.id ? "닫기" : "펼치기")
    ]);
  }

  // 펼침 상세 편집기 — 입력 즉시 item에 반영(#3 패턴 준용)해 저장 전 유실 방지
  function extraDetailEditor(item) {
    var body = el("div", { class: "card-body stack" }, []);

    var label = el("input", { type: "text", value: item.label, onInput: function () { item.label = label.value; } });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "이름:"), label]));

    var kindSel = el("select", { onChange: function () { item.kind = kindSel.value; } }, [
      el("option", { value: "추가수당", selected: item.kind === "추가수당" }, "추가수당"),
      el("option", { value: "비정기수입", selected: item.kind === "비정기수입" }, "비정기수입")
    ]);
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "종류:"), kindSel]));

    var monthInput = el("input", { type: "month", value: item.month, min: state.meta.horizon.start,
      onInput: function () { item.month = monthInput.value; } });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "월:"), monthInput]));

    var planned = el("input", { type: "number", value: man(item.plannedAmount), min: "0", step: "0.1" });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "계획 금액(만원):"), planned]));

    var actual = el("input", { type: "number", value: (item.actualAmount != null ? man(item.actualAmount) : ""), placeholder: "미확정", min: "0", step: "0.1" });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "실제 금액(만원):"), actual]));

    var note = el("textarea", { rows: "3", onInput: function () { item.note = note.value; } }, item.note || "");
    body.appendChild(el("div", null, [el("label", null, "상세 내역:"), note]));

    body.appendChild(el("div", { class: "field-row" }, [
      el("button", { class: "btn btn-sm btn-primary", onClick: function () {
        item.label = label.value;
        item.kind = kindSel.value;
        item.month = monthInput.value;
        item.plannedAmount = fromMan(planned.value);
        item.actualAmount = (actual.value === "" ? null : fromMan(actual.value));
        item.note = note.value;
        save();
      } }, "저장"),
      el("button", { class: "btn btn-sm btn-danger", onClick: function () { removeExtra(item.id); } }, "삭제")
    ]));

    return el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, "추가 수입 편집")),
      body
    ]);
  }

  function renderExtra() {
    var host = document.getElementById("extra-card");
    host.innerHTML = "";
    var list = state.income.extraIncomes || (state.income.extraIncomes = []);

    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, "추가 수입"),
      el("div", { class: "field-row push-right" }, [
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () { addExtra("추가수당"); } }, "+ 추가수당"),
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () { addExtra("비정기수입"); } }, "+ 비정기수입")
      ])
    ]);

    var body = el("div", { class: "card-body stack" }, []);
    if (!list.length) {
      body.appendChild(el("p", { class: "muted" }, "추가 수입 항목이 없습니다. 위 버튼으로 추가수당/비정기수입을 추가하세요."));
    } else {
      list.slice().sort(function (a, b) { return JF.format.ymCompare(a.month, b.month); }).forEach(function (item) {
        body.appendChild(extraSummaryRow(item));
        if (openExtraId === item.id) body.appendChild(extraDetailEditor(item));
      });
    }

    host.appendChild(el("div", { class: "card" }, [header, body]));
  }

  // ---- 성과급 ---------------------------------------------------------
  function yearsInHorizon() {
    var out = [], seen = {};
    JF.format.ymRange(state.meta.horizon.start, state.meta.horizon.end).forEach(function (m) {
      var y = m.slice(0, 4); if (!seen[y]) { seen[y] = true; out.push(y); }
    });
    return out;
  }

  function bonusEditor(ev) {
    var wrap = el("div", { class: "card" }, []);
    var header = el("div", { class: "card-header" }, [
      el("span", { class: "card-title" }, [ev.label || "(무제목)", " ",
        el("span", { class: "badge badge-star" }, "★".repeat(Math.min(3, ev.starTag || 1)))]),
      el("span", { class: "badge " + (ev.recurring ? "badge-muted" : "") }, ev.recurring ? "매년 반복" : "상시(1회)")
    ]);
    var body = el("div", { class: "card-body stack" }, []);

    var label = el("input", { type: "text", value: ev.label || "" });
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "이름:"), label]));

    if (ev.recurring) {
      var md = el("input", { type: "text", value: ev.monthDay || "", placeholder: "MM-DD" });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "매년 날짜(MM-DD):"), md]));
      var planned = el("input", { type: "number", value: man(ev.plannedAmount), min: "0", step: "0.1" });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "계획 금액(만원):"), planned]));
      // 연도별 실제
      body.appendChild(el("div", { class: "muted" }, "연도별 실제 금액(만원, 확정 시 입력):"));
      var yearInputs = {};
      yearsInHorizon().forEach(function (y) {
        var cur = ev.actualsByYear && ev.actualsByYear[y];
        var yi = el("input", { type: "number", value: (cur != null ? man(cur) : ""), placeholder: "미확정", min: "0", step: "0.1" });
        yearInputs[y] = yi;
        body.appendChild(el("div", { class: "field-row" }, [el("span", null, y + "년:"), yi]));
      });
      body.appendChild(el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-sm btn-primary", onClick: function () {
          ev.label = label.value; ev.monthDay = md.value; ev.plannedAmount = fromMan(planned.value);
          ev.actualsByYear = ev.actualsByYear || {};
          Object.keys(yearInputs).forEach(function (y) {
            var v = yearInputs[y].value;
            if (v === "") { delete ev.actualsByYear[y]; } else { ev.actualsByYear[y] = fromMan(v); }
          });
          save();
        } }, "저장"),
        el("button", { class: "btn btn-sm btn-danger", onClick: function () { removeBonus(ev.id); } }, "삭제")
      ]));
    } else {
      var date = el("input", { type: "date", value: ev.date || "" });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "날짜:"), date]));
      var plannedA = el("input", { type: "number", value: man(ev.plannedAmount), min: "0", step: "0.1" });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "계획 금액(만원):"), plannedA]));
      var actualA = el("input", { type: "number", value: (ev.actualAmount != null ? man(ev.actualAmount) : ""), placeholder: "미확정", min: "0", step: "0.1" });
      body.appendChild(el("div", { class: "field-row" }, [el("label", null, "실제 금액(만원):"), actualA]));
      body.appendChild(el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-sm btn-primary", onClick: function () {
          ev.label = label.value; ev.date = date.value; ev.plannedAmount = fromMan(plannedA.value);
          ev.actualAmount = (actualA.value === "" ? null : fromMan(actualA.value));
          save();
        } }, "저장"),
        el("button", { class: "btn btn-sm btn-secondary", onClick: function () { duplicateAdhoc(ev); } }, "복제"),
        el("button", { class: "btn btn-sm btn-danger", onClick: function () { removeBonus(ev.id); } }, "삭제")
      ]));
    }

    // 성과급 크기 태그(★)
    var starSel = el("select", { onChange: function () { ev.starTag = parseInt(starSel.value, 10); save(); } },
      [1, 2, 3].map(function (n) { return el("option", { value: String(n), selected: (ev.starTag === n) }, "★".repeat(n)); }));
    body.appendChild(el("div", { class: "field-row" }, [el("label", null, "성과급 크기(★):"), starSel]));

    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
  }

  function removeBonus(id) {
    state.income.bonusEvents = state.income.bonusEvents.filter(function (e) { return e.id !== id; });
    save();
  }
  function duplicateAdhoc(ev) {
    var copy = JSON.parse(JSON.stringify(ev));
    copy.id = uid("bonus"); copy.label = (ev.label || "성과급") + " (복제)";
    state.income.bonusEvents.push(copy); save();
  }
  function addRecurring() {
    var e = JF.schema.emptyBonusEvent();
    e.id = uid("bonus"); e.recurring = true; e.monthDay = "01-31"; e.label = "새 정기 성과급"; e.actualsByYear = {}; e.starTag = 2;
    state.income.bonusEvents.push(e); save();
  }
  function addAdhoc() {
    var e = JF.schema.emptyBonusEvent();
    e.id = uid("bonus"); e.recurring = false; e.date = state.meta.horizon.start + "-15"; e.label = "새 상시 성과급"; e.starTag = 1;
    state.income.bonusEvents.push(e); save();
  }

  function renderBonus() {
    var host = document.getElementById("bonus-card");
    host.innerHTML = "";
    host.appendChild(el("div", { class: "card-header" }, [
      el("h2", { class: "card-title" }, "성과급 이벤트"),
      el("div", { class: "field-row" }, [
        el("button", { class: "btn btn-sm btn-secondary", onClick: addRecurring }, "+ 정기(매년)"),
        el("button", { class: "btn btn-sm btn-secondary", onClick: addAdhoc }, "+ 상시(1회)")
      ])
    ]));
    var grid = el("div", { class: "card-grid" }, (state.income.bonusEvents || []).map(bonusEditor));
    host.appendChild(grid);
    host.appendChild(el("p", { class: "muted" }, "정기 성과급(1/31·7/8·12/24)은 매년 반복되며 연도별 실제 금액을 따로 확정합니다. 상시 성과급은 특정 날짜 1회이며 [복제]로 손쉽게 추가할 수 있습니다. ★는 예상 규모 힌트입니다."));
  }

  function render() { renderSalary(); renderExtra(); renderBonus(); }

  function boot() {
    JF.ui.renderNav("income.html");
    state = JF.store.load();
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
