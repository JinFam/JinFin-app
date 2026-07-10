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
    { href: "cards.html", label: "카드" },
    { href: "card-helper.html", label: "카드도우미" },
    { href: "checklist.html", label: "체크리스트" }
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

  // renderNav(activePage): injects a <nav> with 5 links, highlighting activePage
  // (e.g. "income.html"). Safe to call more than once (replaces any existing nav).
  // 가산금리(대출 조건). 최종금리 = 기준금리 + 가산금리. 조건이 바뀌면 이 값만 수정.
  var LOAN_SPREAD = 1.16;

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
          var host = document.getElementById("jf-ref-rate");
          if (!host) return;
          var unit = d.unit || "%";
          var cur = parseFloat(d.rate);
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
      el("span", { id: "jf-ref-rate", class: "jf-ref-rate" })   // 금융채 6개월 기준금리(rate.json 비동기 로드)
    ]);

    var nav = el("nav", { id: NAV_ID, class: "jf-nav" }, [
      brandbox,
      list
    ]);

    if (document.body) {
      document.body.insertBefore(nav, document.body.firstChild);
    }
    loadRefRate();
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
    el: el
  };
})();
