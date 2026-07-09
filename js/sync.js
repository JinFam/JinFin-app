// js/sync.js — JF.sync: GitHub 비공개 repo JSON 동기화(폴링 GET + 커밋 PUT).
// Classic script(모듈/빌드 없음). config/token 없으면 완전 no-op → 로컬 순수(file://) 회귀 0.
//
// 설계(딜리서치 + advisor 반영):
//  - 상태 최상위 키 = 섹션. 각 섹션 = 비공개 repo의 JSON 파일 1개(독립 sha).
//  - 충돌은 "감지 + 알림"이 목표(CRDT 자동병합 아님). stale-sha PUT이 상대의
//    커밋을 조용히 덮지 않는 것이 불변식. 배열은 id-키 union, 평면맵은 키 union,
//    중첩객체(meta/income)는 섹션 단위(theirs 우선 + 충돌 보고).
//  - meta.currentMonth는 클라이언트 뷰 상태 → 동기화 제외(로컬 보존).
//  - GitHub content는 base64가 \n 래핑됨 → decode 전 공백 제거. 한글은 TextEncoder로.
//
// 이 파일의 순수 함수(_ 접두)는 단위테스트 대상. 네트워크/폴링 배선은 Phase 0(사용자
// GitHub 준비) 이후 store 훅과 함께 라이브 검증한다.
window.JF = window.JF || {};

(function () {
  "use strict";

  var TOKEN_KEY = "jinfinance:sync:token";
  var LABEL_KEY = "jinfinance:sync:label";

  // 동기화 섹션 = 상태 최상위 키(각각 파일 1개).
  var SECTIONS = ["meta", "account", "income", "expenses", "specials", "cards", "categories", "categoryColors", "checklists"];
  // id 배열 섹션(항목 단위 union 병합).
  var ARRAY_SECTIONS = ["expenses", "specials", "cards", "categories", "checklists"];
  // 평면 맵 섹션(키 단위 union 병합).
  var FLATMAP_SECTIONS = ["account", "categoryColors"];
  // meta에서 동기화 제외(클라이언트 뷰 상태).
  var META_LOCAL_KEYS = ["currentMonth"];

  // ---- base64 UTF-8 (한글 안전) --------------------------------------------
  function b64EncodeUtf8(str) {
    var bytes = new TextEncoder().encode(String(str));
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64DecodeUtf8(b64) {
    var clean = String(b64).replace(/\s/g, ""); // GitHub content는 \n 래핑 → 제거
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---- 깊은 동등 비교(충돌 판정용) -----------------------------------------
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== "object" || typeof b !== "object") return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
      if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }

  // ---- 섹션 추출/적용 -------------------------------------------------------
  // extractSection: 상태 → 섹션 값(meta는 클라이언트 뷰 키 제외).
  function extractSection(state, name) {
    if (!state) return null;
    if (name === "meta") {
      var m = state.meta || {};
      var out = {};
      for (var k in m) {
        if (m.hasOwnProperty(k) && META_LOCAL_KEYS.indexOf(k) === -1) out[k] = m[k];
      }
      return out;
    }
    return state[name];
  }
  // applySection: 원격 섹션 값을 상태에 반영(meta는 로컬 뷰 키 보존). state를 변형 후 반환.
  function applySection(state, name, value) {
    if (!state) return state;
    if (name === "meta") {
      var merged = {};
      var v = value || {};
      for (var k in v) if (v.hasOwnProperty(k)) merged[k] = v[k];
      var m = state.meta || {};
      for (var i = 0; i < META_LOCAL_KEYS.length; i++) {
        var lk = META_LOCAL_KEYS[i];
        if (m.hasOwnProperty(lk)) merged[lk] = m[lk]; // 로컬 뷰(currentMonth) 보존
      }
      state.meta = merged;
      return state;
    }
    state[name] = value;
    return state;
  }

  // ---- 봉투(envelope) ------------------------------------------------------
  function wrapEnvelope(section, data, label) {
    return {
      section: section,
      schemaVersion: (JF.schema && JF.schema.SCHEMA_VERSION) || 1,
      updatedAt: new Date().toISOString(),
      updatedBy: label || "",
      data: data
    };
  }
  // unwrapEnvelope: 봉투면 그대로, raw data면 봉투로 감싸 반환(관용).
  function unwrapEnvelope(text) {
    var obj = JSON.parse(text);
    if (obj && typeof obj === "object" && !Array.isArray(obj) && obj.section && ("data" in obj)) {
      return obj;
    }
    return { section: null, schemaVersion: null, updatedAt: null, updatedBy: "", data: obj };
  }

  // ---- 병합(감지 + 알림; CRDT 아님) ---------------------------------------
  // 배열: theirs(원격 최신) 기준. 내 신규 id 추가. 동일 id 상충 → theirs 유지 + 충돌 보고.
  function mergeArrayById(mine, theirs) {
    mine = Array.isArray(mine) ? mine : [];
    theirs = Array.isArray(theirs) ? theirs : [];
    var merged = theirs.slice();
    var seen = {};
    var conflicts = [];
    var i, id;
    for (i = 0; i < theirs.length; i++) {
      id = theirs[i] && theirs[i].id;
      if (id != null) seen[id] = i;
    }
    for (i = 0; i < mine.length; i++) {
      var it = mine[i];
      id = it && it.id;
      if (id == null) { merged.push(it); continue; }
      if (!(id in seen)) merged.push(it);                          // 내가 추가한 신규 항목
      else if (!deepEqual(theirs[seen[id]], it)) conflicts.push(id); // 상충 → theirs 유지, 보고
    }
    return { merged: merged, conflicts: conflicts };
  }
  // 평면 맵: theirs 기준. 내 신규 키 추가. 동일 키 상충 → theirs 유지 + 충돌 보고.
  function mergeFlatMap(mine, theirs) {
    mine = (mine && typeof mine === "object") ? mine : {};
    theirs = (theirs && typeof theirs === "object") ? theirs : {};
    var merged = {};
    var conflicts = [];
    var k;
    for (k in theirs) if (theirs.hasOwnProperty(k)) merged[k] = theirs[k];
    for (k in mine) if (mine.hasOwnProperty(k)) {
      if (!(k in merged)) merged[k] = mine[k];
      else if (!deepEqual(merged[k], mine[k])) conflicts.push(k);   // theirs 유지, 보고
    }
    return { merged: merged, conflicts: conflicts };
  }
  // 섹션 디스패치. income/meta 등 중첩객체 → 섹션 단위(theirs 우선, 다르면 "__section__" 보고).
  function mergeSectionValue(name, mine, theirs) {
    if (ARRAY_SECTIONS.indexOf(name) !== -1) return mergeArrayById(mine, theirs);
    if (FLATMAP_SECTIONS.indexOf(name) !== -1) return mergeFlatMap(mine, theirs);
    if (!deepEqual(mine, theirs)) return { merged: theirs, conflicts: ["__section__"] };
    return { merged: theirs, conflicts: [] };
  }

  // ---- config / token ------------------------------------------------------
  function config() {
    if (JF && JF.syncConfig) return JF.syncConfig;
    if (typeof window !== "undefined" && window.JF_SYNC_CONFIG) return window.JF_SYNC_CONFIG;
    return null;
  }
  function getToken() { try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) {
    try {
      if (t) window.localStorage.setItem(TOKEN_KEY, t);
      else window.localStorage.removeItem(TOKEN_KEY);
      return true;
    } catch (e) { return false; }
  }
  function getLabel() {
    try {
      var l = window.localStorage.getItem(LABEL_KEY);
      if (l) return l;
    } catch (e) {}
    var c = config();
    return (c && c.label) || "";
  }
  function setLabel(l) { try { window.localStorage.setItem(LABEL_KEY, l || ""); return true; } catch (e) { return false; } }
  function enabled() {
    var c = config();
    return !!(c && c.owner && c.repo && getToken());
  }

  // ---- GitHub REST wrappers (enabled일 때만 실행; Phase 0 이후 라이브 배선) -----
  function apiBase() { var c = config(); return "https://api.github.com/repos/" + c.owner + "/" + c.repo; }
  function branchName() { var c = config(); return (c && c.branch) || "main"; }
  function dirName() { var c = config(); return (c && c.dir) || "state"; }
  function pathFor(section) { return dirName() + "/" + section + ".json"; }
  function ghHeaders(extra) {
    var h = {
      "Authorization": "Bearer " + getToken(),
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
    return h;
  }
  // GET 파일(ETag 조건부). 반환: {status, etag, sha, text} | {status:304} | {status:404}
  function ghGetFile(section, etag) {
    var url = apiBase() + "/contents/" + pathFor(section) + "?ref=" + encodeURIComponent(branchName());
    return fetch(url, { headers: ghHeaders(etag ? { "If-None-Match": etag } : null) }).then(function (res) {
      if (res.status === 304) return { status: 304 };
      if (res.status === 404) return { status: 404 };
      var newEtag = res.headers.get("ETag");
      return res.json().then(function (body) {
        return {
          status: res.status,
          etag: newEtag,
          sha: body.sha,
          text: body.content ? b64DecodeUtf8(body.content) : ""
        };
      });
    });
  }
  // PUT 파일(생성/수정). sha 있으면 수정, stale 시 GitHub가 409. 반환: {status, body}
  function ghPutFile(section, text, sha) {
    var url = apiBase() + "/contents/" + pathFor(section);
    var payload = {
      message: "sync: " + section,
      content: b64EncodeUtf8(text),
      branch: branchName()
    };
    if (sha) payload.sha = sha;
    return fetch(url, {
      method: "PUT",
      headers: ghHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    });
  }
  // 브랜치 HEAD 커밋 sha(ETag 조건부). 반환: {status, etag, sha} | {status:304}
  function ghGetHead(etag) {
    var url = apiBase() + "/commits/" + encodeURIComponent(branchName());
    return fetch(url, { headers: ghHeaders(etag ? { "If-None-Match": etag } : null) }).then(function (res) {
      if (res.status === 304) return { status: 304 };
      var newEtag = res.headers.get("ETag");
      return res.json().then(function (body) { return { status: res.status, etag: newEtag, sha: body.sha }; });
    });
  }
  // GET 디렉터리 목록(ETag 조건부) — 각 파일 blob sha를 한 번에. 폴링 1차 프리미티브.
  // 반환: {status, etag, files:[{section, sha}]} | {status:304} | {status:404}
  function ghGetDir(etag) {
    var url = apiBase() + "/contents/" + dirName() + "?ref=" + encodeURIComponent(branchName());
    return fetch(url, { headers: ghHeaders(etag ? { "If-None-Match": etag } : null) }).then(function (res) {
      if (res.status === 304) return { status: 304 };
      if (res.status === 404) return { status: 404 };
      var newEtag = res.headers.get("ETag");
      return res.json().then(function (list) {
        var files = [];
        if (Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) {
            var nm = list[i].name || "";
            if (nm.slice(-5) === ".json") files.push({ section: nm.slice(0, -5), sha: list[i].sha });
          }
        }
        return { status: res.status, etag: newEtag, files: files };
      });
    });
  }

  // repo 루트 접근 확인. 비공개 repo에서 /contents/state의 404는 "빈 폴더" 또는
  // "토큰이 repo 자체를 못 봄(존재 은닉 → 404)" 둘 다일 수 있어 구분에 사용.
  function ghGetRepo() {
    return fetch(apiBase(), { headers: ghHeaders(null) }).then(function (res) { return { status: res.status }; });
  }

  // ---- 런타임(폴링/푸시/병합; enabled + start 이후) ------------------------
  var _subs = [];
  var _mirror = {};          // section -> 마지막 동기화된 값
  var _sha = {};             // section -> blob sha
  var _dirEtag = null;
  var _lastWrittenSha = {};  // section -> 내가 방금 PUT한 sha(에코 억제)
  var _state = null;         // 현재 전체 상태(원격 적용 기준)
  var _pushTimers = {};      // section -> debounce timer
  var _putQueue = Promise.resolve(); // 직렬 PUT 체인
  var _started = false;
  var _reconciled = false;   // 최초 정합 성공 여부(폴링은 이후에만)
  var _lastKind = "";        // 마지막 status kind(토큰 오류→회복 감지용)
  var _applyingRemote = false;
  var _pollTimer = null;
  var _hooks = {};           // { onConflict(section,ids), onFirstEnable(local,remote,resolve), onStatus(kind,detail) }
  var PUSH_DEBOUNCE_MS = 800;
  var PUT_SPACING_MS = 1100; // 2차 레이트리밋: 쓰기 간 ≥1초

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  // _mirror는 "마지막 동기화 값"의 독립 스냅샷이어야 함. extractSection이 state의 참조를
  // 그대로 돌려주므로, 클론 없이 저장하면 mirror가 live state를 별칭(alias)해 in-place 변경
  // (예: 체크박스 d.checked 토글)이 diff에서 감지되지 않아 push가 안 됨. 반드시 클론 저장.
  function setMirror(s, val) { _mirror[s] = (val && typeof val === "object") ? deepClone(val) : val; }
  function adoptedKey() { var c = config(); return "jinfinance:sync:adopted:" + (c ? c.owner + "/" + c.repo : ""); }
  function markAdopted() { try { window.localStorage.setItem(adoptedKey(), "1"); } catch (e) {} }
  function isAdopted() { try { return !!window.localStorage.getItem(adoptedKey()); } catch (e) { return false; } }
  function status(kind, detail) { _lastKind = kind; if (typeof _hooks.onStatus === "function") { try { _hooks.onStatus(kind, detail); } catch (e) {} } }
  function spacer() { return new Promise(function (resolve) { setTimeout(resolve, PUT_SPACING_MS); }); }

  function subscribe(cb) {
    if (typeof cb === "function") _subs.push(cb);
    return function () { var i = _subs.indexOf(cb); if (i !== -1) _subs.splice(i, 1); };
  }
  function emit(newState) {
    _state = newState;
    for (var i = 0; i < _subs.length; i++) { try { _subs[i](newState); } catch (e) {} }
  }
  function persistLocal(state) {
    _applyingRemote = true;
    try { if (JF.store && JF.store.save) JF.store.save(state); } finally { _applyingRemote = false; }
  }

  // 로컬이 시드와 동등한가(최초활성 가드용). 양쪽을 migrate로 정규화(같은 키/순서)한 뒤
  // currentMonth 제외하고 비교 → migrate가 채운 빈 키(categoryColors/checklists) 때문에
  // "실제로는 시드인" 로컬이 non-seed로 오판되지 않게 함.
  function isSeedEquivalent(state) {
    if (!(JF.seed && JF.seed.SEED_STATE)) return false;
    var mig = (JF.schema && typeof JF.schema.migrate === "function") ? JF.schema.migrate : function (x) { return x; };
    var norm = function (s) {
      var c = mig(deepClone(s || {}));
      if (c && c.meta) delete c.meta.currentMonth;
      return JSON.stringify(c);
    };
    return norm(state) === norm(JF.seed.SEED_STATE);
  }

  // 원격 전체 조회: dir 목록 → 존재 섹션 파일 GET.
  // 404 또는 200-빈목록 = 빈 repo(시드 대상). 그 외(401/403/5xx) = 오류로 throw
  // → 잘못된/미승인 토큰을 "빈 repo"로 오인해 시드하거나 adopted 플래그를 오염시키지 않음.
  function fetchRemoteAll() {
    return ghGetDir(null).then(function (dir) {
      if (dir.status === 404) {
        // 404 모호성 해소: repo 루트가 접근되면 진짜 "빈 폴더"(시드 대상),
        // repo 루트도 404면 토큰이 repo를 못 봄(접근 불가) → 시드/adopted 금지, 오류로 알림.
        return ghGetRepo().then(function (r) {
          if (r.status === 200) return { empty: true, dirEtag: dir.etag || null, values: {}, sha: {} };
          var e2 = new Error("repo 접근 불가 (HTTP " + r.status + ")"); e2.code = r.status; e2.noAccess = true; throw e2;
        });
      }
      if (dir.status !== 200) { var err = new Error("dir HTTP " + dir.status); err.code = dir.status; throw err; }
      if (!dir.files || dir.files.length === 0) {
        return { empty: true, dirEtag: dir.etag || null, values: {}, sha: {} };
      }
      var wanted = dir.files.filter(function (f) { return SECTIONS.indexOf(f.section) !== -1; });
      return Promise.all(wanted.map(function (f) {
        return ghGetFile(f.section).then(function (r) {
          return { section: f.section, sha: r.sha, value: r.text ? unwrapEnvelope(r.text).data : null };
        });
      })).then(function (arr) {
        var values = {}, sha = {};
        for (var i = 0; i < arr.length; i++) { values[arr[i].section] = arr[i].value; sha[arr[i].section] = arr[i].sha; }
        return { empty: false, dirEtag: dir.etag || null, values: values, sha: sha };
      });
    });
  }

  // 빈 repo → 로컬 상태로 전 섹션 시드(직렬·간격).
  function seedAll(state) {
    var chain = Promise.resolve();
    SECTIONS.forEach(function (s) {
      chain = chain.then(spacer).then(function () {
        var val = extractSection(state, s);
        var text = JSON.stringify(wrapEnvelope(s, val, getLabel()));
        return ghPutFile(s, text, null).then(function (resp) {
          if (resp.status >= 200 && resp.status < 300 && resp.body && resp.body.content) {
            setMirror(s, val); _sha[s] = resp.body.content.sha; _lastWrittenSha[s] = _sha[s];
          }
        });
      });
    });
    return chain;
  }

  // 원격 값 채택(remote wins per section) → merged 반환.
  function adoptRemote(state, values, sha) {
    var merged = deepClone(state);
    SECTIONS.forEach(function (s) {
      if (values.hasOwnProperty(s) && values[s] !== null && values[s] !== undefined) {
        applySection(merged, s, values[s]);
        setMirror(s, values[s]); _sha[s] = sha[s];
      } else {
        setMirror(s, extractSection(state, s)); // 원격에 없는 섹션 → 로컬을 mirror로
      }
    });
    return merged;
  }

  // 로컬을 원격 위로 push(최초활성에서 keep-local 선택 시).
  function pushAllLocalOverRemote(state) {
    var chain = Promise.resolve();
    SECTIONS.forEach(function (s) {
      chain = chain.then(spacer).then(function () {
        var val = extractSection(state, s);
        var text = JSON.stringify(wrapEnvelope(s, val, getLabel()));
        return ghPutFile(s, text, _sha[s]).then(function (resp) {
          if (resp.body && resp.body.content) { setMirror(s, val); _sha[s] = resp.body.content.sha; _lastWrittenSha[s] = _sha[s]; }
        });
      });
    });
    return chain;
  }

  function start(initialState, hooks) {
    _hooks = hooks || {};
    if (!enabled()) { status("disabled"); return Promise.resolve({ enabled: false }); }
    if (_started) return Promise.resolve({ enabled: true, already: true });
    _started = true;
    _state = initialState;
    status("connecting");
    return reconcile(initialState);
  }

  // 최초 정합(시드/채택/최초활성) 성공 후에만 폴링 시작.
  function afterReconcile() { _reconciled = true; schedulePoll(); }

  // 원격과 로컬 정합. 실패 시 markAdopted 하지 않고 pollMs 후 재시도(자기치유).
  function reconcile(initialState) {
    return fetchRemoteAll().then(function (remote) {
      _dirEtag = remote.dirEtag;
      if (remote.empty) {
        return seedAll(initialState).then(function () { markAdopted(); status("seeded"); emit(initialState); afterReconcile(); });
      }
      var firstTime = !isAdopted();
      var localNonSeed = !isSeedEquivalent(initialState);
      var localDiffers = false;
      for (var i = 0; i < SECTIONS.length; i++) {
        var s = SECTIONS[i];
        if (remote.values.hasOwnProperty(s) && !deepEqual(extractSection(initialState, s), remote.values[s])) { localDiffers = true; break; }
      }
      if (firstTime && localNonSeed && localDiffers && typeof _hooks.onFirstEnable === "function") {
        return new Promise(function (resolve) {
          _hooks.onFirstEnable(initialState, remote.values, function (choice) {
            if (choice === "keep-local") {
              markAdopted(); _sha = remote.sha;
              pushAllLocalOverRemote(initialState).then(function () { emit(initialState); status("synced"); afterReconcile(); resolve(); });
            } else {
              var merged = adoptRemote(initialState, remote.values, remote.sha);
              markAdopted(); persistLocal(merged); emit(merged); status("adopted"); afterReconcile(); resolve();
            }
          });
        });
      }
      var merged = adoptRemote(initialState, remote.values, remote.sha);
      markAdopted(); persistLocal(merged); emit(merged); status("synced"); afterReconcile();
    }).catch(function (e) {
      var code = e && e.code;
      var authish = (code === 401 || code === 403) || (e && e.noAccess); // 토큰/권한/접근 불가
      status(authish ? "autherror" : "error", String((e && e.message) || e));
      var ms = (config() && config().pollMs) || 15000;
      if (_pollTimer) clearTimeout(_pollTimer);
      // 재시도(자기치유): 정합 전 편집분이 반영되도록 최신 _state로 재시도(폐쇄된 초기값 아님).
      _pollTimer = setTimeout(function () { if (_started) reconcile(_state || initialState); }, ms);
    });
  }

  function schedulePoll() {
    var c = config();
    var ms = (c && c.pollMs) || 15000;
    _pollTimer = setTimeout(poll, ms);
  }
  function poll() {
    if (!enabled()) return;
    return ghGetDir(_dirEtag).then(function (dir) {
      // 토큰 만료/미승인이 폴링 중 발생 → 조용히 넘기면 "동기화됨" 표시인 채 실제로는 갈라짐. 반드시 알림.
      if (dir.status === 401 || dir.status === 403) { status("autherror", "poll HTTP " + dir.status); schedulePoll(); return; }
      if (dir.status === 304) { if (_lastKind === "autherror") status("synced"); schedulePoll(); return; } // 조건부요청 성공 = 토큰 회복
      if (dir.status !== 200) { schedulePoll(); return; } // 404/5xx → 변화 없음/일시 오류: 다음 폴까지 대기
      if (_lastKind === "autherror") status("synced"); // 200 = 토큰 회복(이전 오류 배너 해제 트리거)
      _dirEtag = dir.etag;
      var changed = [];
      for (var i = 0; i < dir.files.length; i++) {
        var f = dir.files[i];
        if (SECTIONS.indexOf(f.section) === -1) continue;
        if (_sha[f.section] === f.sha) continue;                 // 변화 없음
        if (_lastWrittenSha[f.section] === f.sha) { _sha[f.section] = f.sha; continue; } // 내 에코 → 무-렌더
        changed.push(f);
      }
      if (!changed.length) { schedulePoll(); return; }
      return Promise.all(changed.map(function (f) {
        return ghGetFile(f.section).then(function (r) {
          return { section: f.section, sha: r.sha, value: r.text ? unwrapEnvelope(r.text).data : null };
        });
      })).then(function (arr) {
        var merged = deepClone(_state || {});
        for (var j = 0; j < arr.length; j++) {
          applySection(merged, arr[j].section, arr[j].value);
          setMirror(arr[j].section, arr[j].value); _sha[arr[j].section] = arr[j].sha;
        }
        persistLocal(merged); emit(merged); status("synced");
        schedulePoll();
      });
    }).catch(function (e) { status("error", String((e && e.message) || e)); schedulePoll(); });
  }

  // store.save() 훅: 로컬 변경 섹션을 디바운스로 push. 원격 적용 중이면 무시(에코 방지).
  function onLocalSave(state) {
    _state = state; // 정합 전이라도 최신 상태는 보관(재시도가 이를 사용)
    if (_applyingRemote || !enabled() || !_started || !_reconciled) return;
    SECTIONS.forEach(function (s) {
      var v = extractSection(state, s);
      if (!deepEqual(v, _mirror[s])) debouncePush(s);
    });
  }
  function debouncePush(s) {
    if (_pushTimers[s]) clearTimeout(_pushTimers[s]);
    _pushTimers[s] = setTimeout(function () { _pushTimers[s] = null; enqueuePush(s); }, PUSH_DEBOUNCE_MS);
  }
  function enqueuePush(s) {
    _putQueue = _putQueue.then(spacer).then(function () { return doPush(s); }).catch(function () {});
    return _putQueue;
  }
  function doPush(s) {
    var value = extractSection(_state, s);
    if (deepEqual(value, _mirror[s])) return Promise.resolve();
    var text = JSON.stringify(wrapEnvelope(s, value, getLabel()));
    return ghPutFile(s, text, _sha[s]).then(function (resp) {
      if (resp.status >= 200 && resp.status < 300 && resp.body && resp.body.content) {
        setMirror(s, value); _sha[s] = resp.body.content.sha; _lastWrittenSha[s] = _sha[s]; status("pushed", s);
        return;
      }
      if (resp.status === 409) return resolveConflict(s, value);
      status((resp.status === 401 || resp.status === 403) ? "autherror" : "error", "PUT " + s + " → " + resp.status);
    });
  }
  function resolveConflict(s, mineValue) {
    return ghGetFile(s).then(function (r) {
      var theirs = r.text ? unwrapEnvelope(r.text).data : null;
      var m = mergeSectionValue(s, mineValue, theirs);
      if (m.conflicts && m.conflicts.length && typeof _hooks.onConflict === "function") {
        try { _hooks.onConflict(s, m.conflicts); } catch (e) {}
      }
      var text = JSON.stringify(wrapEnvelope(s, m.merged, getLabel()));
      return ghPutFile(s, text, r.sha).then(function (resp2) {
        if (resp2.body && resp2.body.content) {
          setMirror(s, m.merged); _sha[s] = resp2.body.content.sha; _lastWrittenSha[s] = _sha[s];
          var merged = deepClone(_state || {});
          applySection(merged, s, m.merged);
          persistLocal(merged); emit(merged); status("merged", s);
        }
      });
    });
  }
  function stop() { if (_pollTimer) clearTimeout(_pollTimer); _pollTimer = null; _started = false; _reconciled = false; }

  JF.sync = {
    // config / 상태
    enabled: enabled,
    config: config,
    getToken: getToken,
    setToken: setToken,
    getLabel: getLabel,
    setLabel: setLabel,
    SECTIONS: SECTIONS,
    ARRAY_SECTIONS: ARRAY_SECTIONS,
    FLATMAP_SECTIONS: FLATMAP_SECTIONS,

    // 순수 코어(단위테스트 대상)
    _b64EncodeUtf8: b64EncodeUtf8,
    _b64DecodeUtf8: b64DecodeUtf8,
    _deepEqual: deepEqual,
    _extractSection: extractSection,
    _applySection: applySection,
    _wrapEnvelope: wrapEnvelope,
    _unwrapEnvelope: unwrapEnvelope,
    _mergeArrayById: mergeArrayById,
    _mergeFlatMap: mergeFlatMap,
    _mergeSectionValue: mergeSectionValue,

    // 런타임(라이브)
    start: start,
    stop: stop,
    subscribe: subscribe,
    onLocalSave: onLocalSave,

    // 네트워크 래퍼
    _pathFor: pathFor,
    _ghGetFile: ghGetFile,
    _ghPutFile: ghPutFile,
    _ghGetHead: ghGetHead,
    _ghGetDir: ghGetDir
  };
})();
