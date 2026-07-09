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

    var nav = el("nav", { id: NAV_ID, class: "jf-nav" }, [
      el("span", { class: "jf-nav-brand" }, "JinFinance"),
      list
    ]);

    if (document.body) {
      document.body.insertBefore(nav, document.body.firstChild);
    }
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
