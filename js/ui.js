// js/ui.js — JF.ui: shared render helpers (nav, banner, money formatting, DOM builder).
// Classic script. No ES modules, no fetch, no build step.
window.JF = window.JF || {};

(function () {
  "use strict";

  var NAV_ID = "jf-nav";
  var BANNER_ID = "jf-banner";

  var NAV_LINKS = [
    { href: "index.html", label: "대시보드" },
    { href: "income.html", label: "수입" },
    { href: "expenses.html", label: "지출" },
    { href: "cards.html", label: "카드/계좌" },
    { href: "checklist.html", label: "체크리스트" },
    { separator: true },
    { href: "realestate.html", label: "부동산 예산" },
    { href: "loan.html", label: "대출계산기" },
    { href: "rates.html", label: "금리" },
    { href: "card-helper.html", label: "카드도우미" }
  ];

  // el(tag, attrs, children) — small DOM builder helper.
  // attrs: className/class, style(object), on<Event> handlers, plain HTML attributes.
  // children: string | Node | Array<string|Node> (null/undefined entries are skipped).
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var val = attrs[key];
      if (val == null || val === false) return;
      if (key === "class" || key === "className") {
        node.className = val;
      } else if (key === "style" && typeof val === "object") {
        Object.keys(val).forEach(function (styleKey) {
          node.style[styleKey] = val[styleKey];
        });
      } else if (key.slice(0, 2) === "on" && typeof val === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (val === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, val);
      }
    });

    if (children != null) {
      var list = Array.isArray(children) ? children : [children];
      list.forEach(function (child) {
        if (child == null) return;
        if (typeof child === "string" || typeof child === "number") {
          node.appendChild(document.createTextNode(String(child)));
        } else {
          node.appendChild(child);
        }
      });
    }
    return node;
  }

  // renderNav(activePage): injects a <nav> with NAV_LINKS.length links, highlighting
  // activePage (e.g. "income.html"). Safe to call more than once (replaces any existing nav).
  // 가산금리(대출 조건). 최종금리 = 기준금리 + 가산금리. 조건이 바뀌면 이 값만 수정.
  var LOAN_SPREAD = 1.16;

  // 최종금리(기준금리+가산) 노출 — 대출계산기(loan.html) 연동 케이스용.
  // live(이번 로드에서 성공) -> localStorage 캐시(직전 성공값) -> null(둘 다 없음) 순으로 폴백.
  var FINAL_RATE_CACHE_KEY = "jinfinance:ui:finalRate";
  var _finalRate = null;          // 이번 페이지 로드에서 loadRefRate가 성공하면 채워짐(live)
  var _finalRateCallbacks = [];   // onFinalRate(cb) 등록 목록

  function cacheFinalRate(v) {
    try { window.localStorage.setItem(FINAL_RATE_CACHE_KEY, String(v)); } catch (e) {}
  }
  function cachedFinalRate() {
    try {
      var raw = window.localStorage.getItem(FINAL_RATE_CACHE_KEY);
      if (raw == null || raw === "") return null;
      var n = parseFloat(raw);
      return isNaN(n) ? null : n;
    } catch (e) { return null; }
  }

  // getFinalRate(): live(이번 로드 성공값) -> localStorage 캐시 -> null.
  function getFinalRate() {
    if (_finalRate != null) return _finalRate;
    return cachedFinalRate();
  }

  // onFinalRate(cb): 콜백 등록. 이미 값을 알고 있으면(live 또는 캐시) 즉시 1회 호출.
  function onFinalRate(cb) {
    if (typeof cb !== "function") return;
    _finalRateCallbacks.push(cb);
    var known = getFinalRate();
    if (known != null) { try { cb(known); } catch (e) {} }
  }

  function setFinalRate(v) {
    _finalRate = v;
    cacheFinalRate(v);
    _finalRateCallbacks.forEach(function (cb) { try { cb(v); } catch (e) {} });
    renderRepPayment(); // 최종금리 변동 → 연동된 대표 대출 원리금 실시간 갱신
  }

  // ---- 대표 대출(헤더 예상 원리금) — 기기 로컬 선택(동기화 안 함, finalRate 캐시와 동일 패턴) ----
  // 슬롯: main | sub1 | sub2. 같은 대출을 다른 슬롯에 지정하면 이전 슬롯은 해제(토글 오프).
  var REP_KEY = "jinfinance:loan:repId";        // 구버전(단일 대표) — main 으로 간주
  var REP_SLOTS_KEY = "jinfinance:loan:repSlots";
  var REP_SLOTS = ["main", "sub1", "sub2"];
  var REP_SLOT_LABEL = { main: "Main", sub1: "Sub1", sub2: "Sub2" };

  function getRepSlots() {
    var out = { main: null, sub1: null, sub2: null };
    try {
      var raw = window.localStorage.getItem(REP_SLOTS_KEY);
      if (raw) {
        var o = JSON.parse(raw) || {};
        REP_SLOTS.forEach(function (k) { out[k] = o[k] || null; });
      } else {
        out.main = window.localStorage.getItem(REP_KEY) || null;
      }
    } catch (e) {}
    return out;
  }
  function saveRepSlots(slots) {
    try {
      window.localStorage.setItem(REP_SLOTS_KEY, JSON.stringify(slots));
      window.localStorage.removeItem(REP_KEY);
    } catch (e) {}
  }
  // getRepSlot(id): id 가 지정된 슬롯 이름(없으면 null)
  function getRepSlot(id) {
    var slots = getRepSlots();
    for (var i = 0; i < REP_SLOTS.length; i++) { if (id && slots[REP_SLOTS[i]] === id) return REP_SLOTS[i]; }
    return null;
  }
  // setRepSlot(id, slot): slot=null 이면 해제. 다른 슬롯에 이미 있으면 그쪽을 비우고, 대상 슬롯의 기존 값은 교체.
  function setRepSlot(id, slot) {
    var slots = getRepSlots();
    REP_SLOTS.forEach(function (k) { if (slots[k] === id) slots[k] = null; });
    if (slot && REP_SLOTS.indexOf(slot) !== -1) slots[slot] = id;
    saveRepSlots(slots);
    renderRepPayment();
  }
  // 하위 호환: 단일 대표 API(= main 슬롯)
  function getRepresentativeLoan() { return getRepSlots().main; }
  function setRepresentativeLoan(id) {
    var slots = getRepSlots();
    if (id) { REP_SLOTS.forEach(function (k) { if (slots[k] === id) slots[k] = null; }); slots.main = id; }
    else slots.main = null;
    saveRepSlots(slots);
    renderRepPayment();
  }
  // 삭제된 대출 id 를 모든 슬롯에서 제거
  function clearRepLoan(id) {
    var slots = getRepSlots();
    REP_SLOTS.forEach(function (k) { if (slots[k] === id) slots[k] = null; });
    saveRepSlots(slots);
    renderRepPayment();
  }

  // resolveBaseRate(c): 연동 케이스의 기준금리 실시간 값(baseRateSeriesId → JF.ratesData 최신값),
  // 시리즈를 못 구하면(rates-data.js 미로드 페이지 등) null.
  function resolveBaseRate(c) {
    if (!c || !c.baseRateSeriesId || !JF.ratesData || !JF.ratesData.series ||
        !JF.ratesData.series[c.baseRateSeriesId] || !JF.rates || typeof JF.rates.latestValue !== "function") {
      return null;
    }
    return JF.rates.latestValue(JF.ratesData.series[c.baseRateSeriesId]);
  }

  // 케이스 이율 해석: 연동이면 기준금리(resolveBaseRate)+가산(spreadRate), 기준금리를 못 구하면
  // 마지막 저장값(annualRate)로 폴백. 비연동이면 수동 기준금리(baseRateManual)+가산(spreadRate).
  // (app-loan.resolveRate와 동일 규칙)
  function resolveCaseRate(c) {
    if (!c) return 0;
    if (c.linkToFinalRate) {
      var base = resolveBaseRate(c);
      if (base != null) return base + (Number(c.spreadRate) || 0);
      return Number(c.annualRate) || 0;
    }
    return (Number(c.baseRateManual) || 0) + (Number(c.spreadRate) || 0);
  }

  // isCaseRateLive(c): true면 resolveCaseRate가 JF.ratesData의 실시간 값으로 계산됨(annualRate 폴백 아님).
  function isCaseRateLive(c) {
    return !!(c && c.linkToFinalRate && resolveBaseRate(c) != null);
  }

  // computeCaseSchedule(c): 대출계산기 케이스 → 회차별 상환 스케줄({rows, summary}).
  // linkToFinalRate 해석(순수 엔진 밖에서 해야 하는 부분)을 여기서 처리해 JF.loan에 숫자 금리를 넘김.
  // "대출" 지출 탭 자동 모드가 이 스케줄의 payment를 월별 원리금으로 사용.
  function computeCaseSchedule(c) {
    var rate = resolveCaseRate(c);
    return JF.loan.computeSchedule({
      amount: c.amount, termMonths: c.termMonths, annualRate: rate, graceMonths: c.graceMonths,
      startDate: c.startDate, extraPayment: c.extraPayment || { amount: 0, fromInstallment: 0 },
      prepayments: c.prepayments || [], rateChanges: c.rateChanges || []
    });
  }

  // buildLoanSchedules(state): 자동 모드 loanExpenses가 참조하는 케이스만 스케줄 계산 →
  // { [loanId]: rows[] } 맵. calc.js(순수 모듈)에 loanSchedules 인자로 주입할 plain 데이터.
  function buildLoanSchedules(state) {
    var wanted = {};
    (state.loanExpenses || []).forEach(function (li) { if (li.mode === 'auto' && li.loanId) wanted[li.loanId] = true; });
    var map = {};
    (state.loans || []).forEach(function (c) { if (wanted[c.id]) map[c.id] = computeCaseSchedule(c).rows; });
    return map;
  }

  // renderRepPayment(): Main/Sub1/Sub2 대표 대출을 브랜드 아래에 "이름 | 연이자율 | 예상 원리금"으로 표기.
  // JF.loan(순수 엔진)·JF.store 가 로드된 페이지에서만 계산(모든 페이지에 loan.js 로드됨).
  function renderRepPayment() {
    var host = document.getElementById("jf-ref-payment");
    if (!host) return;
    host.textContent = "";
    if (!JF.loan || typeof JF.loan.computeSchedule !== "function" || !JF.store) return;
    var slots = getRepSlots();
    if (!slots.main && !slots.sub1 && !slots.sub2) return;
    var state;
    try { state = JF.store.load(); } catch (e) { return; }
    var loans = (state && state.loans) || [];
    REP_SLOTS.forEach(function (slot) {
      var id = slots[slot];
      if (!id) return;
      var c = null;
      for (var i = 0; i < loans.length; i++) { if (loans[i].id === id) { c = loans[i]; break; } }
      if (!c) return; // 삭제된 케이스 → 표기 없음
      var rate = resolveCaseRate(c);
      var out = JF.loan.computeSchedule({
        amount: c.amount, termMonths: c.termMonths, annualRate: rate, graceMonths: c.graceMonths,
        startDate: c.startDate, extraPayment: c.extraPayment || { amount: 0, fromInstallment: 0 },
        prepayments: c.prepayments || [], rateChanges: c.rateChanges || []
      });
      var pay = out.summary.firstMonthlyPayment;
      var wonStr = pay ? ((JF.format && JF.format.formatWon) ? JF.format.formatWon(pay) : String(pay)) + "원" : "-";
      var live = isCaseRateLive(c);
      host.appendChild(el("div", { class: "jf-rep-line jf-rep-" + slot, title: REP_SLOT_LABEL[slot] + (live ? " (최종금리 연동)" : "") }, [
        el("span", { class: "jf-rep-name" }, c.name || "대표대출"),
        el("span", { class: "jf-rep-sep" }, " | "),
        el("span", { class: "jf-rep-rate" }, "연 " + Number(rate).toFixed(2) + "%"),
        el("span", { class: "jf-rep-sep" }, " | "),
        el("span", { class: "jf-ref-pay-val" }, wonStr)
      ]));
    });
  }

  // 등락 표기: 상승 ▲, 하락 ▼, 보합 ─ (기준 대비 %p).
  function refDelta(cur, ref) {
    if (ref == null || ref === "" || isNaN(parseFloat(ref))) return null;
    var v = cur - parseFloat(ref);
    var a = Math.abs(v).toFixed(2);
    if (v > 0.0001) return "▲" + a;
    if (v < -0.0001) return "▼" + a;
    return "─";
  }
  function refMmdd(ymd) {
    if (!ymd) return "";
    var p = String(ymd).split("-");
    return p.length >= 3 ? (Number(p[1]) + "/" + Number(p[2])) : ymd;
  }

  // 금융채 6개월 기준금리(SC 게시값)를 rate.json에서 읽어 브랜드 아래 표시.
  // 기준금리 · 전일/7·1 대비 · 최종금리(+가산). file:// 등 origin 없는 환경에선
  // 요청하지 않음(로컬 무-fetch 보장 · dom-smoke 유지).
  function loadRefRate() {
    try {
      var proto = (typeof location !== "undefined" && location.protocol) || "";
      if (proto !== "http:" && proto !== "https:") return;
      if (typeof fetch !== "function") return;
      fetch("rate.json", { cache: "no-store" })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.rate) return;
          var unit = d.unit || "%";
          var cur = parseFloat(d.rate);
          if (!isNaN(cur)) setFinalRate(cur + LOAN_SPREAD); // live 값 저장+캐시+콜백(대출계산기 연동)
          var host = document.getElementById("jf-ref-rate");
          if (!host) return;
          host.textContent = "";
          host.appendChild(el("span", { class: "jf-ref-base" },
            (d.label || "금융채 6개월") + " " + d.rate + unit));
          var deltas = [];
          var dPrev = refDelta(cur, d.prevRate);
          if (dPrev) deltas.push("전일 " + dPrev);
          var dBase = refDelta(cur, d.baseRate);
          if (dBase) deltas.push((refMmdd(d.baseAsOf) || "기준") + " " + dBase);
          if (deltas.length) {
            host.appendChild(el("span", { class: "jf-ref-delta" }, " · " + deltas.join(" · ")));
          }
          if (!isNaN(cur)) {
            host.appendChild(el("span", { class: "jf-ref-final" },
              " · 최종 " + (cur + LOAN_SPREAD).toFixed(2) + unit));
          }
          host.title = "기준 " + (d.asOf || "") + " · 가산 +" + LOAN_SPREAD + " → 최종 " +
            (isNaN(cur) ? "?" : (cur + LOAN_SPREAD).toFixed(2)) + unit + " · " + (d.source || "");
        })
        .catch(function () {});
    } catch (e) {}
  }

  function renderNav(activePage) {
    var existing = document.getElementById(NAV_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    var list = el(
      "ul",
      { class: "jf-nav-list" },
      NAV_LINKS.map(function (link) {
        if (link.separator) return el("li", { class: "jf-nav-sep", role: "separator", "aria-hidden": "true" });
        var isActive = link.href === activePage;
        var a = el(
          "a",
          {
            href: link.href,
            class: "jf-nav-link" + (isActive ? " active" : ""),
            "aria-current": isActive ? "page" : null
          },
          link.label
        );
        return el("li", { class: "jf-nav-item" }, a);
      })
    );

    var brandbox = el("div", { class: "jf-nav-brandbox" }, [
      el("span", { class: "jf-nav-brand" }, "JinFinance"),
      el("span", { id: "jf-ref-rate", class: "jf-ref-rate" }),   // 금융채 6개월 기준금리(rate.json 비동기 로드)
      el("span", { id: "jf-ref-payment", class: "jf-ref-rate jf-ref-payment" })  // 대표 대출 예상 원리금
    ]);

    var nav = el("nav", { id: NAV_ID, class: "jf-nav" }, [
      brandbox,
      list
    ]);

    if (document.body) {
      document.body.insertBefore(nav, document.body.firstChild);
    }
    loadRefRate();
    renderRepPayment();
    return nav;
  }

  // showBanner(msg, kind): fixed, non-dismissable top bar. kind: "error"|"warn"|"info".
  // Calling repeatedly reuses the same DOM node (last message/kind wins) instead of stacking.
  function showBanner(msg, kind) {
    kind = kind === "error" || kind === "warn" || kind === "info" ? kind : "info";

    var banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = el("div", { id: BANNER_ID, role: "alert" });
      if (document.body) {
        document.body.insertBefore(banner, document.body.firstChild);
        document.body.classList.add("jf-has-banner");
      } else {
        document.addEventListener("DOMContentLoaded", function () {
          document.body.insertBefore(banner, document.body.firstChild);
          document.body.classList.add("jf-has-banner");
        });
      }
    }
    banner.className = "jf-banner jf-banner-" + kind;
    banner.textContent = msg;
    return banner;
  }

  // hideBanner(): remove the banner if present (used when a transient error clears).
  function hideBanner() {
    var banner = document.getElementById(BANNER_ID);
    if (banner) {
      banner.remove();
      if (document.body && document.body.classList) document.body.classList.remove("jf-has-banner");
    }
  }

  // money(n): delegate to JF.format.formatMan for display (원 -> "N만" string).
  function money(n) {
    if (JF.format && typeof JF.format.formatMan === "function") {
      return JF.format.formatMan(n);
    }
    return String(n);
  }

  JF.ui = {
    renderNav: renderNav,
    showBanner: showBanner,
    hideBanner: hideBanner,
    money: money,
    el: el,
    getFinalRate: getFinalRate,
    onFinalRate: onFinalRate,
    getRepresentativeLoan: getRepresentativeLoan,
    setRepresentativeLoan: setRepresentativeLoan,
    getRepSlots: getRepSlots,
    getRepSlot: getRepSlot,
    setRepSlot: setRepSlot,
    clearRepLoan: clearRepLoan,
    refreshRepPayment: renderRepPayment,
    computeCaseSchedule: computeCaseSchedule,
    buildLoanSchedules: buildLoanSchedules,
    isCaseRateLive: isCaseRateLive
  };
})();
