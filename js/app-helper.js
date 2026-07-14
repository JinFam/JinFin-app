// app-helper.js — 컴포넌트 5: 카드 도우미 (AC-5.x)
// v1 실적 게이지(gaugeFor, ACTUAL-first, 카드별 산정기간) + v2 추천기(best-effort, 정확도 non-goal).
(function () {
  "use strict";
  var JF = window.JF;
  var el = JF.ui.el;
  var state;
  var loanSchedules = {}; // render()에서 재계산 — 자동 모드 대출 항목의 실적 게이지 반영용

  function man(n) { return JF.format.toMan(n); }
  function today() { return new Date(); } // 앱 계층에서 실제 오늘(윈도우 판정용) — calc는 순수 유지

  // 현재 산정기간 window의 종료일(Date) — 마감임박 판정용
  function windowEndDate(card, windowKey) {
    var s = card.billingWindow.start;
    var y = parseInt(windowKey.slice(0, 4), 10);
    var m1 = parseInt(windowKey.slice(5, 7), 10); // 1~12
    if (!s || s === 1) {
      return new Date(y, m1, 0); // 그 달 말일
    }
    var nx = JF.format.ymAdd(windowKey, 1);
    var ny = parseInt(nx.slice(0, 4), 10), nm1 = parseInt(nx.slice(5, 7), 10);
    return new Date(ny, nm1 - 1, s - 1);
  }

  // ---- 실적 게이지 (AC-5.1, 5.2) -------------------------------------
  function gaugeCard(card, now) {
    var wk = JF.calc.windowKeyFor(card, now);
    var g = JF.calc.gaugeFor(state, card, wk, loanSchedules);
    var pct = g.threshold > 0 ? Math.min(100, Math.round((g.earned / g.threshold) * 100)) : (g.met ? 100 : 0);
    var endDate = windowEndDate(card, wk);
    var daysLeft = Math.ceil((endDate - now) / 86400000);
    var nearDeadline = !g.met && daysLeft >= 0 && daysLeft <= 7;

    var barColor = g.met ? "var(--jf-success)" : (nearDeadline ? "var(--jf-danger)" : "var(--jf-primary)");
    var bar = el("div", { style: { background: "var(--jf-bg-sunken)", borderRadius: "6px", overflow: "hidden", height: "14px", width: "100%" } },
      el("div", { style: { width: pct + "%", height: "100%", background: barColor } }, ""));

    var statusBadge = g.met
      ? el("span", { class: "badge" }, "달성 ✓")
      : el("span", { class: "badge badge-danger" }, "미달");
    var deadlineBadge = nearDeadline ? el("span", { class: "badge badge-danger" }, "마감임박 " + daysLeft + "일") : null;

    return el("div", { class: "card" + (g.met ? "" : " row-highlight") }, [
      el("div", { class: "card-header" }, [
        el("span", { class: "card-title" }, card.name),
        el("span", null, [statusBadge, " ", deadlineBadge])
      ]),
      el("div", { class: "card-body stack" }, [
        el("div", { class: "field-row" }, [
          el("span", { class: "muted" }, "산정기간 " + wk + " · 마감 " + (endDate.getMonth() + 1) + "/" + endDate.getDate())
        ]),
        bar,
        el("div", { class: "field-row" }, [
          el("span", { class: "num" }, "실적 " + JF.format.formatMan(g.earned)),
          el("span", { class: "muted" }, " / 필요 " + JF.format.formatMan(g.threshold)),
          el("span", { class: "num" + (g.met ? "" : " negative") }, g.met ? " (충족)" : (" 남은 " + JF.format.formatMan(g.remaining)))
        ])
      ])
    ]);
  }

  function renderGauges() {
    var host = document.getElementById("gauges");
    host.innerHTML = "";
    var now = today();
    var cards = (state.cards || []).slice();
    // 미달/마감임박 우선 정렬
    cards.sort(function (a, b) {
      var ga = JF.calc.gaugeFor(state, a, JF.calc.windowKeyFor(a, now), loanSchedules);
      var gb = JF.calc.gaugeFor(state, b, JF.calc.windowKeyFor(b, now), loanSchedules);
      if (ga.met !== gb.met) return ga.met ? 1 : -1;      // 미달 먼저
      return gb.remaining - ga.remaining;                 // 남은 실적 큰 것 먼저
    });
    cards.forEach(function (c) { host.appendChild(gaugeCard(c, now)); });
    if (cards.length === 0) host.appendChild(el("p", { class: "muted" }, "등록된 카드가 없습니다. [카드] 페이지에서 추가하세요."));
  }

  // ---- 추천기 (AC-5.3, best-effort) ----------------------------------
  function scoreCard(card, category, amountWon, now) {
    var reasons = [];
    var score = 0;
    var cat = (category || "").toLowerCase();

    // 혜택/사용처 키워드 매칭
    var hay = ((card.mainMerchants || []).join(" ") + " " + (card.benefits || []).map(function (b) { return b.desc; }).join(" ")).toLowerCase();
    if (cat && hay.indexOf(cat) >= 0) { score += 50; reasons.push("'" + category + "' 관련 혜택/사용처 매칭"); }
    (card.mainMerchants || []).forEach(function (mm) {
      if (cat && (mm.toLowerCase().indexOf(cat) >= 0 || cat.indexOf(mm.toLowerCase()) >= 0)) { score += 30; reasons.push("주요사용처: " + mm); }
    });

    // 실적 미충족이면 우선순위 상승(전월실적 채우기)
    var g = JF.calc.gaugeFor(state, card, JF.calc.windowKeyFor(card, now), loanSchedules);
    if (!g.met) {
      var help = Math.min(40, Math.round((Math.min(amountWon, g.remaining) / Math.max(1, g.threshold)) * 40));
      score += 10 + help;
      reasons.push("실적 미달(남은 " + JF.format.formatMan(g.remaining) + ") — 이 결제로 실적 채우기 유리");
    } else {
      reasons.push("실적 이미 충족");
    }
    return { card: card, score: score, reasons: reasons, met: g.met };
  }

  function renderRecommender() {
    var host = document.getElementById("recommender");
    host.innerHTML = "";
    var catInput = el("input", { type: "text", placeholder: "예: 이마트, 스타벅스, 온라인쇼핑, 주유", list: "cat-list" });
    var datalist = el("datalist", { id: "cat-list" }, (state.categories || []).map(function (c) { return el("option", { value: c.name }); }));
    var amtInput = el("input", { type: "number", placeholder: "금액(만원)", min: "0", step: "0.1" });
    var out = el("div", { class: "stack" }, []);

    function run() {
      out.innerHTML = "";
      var amountWon = JF.format.fromMan(amtInput.value || 0);
      var now = today();
      var ranked = (state.cards || []).map(function (c) { return scoreCard(c, catInput.value, amountWon, now); })
        .sort(function (a, b) { return b.score - a.score; });
      var top = ranked.slice(0, 3);
      if (top.length === 0) { out.appendChild(el("p", { class: "muted" }, "카드가 없습니다.")); return; }
      top.forEach(function (r, i) {
        out.appendChild(el("div", { class: "card" + (i === 0 ? "" : "") }, [
          el("div", { class: "card-header" }, [
            el("span", { class: "card-title" }, (i === 0 ? "① 추천 " : (i + 1) + "순위 ") + r.card.name),
            el("span", { class: "badge " + (r.met ? "badge-muted" : "badge-danger") }, r.met ? "실적 충족" : "실적 미달")
          ]),
          el("div", { class: "card-body" }, el("ul", { class: "stack" }, r.reasons.map(function (t) { return el("li", { class: "muted" }, t); })))
        ]));
      });
    }

    host.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-header" }, el("span", { class: "card-title" }, "카드 추천 (참고용)")),
      el("div", { class: "card-body stack" }, [
        el("div", { class: "field-row" }, [
          el("label", null, "지출 업종:"), catInput, datalist,
          el("label", null, "금액:"), amtInput,
          el("button", { class: "btn btn-sm btn-primary", onClick: run }, "추천 보기")
        ]),
        el("p", { class: "muted" }, "※ 카드 혜택 규칙은 수기로 관리되는 텍스트라 추천은 참고용입니다(정확도는 보장 대상이 아님). 실적 미달 카드와 업종 키워드 매칭을 우선 고려합니다."),
        out
      ])
    ]));
  }

  function render() {
    loanSchedules = (JF.ui && typeof JF.ui.buildLoanSchedules === "function") ? JF.ui.buildLoanSchedules(state) : {};
    renderRecommender();
    renderGauges();
    document.getElementById("helper-note").textContent =
      "실적은 각 카드의 고유 산정기간(달력월이 아님) 기준으로, 해당 카드에 태그되고 '실적 포함'인 실제 지출만 합산합니다. " +
      "지출 항목의 카드 배정·결제일·실적 포함 여부는 [지출] 페이지에서 설정합니다.";
  }

  function boot() {
    JF.ui.renderNav("card-helper.html");
    state = JF.store.load();
    render();
    if (JF.syncUI) JF.syncUI.bind({ get: function () { return state; }, set: function (s) { state = s; }, render: render });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
