/* =========================================================
   九州陵墓志 · app
   Vanilla JS. No external libraries, no network requests.
   ========================================================= */
(function () {
  "use strict";

  var MAP = window.CHINA_MAP;
  var TOMBS = window.TOMBS || [];
  var NS = "http://www.w3.org/2000/svg";
  var W = MAP ? MAP.width : 1000;
  var H = MAP ? MAP.height : 720;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var CATS = ["帝王陵寝", "王侯陵墓", "将相名臣", "文人名士", "史前墓地", "壁画画像石墓", "崖墓悬棺", "边疆民族", "传说纪念", "近现代陵园"];
  var ERAS = ["史前", "夏商周", "秦汉", "魏晋南北朝", "隋唐", "宋辽金西夏", "元明清", "近现代"];
  var STATUS = ["已发掘", "部分发掘", "未发掘", "未证实", "已毁"];

  var STATUS_COLOR = {
    "已发掘": "#d0684a",
    "部分发掘": "#d5a54a",
    "未发掘": "#6f9c8b",
    "未证实": "#9a8ab5",
    "已毁": "#7f7870"
  };

  var STATUS_NOTE = {
    "已发掘": "墓室经过考古发掘或清理，出土材料已发表。",
    "部分发掘": "陵园、陪葬坑或部分墓室经过发掘，主墓室可能尚未开启。",
    "未发掘": "墓位基本明确，但主墓室尚未进行考古发掘。",
    "未证实": "墓主、墓位或性质存在争议，或属于传说陵墓、衣冠冢。",
    "已毁": "地面建筑或墓室已毁，仅存遗址、封土或石刻。"
  };

  var CAT_MARK = {
    "帝王陵寝": "帝",
    "王侯陵墓": "侯",
    "将相名臣": "臣",
    "文人名士": "文",
    "史前墓地": "古",
    "壁画画像石墓": "画",
    "崖墓悬棺": "崖",
    "边疆民族": "边",
    "传说纪念": "传",
    "近现代陵园": "近"
  };

  var ERA_RANK = {}, CAT_RANK = {}, STATUS_RANK = {};
  ERAS.forEach(function (e, i) { ERA_RANK[e] = i; });
  CATS.forEach(function (c, i) { CAT_RANK[c] = i; });
  STATUS.forEach(function (s, i) { STATUS_RANK[s] = i; });

  var byId = new Map();

  /* ---------- projection ---------- */
  var P = MAP ? MAP.proj : null;
  function project(lng, lat) {
    var rad = Math.PI / 180;
    var rho = Math.sqrt(P.c - 2 * P.n * Math.sin(lat * rad)) / P.n;
    var theta = P.n * ((lng - P.lon0) * rad);
    return [
      rho * Math.sin(theta) * P.scale + P.ox,
      P.oy - (P.rho0 - rho * Math.cos(theta)) * P.scale
    ];
  }

  /* ---------- normalize data ---------- */
  TOMBS.forEach(function (t, i) {
    t._i = i;
    t._catRank = CAT_RANK[t.cat] == null ? 99 : CAT_RANK[t.cat];
    t._eraRank = ERA_RANK[t.era] == null ? 99 : ERA_RANK[t.era];
    t._statusRank = STATUS_RANK[t.status] == null ? 99 : STATUS_RANK[t.status];
    var pos = project(t.lng, t.lat);
    t._x = pos[0];
    t._y = pos[1];
    t._search = [
      t.name, t.alias, t.dynasty, t.era, t.province, t.city,
      t.summary, t.detail, t.structure, t.excavation, t.level,
      t.coordNote, t.dispute,
      (t.finds || []).join(" "), (t.tags || []).join(" ")
    ].join(" ").toLowerCase();
    byId.set(t.id, t);
  });

  /* ---------- dom ---------- */
  var svg = $("#map");
  var mapWrap = $("#mapWrap");
  var mapLayer = $("#mapLayer");
  var provinceLayer = $("#provinceLayer");
  var riverLayer = $("#riverLayer");
  var labelLayer = $("#labelLayer");
  var markerLayer = $("#markerLayer");
  var insetLayer = $("#insetLayer");
  var tooltip = $("#tooltip");
  var legend = $("#legend");
  var listEl = $("#list");
  var emptyEl = $("#empty");
  var countNum = $("#countNum");
  var countHint = $("#countHint");
  var listSub = $("#listSub");
  var mapCaptionSub = $("#mapCaptionSub");
  var searchInput = $("#search");
  var eraChips = $("#eraChips");
  var statusChips = $("#statusChips");
  var catSelect = $("#catSelect");
  var provSelect = $("#provSelect");
  var sortSelect = $("#sortSelect");
  var drawer = $("#drawer");
  var drawerInner = $("#drawerInner");
  var drawerBackdrop = $("#drawerBackdrop");
  var aboutModal = $("#aboutModal");
  var aboutClose = $("#aboutClose");
  var toastEl = $("#toast");
  var mapHint = $("#mapHint");

  /* ---------- state ---------- */
  var state = {
    q: "",
    eras: new Set(),
    statuses: new Set(),
    cat: "all",
    prov: "all",
    sort: "curated",
    selected: null,
    hover: null,
    k: 1,
    tx: 0,
    ty: 0,
    pointers: new Map(),
    drag: null,
    pinch: null,
    anim: null,
    lastFocus: null
  };

  var labelEls = [], riverLabelEls = [];
  var toastTimer = null, searchTimer = null, hintTimer = null;

  /* ---------- utils ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    var idx = String(text).toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return esc(text);
    return esc(String(text).slice(0, idx)) + "<mark>" + esc(String(text).slice(idx, idx + q.length)) + "</mark>" + esc(String(text).slice(idx + q.length));
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
      });
    }
    return e;
  }

  function countBy(arr, key) {
    var out = {};
    arr.forEach(function (x) { out[x[key]] = (out[x[key]] || 0) + 1; });
    return out;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1900);
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("坐标已复制"); }
      catch (e) { toast("请手动复制坐标"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast("坐标已复制"); }, fallback);
    } else {
      fallback();
    }
  }

  /* =========================================================
     map construction
     ========================================================= */
  function buildMap() {
    if (!MAP) return;

    provinceLayer.innerHTML = MAP.provinces.map(function (p) {
      return '<path class="province" d="' + p.d + '"><title>' + esc(p.name) + "</title></path>";
    }).join("");

    riverLayer.innerHTML = MAP.rivers.map(function (r) {
      return '<path class="river" d="' + r.d + '"></path>';
    }).join("");

    MAP.labels.forEach(function (l) {
      var major = ["新疆", "西藏", "青海", "内蒙古", "四川", "云南", "甘肃", "黑龙江"];
      var t = svgEl("text", { x: l.x, y: l.y, "text-anchor": "middle", class: "province-label" + (major.indexOf(l.name) >= 0 ? " major" : "") });
      t.textContent = l.name;
      labelLayer.appendChild(t);
      labelEls.push(t);
    });

    var riverLabels = [
      { name: "黄河", lng: 110.2, lat: 38.9 },
      { name: "长江", lng: 112.4, lat: 30.2 }
    ];
    riverLabels.forEach(function (r) {
      var pos = project(r.lng, r.lat);
      var t = svgEl("text", { x: pos[0], y: pos[1], class: "river-label", "text-anchor": "middle" });
      t.textContent = r.name;
      labelLayer.appendChild(t);
      riverLabelEls.push(t);
    });

    // South China Sea inset (fixed, outside the pan/zoom layer)
    if (MAP.inset) {
      var ins = MAP.inset;
      var rect = $("#insetClipRect");
      if (rect) {
        rect.setAttribute("x", ins.x);
        rect.setAttribute("y", ins.y);
        rect.setAttribute("width", ins.w);
        rect.setAttribute("height", ins.h);
      }
      var g = svgEl("g", { "clip-path": "url(#insetClip)", opacity: "0.95" });
      var box = svgEl("rect", {
        x: ins.x, y: ins.y, width: ins.w, height: ins.h, rx: 3, class: "inset-box"
      });
      var islands = svgEl("path", { d: ins.islands, class: "inset-island" });
      var dash = svgEl("path", { d: ins.dash, class: "inset-dash" });
      var label = svgEl("text", {
        x: ins.labelX, y: ins.labelY, class: "inset-label"
      });
      label.textContent = "南海诸岛";
      g.appendChild(box);
      g.appendChild(dash);
      g.appendChild(islands);
      g.appendChild(label);
      insetLayer.appendChild(g);
    }

    legend.innerHTML = STATUS.map(function (s) {
      var cls = s === "未发掘" ? " unexcavated" : s === "未证实" ? " disputed" : s === "已毁" ? " destroyed" : "";
      return '<span class="item' + cls + '"><i style="--c:' + STATUS_COLOR[s] + '"></i>' + s + "</span>";
    }).join("");

    applyTransform();
  }

  function applyTransform() {
    mapLayer.setAttribute("transform", "translate(" + state.tx.toFixed(2) + " " + state.ty.toFixed(2) + ") scale(" + state.k.toFixed(4) + ")");
    updateLabelScale();
  }

  function updateLabelScale() {
    var fs = (10 / state.k).toFixed(2);
    labelEls.forEach(function (el) {
      var show = state.k >= 1.28 || el.classList.contains("major");
      el.classList.toggle("show", show);
      el.classList.toggle("base", state.k < 1.28 && el.classList.contains("major"));
      el.style.fontSize = fs + "px";
    });
    var rfs = (9 / state.k).toFixed(2);
    riverLabelEls.forEach(function (el) { el.style.fontSize = rfs + "px"; });
  }

  function clampPan() {
    var margin = 36;
    state.tx = clamp(state.tx, W - W * state.k - margin, margin);
    state.ty = clamp(state.ty, H - H * state.k - margin, margin);
  }

  function screenPos(t) {
    return [t._x * state.k + state.tx, t._y * state.k + state.ty];
  }

  /* =========================================================
     markers + clustering
     ========================================================= */
  function getFiltered() {
    var q = state.q.toLowerCase();
    return TOMBS.filter(function (t) {
      if (state.eras.size && !state.eras.has(t.era)) return false;
      if (state.statuses.size && !state.statuses.has(t.status)) return false;
      if (state.cat !== "all" && t.cat !== state.cat) return false;
      if (state.prov !== "all" && t.province !== state.prov) return false;
      if (q && t._search.indexOf(q) < 0) return false;
      return true;
    });
  }

  function clusterTombs(arr) {
    var cell = state.k >= 3 ? 23 : 31;
    var grid = new Map();
    arr.forEach(function (t) {
      var p = screenPos(t);
      if (p[0] < -60 || p[0] > W + 60 || p[1] < -60 || p[1] > H + 60) return;
      var key = Math.floor(p[0] / cell) + ":" + Math.floor(p[1] / cell);
      var c = grid.get(key);
      if (!c) {
        c = { items: [], sx: 0, sy: 0 };
        grid.set(key, c);
      }
      c.items.push(t);
      c.sx += p[0];
      c.sy += p[1];
    });
    var out = [];
    grid.forEach(function (c) {
      out.push({
        items: c.items,
        x: c.sx / c.items.length,
        y: c.sy / c.items.length
      });
    });
    return out;
  }

  function renderMarkers(arr) {
    if (!MAP) return;
    if (state.anim) return;
    markerLayer.removeAttribute("transform");
    arr = arr || getFiltered();
    var selected = state.selected ? byId.get(state.selected) : null;
    var pool = selected ? arr.filter(function (t) { return t.id !== selected.id; }) : arr;
    var clusters = clusterTombs(pool);
    var frag = document.createDocumentFragment();

    var selPos = selected ? screenPos(selected) : null;
    clusters.forEach(function (c) {
      // While a tomb is open, clear a small stage around it so the
      // selected marker is not buried under a count bubble.
      if (selPos && Math.hypot(c.x - selPos[0], c.y - selPos[1]) < 30) return;
      if (c.items.length === 1) {
        frag.appendChild(markerNode(c.items[0], c.x, c.y));
      } else {
        frag.appendChild(clusterNode(c));
      }
    });

    // Always draw the selected tomb on top, even if it would be clustered.
    if (selected) {
      var sp = screenPos(selected);
      frag.appendChild(markerNode(selected, sp[0], sp[1]));
    }

    markerLayer.replaceChildren(frag);
  }

  function markerNode(t, x, y) {
    var color = STATUS_COLOR[t.status] || "#c9a86a";
    var selected = state.selected === t.id;
    var g = svgEl("g", {
      class: "marker" + (selected ? " selected" : ""),
      transform: "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")",
      "data-id": t.id,
      role: "img",
      "aria-label": t.name + "，" + t.dynasty + "，" + t.status
    });

    var title = document.createElementNS(NS, "title");
    title.textContent = t.name + " · " + t.dynasty + " · " + t.status;
    g.appendChild(title);

    if (selected) {
      g.appendChild(svgEl("circle", {
        class: "selected-ring", r: 12, fill: "none",
        stroke: "#e3c78f", "stroke-width": 1.3, "stroke-dasharray": "2 3"
      }));
      g.appendChild(svgEl("circle", { class: "halo", r: 7 }));
    }

    var shape = svgEl("g", { class: "shape" });

    if (t.status === "已发掘") {
      shape.appendChild(svgEl("circle", { r: 5.2, fill: color, stroke: "#0d0c0a", "stroke-width": 1.2 }));
    } else if (t.status === "部分发掘") {
      shape.appendChild(svgEl("circle", { r: 5.4, fill: color, stroke: "#0d0c0a", "stroke-width": 1.2 }));
      shape.appendChild(svgEl("circle", { r: 1.8, fill: "#15120e" }));
    } else if (t.status === "未发掘") {
      shape.appendChild(svgEl("circle", { r: 5.1, fill: "#0d0c0a", stroke: color, "stroke-width": 1.9 }));
    } else if (t.status === "未证实") {
      shape.appendChild(svgEl("path", {
        d: "M 0 -6.6 L 6.6 0 L 0 6.6 L -6.6 0 Z",
        fill: "#0d0c0a", stroke: color, "stroke-width": 1.7, "stroke-linejoin": "round"
      }));
    } else {
      shape.appendChild(svgEl("path", {
        d: "M -4 -4 L 4 4 M 4 -4 L -4 4",
        fill: "none", stroke: color, "stroke-width": 1.8, "stroke-linecap": "round"
      }));
    }

    g.appendChild(shape);
    g.appendChild(svgEl("circle", { r: 13, fill: "transparent", class: "hit" }));

    g.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    g.addEventListener("pointerenter", function (e) {
      showTooltip(t, e);
      state.hover = t.id;
      setCardHover(t.id, true);
    });
    g.addEventListener("pointermove", function (e) { moveTooltip(e); });
    g.addEventListener("pointerleave", function () {
      hideTooltip();
      state.hover = null;
      setCardHover(t.id, false);
    });
    g.addEventListener("click", function (e) {
      e.stopPropagation();
      selectTomb(t.id, { fly: true });
    });

    return g;
  }

  function clusterNode(c) {
    var n = c.items.length;
    var r = 11.5 + Math.min(9, Math.log2(n) * 2.7);
    var g = svgEl("g", {
      class: "cluster",
      transform: "translate(" + c.x.toFixed(1) + " " + c.y.toFixed(1) + ")",
      role: "button",
      "aria-label": n + " 处墓葬，点击放大"
    });
    var title = document.createElementNS(NS, "title");
    title.textContent = n + " 处墓葬 · 点击放大";
    g.appendChild(title);
    g.appendChild(svgEl("circle", { r: r.toFixed(1) }));
    var text = svgEl("text", {});
    text.textContent = n;
    g.appendChild(text);

    g.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    g.addEventListener("pointerenter", function (e) {
      showClusterTooltip(c, e);
    });
    g.addEventListener("pointermove", function (e) { moveTooltip(e); });
    g.addEventListener("pointerleave", hideTooltip);
    g.addEventListener("click", function (e) {
      e.stopPropagation();
      zoomToCluster(c.items);
    });
    return g;
  }

  function setCardHover(id, on) {
    var card = listEl.querySelector('.card[data-id="' + id + '"]');
    if (card) card.classList.toggle("is-hover", on);
  }

  /* =========================================================
     tooltip
     ========================================================= */
  function positionTooltip(e) {
    var rect = mapWrap.getBoundingClientRect();
    var x = clamp(e.clientX - rect.left, 86, Math.max(86, rect.width - 86));
    var y = clamp(e.clientY - rect.top, 72, Math.max(72, rect.height - 30));
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  function showTooltip(t, e) {
    var color = STATUS_COLOR[t.status] || "#c9a86a";
    tooltip.innerHTML = '<span class="tt-name">' + esc(t.name) + '</span>' +
      '<span class="tt-meta"><i class="tt-dot" style="background:' + color + '"></i>' + esc(t.dynasty) + " · " + esc(t.status) + "</span>";
    tooltip.classList.add("show");
    positionTooltip(e);
  }

  function showClusterTooltip(c, e) {
    tooltip.innerHTML = '<span class="tt-name">' + c.items.length + " 处墓葬</span>" +
      '<span class="tt-meta">点击放大查看</span>';
    tooltip.classList.add("show");
    positionTooltip(e);
  }

  function moveTooltip(e) {
    if (tooltip.classList.contains("show")) positionTooltip(e);
  }

  function hideTooltip() {
    tooltip.classList.remove("show");
  }

  /* =========================================================
     pan / zoom / animation
     ========================================================= */
  function cancelAnim() {
    if (state.anim) {
      cancelAnimationFrame(state.anim);
      state.anim = null;
    }
    markerLayer.style.opacity = "1";
    markerLayer.style.pointerEvents = "";
  }

  function zoomAt(px, py, nextK) {
    cancelAnim();
    nextK = clamp(nextK, 1, 10);
    var ratio = nextK / state.k;
    state.tx = px - (px - state.tx) * ratio;
    state.ty = py - (py - state.ty) * ratio;
    state.k = nextK;
    clampPan();
    applyTransform();
    renderMarkers();
  }

  function animateTo(target, duration) {
    cancelAnim();
    duration = duration || 440;
    target.k = clamp(target.k, 1, 10);
    var margin = 36;
    target.tx = clamp(target.tx, W - W * target.k - margin, margin);
    target.ty = clamp(target.ty, H - H * target.k - margin, margin);

    var from = { k: state.k, tx: state.tx, ty: state.ty };
    var start = performance.now();
    markerLayer.style.opacity = "0";
    markerLayer.style.pointerEvents = "none";

    function step(now) {
      var p = clamp((now - start) / duration, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      state.k = from.k + (target.k - from.k) * e;
      state.tx = from.tx + (target.tx - from.tx) * e;
      state.ty = from.ty + (target.ty - from.ty) * e;
      applyTransform();
      if (p < 1) {
        state.anim = requestAnimationFrame(step);
      } else {
        state.anim = null;
        markerLayer.style.opacity = "1";
        markerLayer.style.pointerEvents = "";
        renderMarkers();
      }
    }
    state.anim = requestAnimationFrame(step);
  }

  function focusTomb(t, zoom) {
    var targetK = Math.max(state.k, zoom || 3.3);
    var cx = W * 0.47;
    animateTo({
      k: targetK,
      tx: cx - t._x * targetK,
      ty: H * 0.47 - t._y * targetK
    });
  }

  function zoomToCluster(items) {
    var xs = items.map(function (t) { return t._x; });
    var ys = items.map(function (t) { return t._y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var bw = Math.max(28, maxX - minX);
    var bh = Math.max(28, maxY - minY);
    var k = Math.min((W * 0.72) / bw, (H * 0.68) / bh, 8);
    k = Math.max(k, Math.min(8, state.k * 1.7));
    animateTo({
      k: k,
      tx: W / 2 - ((minX + maxX) / 2) * k,
      ty: H / 2 - ((minY + maxY) / 2) * k
    }, 480);
  }

  function svgPoint(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    var ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest && e.target.closest(".marker, .cluster")) return;
    cancelAnim();
    hideTooltip();
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = svgPoint(e);
    state.pointers.set(e.pointerId, { x: p.x, y: p.y });

    if (state.pointers.size === 1) {
      state.drag = {
        startTx: state.tx,
        startTy: state.ty,
        startX: p.x,
        startY: p.y,
        moved: false
      };
      svg.classList.add("dragging");
    } else if (state.pointers.size === 2) {
      var pts = Array.from(state.pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      state.pinch = {
        dist: Math.max(1, dist),
        k: state.k,
        tx: state.tx,
        ty: state.ty,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2
      };
      state.drag = null;
      markerLayer.removeAttribute("transform");
      markerLayer.style.opacity = "0.15";
    }
  }

  function onPointerMove(e) {
    if (!state.pointers.has(e.pointerId)) return;
    var p = svgPoint(e);
    state.pointers.set(e.pointerId, { x: p.x, y: p.y });

    if (state.pinch && state.pointers.size >= 2) {
      var pts = Array.from(state.pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var midX = (pts[0].x + pts[1].x) / 2;
      var midY = (pts[0].y + pts[1].y) / 2;
      var nextK = clamp(state.pinch.k * (dist / state.pinch.dist), 1, 10);
      var baseX = (state.pinch.midX - state.pinch.tx) / state.pinch.k;
      var baseY = (state.pinch.midY - state.pinch.ty) / state.pinch.k;
      state.k = nextK;
      state.tx = midX - baseX * nextK;
      state.ty = midY - baseY * nextK;
      clampPan();
      applyTransform();
      return;
    }

    if (!state.drag) return;
    var dx = p.x - state.drag.startX;
    var dy = p.y - state.drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.drag.moved = true;
    state.tx = state.drag.startTx + dx;
    state.ty = state.drag.startTy + dy;
    clampPan();
    applyTransform();
    markerLayer.setAttribute("transform", "translate(" + dx.toFixed(1) + " " + dy.toFixed(1) + ")");
  }

  function onPointerUp(e) {
    state.pointers.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    var wasPinch = !!state.pinch;
    if (state.pointers.size < 2 && wasPinch) {
      state.pinch = null;
      markerLayer.style.opacity = "1";
      renderMarkers();
    }

    if (state.pointers.size === 0) {
      if (state.drag) {
        markerLayer.removeAttribute("transform");
        state.drag = null;
        renderMarkers();
      }
      state.pinch = null;
      svg.classList.remove("dragging");
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var p = svgPoint(e);
    var factor = Math.exp(-e.deltaY * 0.0014);
    zoomAt(p.x, p.y, state.k * factor);
  }

  /* =========================================================
     filters + list
     ========================================================= */
  function hasFilters() {
    return !!(state.q || state.eras.size || state.statuses.size || state.cat !== "all" || state.prov !== "all");
  }

  function buildFilters() {
    var eraCounts = countBy(TOMBS, "era");
    var statusCounts = countBy(TOMBS, "status");
    var catCounts = countBy(TOMBS, "cat");
    var provCounts = countBy(TOMBS, "province");

    eraChips.innerHTML = '<button type="button" class="chip active" data-era="" aria-pressed="true">全部<span class="n">' + TOMBS.length + "</span></button>" +
      ERAS.map(function (e) {
        var n = eraCounts[e] || 0;
        return '<button type="button" class="chip" data-era="' + esc(e) + '" aria-pressed="false">' + esc(e) + '<span class="n">' + n + "</span></button>";
      }).join("");

    statusChips.innerHTML = '<button type="button" class="chip active" data-status="" aria-pressed="true">全部<span class="n">' + TOMBS.length + "</span></button>" +
      STATUS.map(function (s) {
        var n = statusCounts[s] || 0;
        return '<button type="button" class="chip" data-status="' + esc(s) + '" style="--dot:' + STATUS_COLOR[s] + '" aria-pressed="false"><i class="dot"></i>' + esc(s) + '<span class="n">' + n + "</span></button>";
      }).join("");

    catSelect.innerHTML = '<option value="all">全部类别 · ' + TOMBS.length + "</option>" +
      CATS.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + " · " + (catCounts[c] || 0) + "</option>";
      }).join("");

    var provs = Object.keys(provCounts).sort(function (a, b) {
      return provCounts[b] - provCounts[a] || a.localeCompare(b, "zh-Hans-CN");
    });
    provSelect.innerHTML = '<option value="all">全部省份 · ' + provs.length + "</option>" +
      provs.map(function (p) {
        return '<option value="' + esc(p) + '">' + esc(p) + " · " + provCounts[p] + "</option>";
      }).join("");
  }

  function updateChipStates() {
    $$(".chip", eraChips).forEach(function (b) {
      var v = b.getAttribute("data-era");
      var active = v ? state.eras.has(v) : state.eras.size === 0;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
    $$(".chip", statusChips).forEach(function (b) {
      var v = b.getAttribute("data-status");
      var active = v ? state.statuses.has(v) : state.statuses.size === 0;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function sortTombs(arr) {
    var a = arr.slice();
    if (state.sort === "era") {
      a.sort(function (x, y) {
        return x._eraRank - y._eraRank || x._i - y._i;
      });
    } else if (state.sort === "name") {
      a.sort(function (x, y) { return x.name.localeCompare(y.name, "zh-Hans-CN"); });
    } else if (state.sort === "province") {
      a.sort(function (x, y) {
        return x.province.localeCompare(y.province, "zh-Hans-CN") || x._eraRank - y._eraRank || x._i - y._i;
      });
    } else {
      a.sort(function (x, y) {
        return x._catRank - y._catRank || x._eraRank - y._eraRank || x._i - y._i;
      });
    }
    return a;
  }

  function cardHTML(t) {
    var color = STATUS_COLOR[t.status] || "#c9a86a";
    var alias = t.alias ? "<em>" + esc(t.alias) + "</em>" : "";
    var q = state.q;
    return '<article class="card' + (state.selected === t.id ? " selected" : "") + '" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="' + esc(t.name + "，" + t.province + "，" + t.status) + '" style="--sc:' + color + '">' +
      '<span class="card-mark">' + esc(CAT_MARK[t.cat] || "墓") + "</span>" +
      '<span class="card-body">' +
        '<span class="card-title">' + highlight(t.name, q) + alias + "</span>" +
        '<span class="card-meta"><span>' + esc(t.dynasty) + '</span><span class="sep">·</span><span>' + esc(t.province) + " " + esc(t.city) + '</span><span class="sep">·</span><span class="card-status"><i></i>' + esc(t.status) + "</span></span>" +
        '<span class="card-summary">' + esc(t.summary) + "</span>" +
      "</span>" +
      "</article>";
  }

  function renderList(arr) {
    arr = arr || sortTombs(getFiltered());
    if (!arr.length) {
      listEl.innerHTML = "";
      listEl.hidden = true;
      emptyEl.classList.remove("hidden");
    } else {
      listEl.hidden = false;
      emptyEl.classList.add("hidden");
      listEl.innerHTML = arr.map(cardHTML).join("");
    }
    updateCounts(arr);
  }

  function updateCounts(arr) {
    arr = arr || getFiltered();
    var provCount = new Set(TOMBS.map(function (t) { return t.province; })).size;
    countNum.textContent = arr.length;
    countHint.textContent = hasFilters() ? "共 " + TOMBS.length + " 处" : provCount + " 个省级行政区";
    mapCaptionSub.textContent = hasFilters()
      ? "当前显示 " + arr.length + " 处"
      : TOMBS.length + " 处 · " + provCount + " 个省级行政区";

    if (state.q) {
      listSub.textContent = "搜索“" + state.q + "” · " + arr.length + " 处";
    } else if (hasFilters()) {
      listSub.textContent = "筛选结果 · " + arr.length + " 处";
    } else {
      listSub.textContent = "按类别与时代排列 · " + arr.length + " 处";
    }
  }

  function applyFilters() {
    var arr = getFiltered();
    if (state.selected && !arr.some(function (t) { return t.id === state.selected; })) {
      closeDrawer({ history: false, silent: true });
    }
    renderList(sortTombs(arr));
    renderMarkers(arr);
    updateChipStates();
    countNum.textContent = arr.length;
    countHint.textContent = hasFilters() ? "共 " + TOMBS.length + " 处" : new Set(TOMBS.map(function (t) { return t.province; })).size + " 个省级行政区";
  }

  function resetFilters() {
    state.q = "";
    state.eras.clear();
    state.statuses.clear();
    state.cat = "all";
    state.prov = "all";
    searchInput.value = "";
    catSelect.value = "all";
    provSelect.value = "all";
    applyFilters();
  }

  /* =========================================================
     drawer / detail
     ========================================================= */
  function selectTomb(id, opts) {
    opts = opts || {};
    var t = byId.get(id);
    if (!t) return;
    hideTooltip();

    if (drawer.classList.contains("open") && state.selected !== id) {
      // keep the previous focus only for a fresh open
    } else {
      state.lastFocus = document.activeElement;
    }

    state.selected = id;
    if (opts.history !== false) syncHash(id);

    renderDrawer(t);
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    drawerBackdrop.hidden = false;
    document.body.classList.add("drawer-open");

    updateListSelection();
    renderMarkers();
    ensureCardVisible(id);

    if (opts.fly !== false) focusTomb(t, opts.zoom || 3.3);

    var closeBtn = drawer.querySelector(".detail-close");
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeDrawer(opts) {
    opts = opts || {};
    if (!state.selected) return;
    state.selected = null;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    drawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
    if (opts.history !== false) syncHash(null);
    updateListSelection();
    if (!opts.silent) renderMarkers();
    if (state.lastFocus && document.contains(state.lastFocus)) {
      try { state.lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  function updateListSelection() {
    $$(".card", listEl).forEach(function (c) {
      c.classList.toggle("selected", c.getAttribute("data-id") === state.selected);
    });
  }

  function ensureCardVisible(id) {
    if (window.matchMedia("(max-width: 820px)").matches) return;
    var card = listEl.querySelector('.card[data-id="' + id + '"]');
    if (card) card.scrollIntoView({ block: "nearest" });
  }

  function relatedTombs(t) {
    return TOMBS.filter(function (x) { return x.id !== t.id; }).map(function (x) {
      var score = 0;
      if (x.cat === t.cat) score += 2;
      if (x.era === t.era) score += 1;
      if (x.province === t.province) score += 3;
      if (x.dynasty === t.dynasty) score += 1;
      return { t: x, score: score };
    }).filter(function (o) { return o.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.t._i - b.t._i; })
      .slice(0, 3)
      .map(function (o) { return o.t; });
  }

  function renderDrawer(t) {
    var color = STATUS_COLOR[t.status] || "#c9a86a";
    var tags = (t.tags || []).map(function (g) {
      return '<span class="tag' + (/世界文化|国保|十大/.test(g) ? " gold" : "") + '">' + esc(g) + "</span>";
    }).join("");
    var finds = (t.finds || []).length
      ? t.finds.map(function (f) { return '<span class="find">' + esc(f) + "</span>"; }).join("")
      : '<span class="find">暂无公开出土物清单</span>';

    var facts = [];
    if (t.structure) facts.push('<li><span>形制</span><span>' + esc(t.structure) + "</span></li>");
    if (t.excavation) facts.push('<li><span>考古</span><span>' + esc(t.excavation) + "</span></li>");
    if (t.level) facts.push('<li><span>保护</span><span>' + esc(t.level) + "</span></li>");

    var related = relatedTombs(t);
    var relatedHTML = related.length ? '<section class="detail-section"><h3>相近墓葬</h3><div class="related">' +
      related.map(function (r) {
        return '<button type="button" class="related-item" data-related="' + esc(r.id) + '"><span>' + esc(r.name) + "</span><small>" + esc(r.province) + " · " + esc(r.status) + "</small></button>";
      }).join("") + "</div></section>" : "";

    var searchQ = encodeURIComponent(t.name + " " + t.dynasty + " 考古");
    var osm = "https://www.openstreetmap.org/?mlat=" + t.lat + "&mlon=" + t.lng + "#map=15/" + t.lat + "/" + t.lng;
    var amap = "https://uri.amap.com/marker?position=" + t.lng + "," + t.lat + "&name=" + encodeURIComponent(t.name) + "&src=tomb-atlas&coordinate=wgs84&callnative=0";

    drawerInner.innerHTML =
      '<div class="detail-hero">' +
        '<span class="detail-dynasty" aria-hidden="true">' + esc((t.dynasty || "墓").slice(0, 1)) + "</span>" +
        '<button type="button" class="detail-close" data-action="close" aria-label="关闭详情">×</button>' +
        '<div class="detail-badges">' +
          '<span class="badge cat">' + esc(t.cat) + "</span>" +
          '<span class="badge status" style="--sc:' + color + '"><i></i>' + esc(t.status) + "</span>" +
        "</div>" +
        "<h2>" + esc(t.name) + "</h2>" +
        (t.alias ? '<p class="detail-alias">又名 · ' + esc(t.alias) + "</p>" : '<p class="detail-alias">' + esc(t.dynasty) + " · " + esc(t.era) + "</p>") +
        (tags ? '<div class="detail-tags">' + tags + "</div>" : "") +
      "</div>" +
      '<div class="detail-meta">' +
        '<div class="meta-cell"><span class="meta-label">年代</span><span class="meta-value">' + esc(t.dynasty) + " · " + esc(t.era) + "</span></div>" +
        '<div class="meta-cell"><span class="meta-label">位置</span><span class="meta-value">' + esc(t.province) + " · " + esc(t.city) + '<br><small class="coord-note">' + esc(t.coordNote || "遗址大致中心") + "</small></span></div>" +
        '<div class="meta-cell"><span class="meta-label">保护级别</span><span class="meta-value">' + esc(t.level || "—") + "</span></div>" +
        '<div class="meta-cell"><span class="meta-label">坐标 · WGS84</span><span class="meta-value mono">' + Number(t.lat).toFixed(4) + "°N<br>" + Number(t.lng).toFixed(4) + "°E</span></div>" +
      "</div>" +
      '<div class="detail-actions">' +
        '<button type="button" class="action" data-action="center">在地图上居中</button>' +
        '<button type="button" class="action" data-action="copy">复制坐标</button>' +
        '<a class="action" href="' + osm + '" target="_blank" rel="noopener">OpenStreetMap ↗</a>' +
        '<a class="action" href="' + amap + '" target="_blank" rel="noopener">高德地图 ↗</a>' +
      "</div>" +
      '<section class="detail-section"><h3>概况</h3><p>' + esc(t.summary) + "</p><p>" + esc(t.detail) + "</p></section>" +
      (facts.length ? '<section class="detail-section"><h3>形制与考古</h3><ul class="fact-list">' + facts.join("") + "</ul></section>" : "") +
      '<section class="detail-section"><h3>出土与看点</h3><div class="finds">' + finds + "</div></section>" +
      (t.dispute ? '<section class="detail-section"><h3>争议与未解</h3><div class="dispute"><p>' + esc(t.dispute) + "</p></div></section>" : "") +
      relatedHTML +
      '<section class="detail-section"><h3>延伸检索</h3><div class="source-links">' +
        '<a href="https://zh.wikipedia.org/w/index.php?search=' + searchQ + '" target="_blank" rel="noopener">维基百科</a>' +
        '<a href="https://www.baidu.com/s?wd=' + searchQ + '" target="_blank" rel="noopener">百度检索</a>' +
        '<a href="https://www.openstreetmap.org/?mlat=' + t.lat + '&mlon=' + t.lng + '#map=14/' + t.lat + '/' + t.lng + '" target="_blank" rel="noopener">OSM 地图</a>' +
      "</div></section>" +
      '<p class="detail-note">信息由公开资料整理，坐标为 WGS84 近似值；“未证实”条目不等于考古确认。现场参观请遵守文物保护规定，以官方开放信息为准。</p>';

    drawerInner.scrollTop = 0;
  }

  /* =========================================================
     about / stats
     ========================================================= */
  function buildAbout() {
    var total = TOMBS.length;
    var statusCounts = countBy(TOMBS, "status");
    var provCount = new Set(TOMBS.map(function (t) { return t.province; })).size;
    var excavated = statusCounts["已发掘"] || 0;
    var pending = (statusCounts["未发掘"] || 0) + (statusCounts["未证实"] || 0);

    var stats = [
      { n: total, label: "处墓葬与墓群" },
      { n: excavated, label: "处已发掘" },
      { n: pending, label: "处未发掘 / 待确认" },
      { n: provCount, label: "个省级行政区" }
    ];
    $("#aboutStats").innerHTML = stats.map(function (s) {
      return '<div class="stat"><strong>' + s.n + "</strong><span>" + s.label + "</span></div>";
    }).join("");
    $("#aboutCount").textContent = total;
    $("#aboutProv").textContent = provCount;

    $("#statusLegend").innerHTML = STATUS.map(function (s) {
      var cls = s === "未发掘" ? "hollow" : s === "未证实" ? "diamond" : "";
      return '<li class="' + cls + '"><i style="--c:' + STATUS_COLOR[s] + '"></i><span><b>' + s + "</b> — " + STATUS_NOTE[s] + "</span></li>";
    }).join("");
  }

  function openAbout() {
    state.lastFocus = document.activeElement;
    aboutModal.hidden = false;
    document.body.classList.add("modal-open");
    if (location.hash !== "#about") {
      try { history.replaceState(null, "", location.pathname + location.search + "#about"); } catch (e) { /* ignore */ }
    }
    if (aboutClose) aboutClose.focus();
  }

  function closeAbout() {
    aboutModal.hidden = true;
    document.body.classList.remove("modal-open");
    if (location.hash === "#about") syncHash(null);
    if (state.lastFocus && document.contains(state.lastFocus)) {
      try { state.lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  /* =========================================================
     URL hash
     ========================================================= */
  function parseHash() {
    var m = /^#tomb=(.+)$/.exec(location.hash);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }

  function syncHash(id) {
    var base = location.pathname + location.search;
    var next = id ? base + "#tomb=" + encodeURIComponent(id) : base;
    try { history.replaceState(null, "", next); } catch (e) { /* file:// may restrict */ }
  }

  /* =========================================================
     events
     ========================================================= */
  function bindEvents() {
    eraChips.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var v = b.getAttribute("data-era");
      if (!v) state.eras.clear();
      else if (state.eras.has(v)) state.eras.delete(v);
      else state.eras.add(v);
      applyFilters();
    });

    statusChips.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var v = b.getAttribute("data-status");
      if (!v) state.statuses.clear();
      else if (state.statuses.has(v)) state.statuses.delete(v);
      else state.statuses.add(v);
      applyFilters();
    });

    catSelect.addEventListener("change", function () {
      state.cat = catSelect.value;
      applyFilters();
    });

    provSelect.addEventListener("change", function () {
      state.prov = provSelect.value;
      applyFilters();
    });

    sortSelect.addEventListener("change", function () {
      state.sort = sortSelect.value;
      renderList(sortTombs(getFiltered()));
    });

    $("#resetBtn").addEventListener("click", resetFilters);
    $("#emptyReset").addEventListener("click", resetFilters);

    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.q = searchInput.value.trim();
        applyFilters();
      }, 110);
    });

    searchInput.addEventListener("search", function () {
      state.q = searchInput.value.trim();
      applyFilters();
    });

    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (searchInput.value) {
          searchInput.value = "";
          state.q = "";
          applyFilters();
        } else {
          searchInput.blur();
        }
        e.stopPropagation();
      }
    });

    $("#randomBtn").addEventListener("click", function () {
      var pool = getFiltered();
      if (!pool.length) { toast("当前筛选没有结果"); return; }
      var t = pool[Math.floor(Math.random() * pool.length)];
      selectTomb(t.id, { fly: true, zoom: 4 });
    });

    $("#aboutBtn").addEventListener("click", openAbout);
    aboutClose.addEventListener("click", closeAbout);
    aboutModal.addEventListener("click", function (e) {
      if (e.target === aboutModal) closeAbout();
    });

    listEl.addEventListener("click", function (e) {
      var card = e.target.closest(".card");
      if (card) selectTomb(card.getAttribute("data-id"), { fly: true });
    });

    listEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest(".card");
      if (!card) return;
      e.preventDefault();
      selectTomb(card.getAttribute("data-id"), { fly: true });
    });

    listEl.addEventListener("pointerover", function (e) {
      var card = e.target.closest(".card");
      if (!card) return;
      var id = card.getAttribute("data-id");
      if (state.hover === id) return;
      state.hover = id;
      card.classList.add("is-hover");
      var m = markerLayer.querySelector('.marker[data-id="' + id + '"]');
      if (m) m.classList.add("is-hover");
    });

    listEl.addEventListener("pointerout", function (e) {
      var card = e.target.closest(".card");
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      var id = card.getAttribute("data-id");
      card.classList.remove("is-hover");
      var m = markerLayer.querySelector('.marker[data-id="' + id + '"]');
      if (m) m.classList.remove("is-hover");
      if (state.hover === id) state.hover = null;
    });

    drawerInner.addEventListener("click", function (e) {
      var rel = e.target.closest("[data-related]");
      if (rel) {
        selectTomb(rel.getAttribute("data-related"), { fly: true });
        return;
      }
      var action = e.target.closest("[data-action]");
      if (!action) return;
      var act = action.getAttribute("data-action");
      if (act === "close") closeDrawer();
      else if (act === "center" && state.selected) {
        var t = byId.get(state.selected);
        if (t) focusTomb(t, Math.max(state.k, 4));
      } else if (act === "copy" && state.selected) {
        var ct = byId.get(state.selected);
        if (ct) copyText(Number(ct.lat).toFixed(4) + ", " + Number(ct.lng).toFixed(4));
      }
    });

    drawerBackdrop.addEventListener("click", function () { closeDrawer(); });

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("dblclick", function (e) {
      e.preventDefault();
      var p = svgPoint(e);
      zoomAt(p.x, p.y, state.k * 1.7);
    });

    $("#zoomIn").addEventListener("click", function () { zoomAt(W / 2, H / 2, state.k * 1.35); });
    $("#zoomOut").addEventListener("click", function () { zoomAt(W / 2, H / 2, state.k / 1.35); });
    $("#zoomReset").addEventListener("click", function () {
      animateTo({ k: 1, tx: 0, ty: 0 }, 420);
    });

    document.addEventListener("keydown", function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (document.activeElement && document.activeElement.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === "Escape") {
        if (!aboutModal.hidden) { closeAbout(); return; }
        if (drawer.classList.contains("open")) { closeDrawer(); return; }
        if (document.activeElement === searchInput) searchInput.blur();
      }
    });

    window.addEventListener("hashchange", function () {
      if (location.hash === "#about") { openAbout(); return; }
      var id = parseHash();
      if (id && byId.has(id)) selectTomb(id, { history: false, fly: true });
      else if (!id) closeDrawer({ history: false });
    });

    window.addEventListener("resize", function () {
      hideTooltip();
    });

    // welcome hint
    hintTimer = setTimeout(function () { mapHint.classList.add("fade"); }, 8000);
  }

  /* =========================================================
     boot
     ========================================================= */
  function boot() {
    if (!MAP || !TOMBS.length) {
      listEl.innerHTML = '<div class="empty"><span class="empty-mark">!</span><p>地图或墓葬数据未能加载，请检查 assets 目录。</p></div>';
      return;
    }
    buildMap();
    buildFilters();
    buildAbout();

    var arr = sortTombs(getFiltered());
    renderList(arr);
    renderMarkers(arr);
    updateCounts(arr);
    updateChipStates();
    bindEvents();

    var initial = parseHash();
    if (initial && byId.has(initial)) {
      setTimeout(function () { selectTomb(initial, { history: false, fly: true }); }, 260);
    } else if (location.hash === "#about") {
      setTimeout(openAbout, 120);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
