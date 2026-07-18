// js/sync-ui.js — JF.syncUI: 페이지 배선(구독 재렌더 + 포커스 가드) + 토큰/상태 바.
// Classic script. config 없으면 바 숨김. 토큰 없으면 입력 바만 표시(동기화 미시작).
window.JF = window.JF || {};

(function () {
  "use strict";

  var BAR_ID = "jf-sync-bar";
  var _page = null;        // { get(), set(state), render() }
  var _bound = false;
  var _pending = null;     // 포커스 중 도착한 원격 상태(대기)
  var _awaitingBlur = false;
  var _lastStatus = "";

  function cfg() { return (JF.sync && JF.sync.config && JF.sync.config()) || null; }
  function el() { return JF.ui.el.apply(null, arguments); }

  function isEditing() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable === true;
  }

  // 각 페이지 boot()에서 1회 호출: JF.syncUI.bind({get,set,render})
  function bind(page) {
    _page = page;
    if (_bound) { renderBar(); return; }
    _bound = true;
    renderBar();
    if (JF.sync && JF.sync.enabled()) startSync();
  }

  function startSync() {
    JF.sync.subscribe(onRemote);
    JF.sync.start(_page ? _page.get() : null, {
      onStatus: function (kind, detail) {
        _lastStatus = kind; renderBar();
        if (kind === "autherror") {
          JF.ui.showBanner("GitHub 토큰이 거부되었습니다(401/403). 토큰 값·만료·권한(Contents 읽기/쓰기)과 조직 fine-grained PAT 승인 여부를 확인하세요." +
            (detail ? " [" + detail + "]" : ""), "error");
        } else if (kind === "error") {
          JF.ui.showBanner("동기화 오류: " + (detail || "알 수 없는 오류") +
            ". (저장소 초기화 여부, 브랜치 이름, 네트워크/CORS를 확인하세요)", "error");
        } else if (kind === "synced" || kind === "adopted" || kind === "seeded" || kind === "merged") {
          if (JF.ui.hideBanner) JF.ui.hideBanner(); // 회복 시 이전 오류 배너 제거
        }
      },
      onConflict: function (section, ids) {
        // income/meta처럼 섹션 전체가 하나의 충돌 단위("__section__")인 경우는 타임스탬프
        // 우선(last-write-wins)이라 어느 쪽이 이겼는지 고정돼 있지 않음 — "상대가 이겼다"고
        // 단정하지 않는다. 배열/맵 섹션의 항목 단위 충돌은 여전히 상대 값이 우선.
        var wholeSection = ids.length === 1 && ids[0] === "__section__";
        var msg = wholeSection
          ? "동기화 충돌: '" + section + "' 항목을 비슷한 시점에 함께 수정했습니다. 더 나중에 수정한 쪽이 반영되었습니다. 내용을 확인하세요."
          : "동기화 충돌: '" + section + "' 항목(" + ids.join(", ") + ")은 상대의 변경이 우선 적용되었습니다. 내 변경을 확인 후 다시 입력하세요.";
        JF.ui.showBanner(msg, "warn");
      },
      onFirstEnable: function (local, remote, resolve) {
        var adopt = window.confirm(
          "이 기기에 로컬 데이터가 있고, 공유 저장소에도 데이터가 있습니다.\n\n" +
          "[확인] = 공유(원격) 데이터를 사용 — 내 로컬은 덮어씁니다.\n" +
          "         (내 로컬을 지키려면 [취소] 후 먼저 내보내기 하세요)\n" +
          "[취소] = 내 로컬 데이터를 공유 저장소에 올립니다(원격 덮어씀).");
        resolve(adopt ? "adopt-remote" : "keep-local");
      }
    });
  }

  // 원격 변경 도착 → 상태 교체 + 재렌더(입력 포커스 중이면 보류).
  function onRemote(newState) {
    if (!_page) return;
    _page.set(newState);
    if (isEditing()) {
      _pending = newState; // 편집 중 → 보류(리스너는 1개만 유지)
      if (!_awaitingBlur) { _awaitingBlur = true; document.addEventListener("focusout", flushPending); }
    } else {
      _page.render();
    }
    renderBar();
  }
  function flushPending() {
    if (isEditing()) return; // 아직 다른 입력에 포커스 → 다음 focusout까지 대기
    document.removeEventListener("focusout", flushPending);
    _awaitingBlur = false;
    if (_pending && _page) { _page.set(_pending); _pending = null; _page.render(); }
  }

  function connect(token, label) {
    token = (token || "").trim();
    if (!token) { JF.ui.showBanner("GitHub 토큰(PAT)을 입력하세요.", "warn"); return; }
    JF.sync.setToken(token);
    if (label != null) JF.sync.setLabel((label || "").trim());
    renderBar();
    startSync();
  }
  function disconnect() {
    if (JF.sync.stop) JF.sync.stop();
    JF.sync.setToken("");
    if (typeof location !== "undefined" && location.reload) location.reload();
  }

  function statusLabel(k) {
    return ({
      connecting: "연결 중…", syncing: "동기화중", synced: "동기화완료", seeded: "초기화됨",
      adopted: "원격 적용됨", merged: "병합됨", disabled: "꺼짐",
      error: "오류", autherror: "토큰/권한 오류"
    })[k] || "대기";
  }

  function renderBar() {
    var c = cfg();
    var host = document.getElementById(BAR_ID);
    if (!host) {
      host = el("div", { id: BAR_ID, class: "jf-sync-bar" });
      if (document.body) document.body.appendChild(host);
      else return;
    }
    host.textContent = "";
    if (!c) { host.style.display = "none"; return; }
    host.style.display = "";

    if (JF.sync.enabled()) {
      host.appendChild(el("span", { class: "jf-sync-dot ok", title: "동기화 켜짐" }));
      host.appendChild(el("span", { class: "jf-sync-txt" },
        "동기화 · " + (JF.sync.getLabel() || "이름없음") + " · " + statusLabel(_lastStatus)));
      host.appendChild(el("button", { class: "jf-sync-btn", type: "button", onClick: disconnect }, "해제"));
    } else {
      var nm = el("input", { type: "text", placeholder: "내 이름", class: "jf-sync-input jf-sync-name", value: JF.sync.getLabel() || "" });
      var tok = el("input", { type: "password", placeholder: "GitHub 토큰(PAT)", class: "jf-sync-input" });
      host.appendChild(el("span", { class: "jf-sync-dot off", title: "동기화 꺼짐" }));
      host.appendChild(nm);
      host.appendChild(tok);
      host.appendChild(el("button", { class: "jf-sync-btn", type: "button", onClick: function () { connect(tok.value, nm.value); } }, "연결"));
    }
  }

  JF.syncUI = { bind: bind };
})();
