/* 企微本地客户端 · 工作台前端
   只调本地 API（127.0.0.1），不直连企微、不绕过命令服务。 */
(function () {
  "use strict";

  var S = { status: null, convs: [], policy: null, selected: {}, results: [], emotions: [] };

  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  }); }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: { "Content-Type": "application/json" } };
    var tk = localStorage.getItem("sessionToken");
    if (tk) init.headers["X-Session-Token"] = tk;
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      if (r.status === 401 && path.indexOf("/api/auth/") !== 0) {
        // 本地存的令牌过期/失效：清掉并按 Cookie 重新走一次，避免卡在"登录了但接口全 401"
        var had = localStorage.getItem("sessionToken");
        localStorage.removeItem("sessionToken");
        if (had) { location.reload(); }
      }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.human_message || j.code || r.status), { payload: j });
        return j;
      });
    });
  }

  function toast(msg, kind) {
    var el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    q("#toasts").appendChild(el);
    setTimeout(function () { el.style.opacity = "0"; setTimeout(function () { el.remove(); }, 200); }, 3200);
  }

  var modalOk = null;
  function openModal(title, body, okText, fn) {
    q("#modalTitle").textContent = title;
    q("#modalBody").innerHTML = body;
    q("#modalOk").textContent = okText || "确认";
    q("#modal").hidden = false;
    modalOk = fn;
  }
  // 去掉零宽字符（群名/昵称里常见 \u200b），否则名字看起来是空的
  function zwStrip(n) { return (n || "").replace(/[\u200b-\u200d\ufeff]/g, "") || "?"; }

  function closeModal() { q("#modal").hidden = true; modalOk = null; }
  q("#modalCancel").onclick = closeModal;
  if (q("#btnReloadNodes")) q("#btnReloadNodes").onclick = loadNodes;
  if (q("#btnReloadTasks")) q("#btnReloadTasks").onclick = loadTasks;
  q("#modalX").onclick = closeModal;
  q("#modal").onclick = function (e) { if (e.target === q("#modal")) closeModal(); };
  q("#modalOk").onclick = function () { if (modalOk) modalOk(); };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });


  /* ---------------- 客户端节点 / 任务队列 ---------------- */
  function fmtAge(sec) {
    if (sec === null || sec === undefined) return "—";
    if (sec < 60) return sec + " 秒前";
    if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
    if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
    return Math.floor(sec / 86400) + " 天前";
  }

  function nodeCard(n) {
    var cls = n.online ? "ok" : "danger";
    return '<div class="row-item">' +
      '<div class="ri-main"><div class="ri-title">' + esc(n.client_name || n.node_id) +
        ' <span class="pill ' + cls + '">' + (n.online ? "在线" : "离线") + "</span></div>" +
        '<div class="micro faint">账号 ' + esc(n.account_name || n.account || "—") +
        (n.account && n.account_name ? "（" + esc(n.account) + "）" : "") +
        " · 心跳 " + fmtAge(n.age) + " · 版本 " + esc(n.version || "—") + "</div></div>" +
      '<div class="ri-side"><div class="micro faint mono">' + esc(n.node_id) + "</div>" +
        '<div class="micro">绑定人 ' + esc(n.bound_user || "未绑定") +
        ' <button class="btn sm ghost" data-bind="' + esc(n.node_id) + '">绑定</button></div></div></div>';
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.cancel) {
      if (!confirm("取消这个任务？")) return;
      api("/api/tasks/" + encodeURIComponent(t.dataset.cancel) + "/cancel", { method: "POST" })
        .then(loadTasks).catch(function (err) { alert("取消失败：" + (err.message || err)); });
    }
    if (t.dataset.bind) {
      var name = prompt("这台客户端由谁使用？（填姓名）", "");
      if (name === null) return;
      api("/api/nodes/" + encodeURIComponent(t.dataset.bind), { method: "PATCH", body: { bound_user: name } })
        .then(loadNodes).catch(function (err) { alert("绑定失败：" + (err.message || err)); });
    }
  });

  function loadNodes() {
    api("/api/nodes").then(function (d) {
      var items = (d && d.items) || [];
      var on = items.filter(function (x) { return x.online; }).length;
      q("#nodesHint").textContent = items.length + " 台 · 在线 " + on;
      q("#nodesList").innerHTML = items.length
        ? items.map(nodeCard).join("")
        : '<div class="empty">还没有客户端连上来</div>';
    }).catch(function (e) {
      q("#nodesList").innerHTML = '<div class="empty">加载失败：' + esc(e.message || e) + "</div>";
    });
  }

  function taskRow(t) {
    var cls = t.state === "DONE" ? "ok" : t.state === "FAILED" ? "danger" : "warn";
    var evs = (t.events || []).map(function (e) {
      return '<div class="micro faint">' + esc((e.at || "").slice(11, 19)) + " · " +
             esc(e.kind) + (e.note ? " · " + esc(e.note) : "") + "</div>";
    }).join("");
    return '<div class="row-item"><div class="ri-main">' +
      '<div class="ri-title">' + esc(t.conv_name || t.conv_id || "—") +
      ' <span class="pill ' + cls + '">' + esc(t.state) + "</span></div>" +
      '<div class="micro faint">' + esc(t.kind) + " · " + esc(t.detail || "") + "</div>" + evs +
      '</div><div class="ri-side"><div class="micro faint mono">' +
      esc((t.created_at || "").slice(11, 19)) + "</div>" +
      (["SUCCEEDED", "FAILED", "CANCELLED"].indexOf(t.state) < 0
        ? '<button class="btn sm ghost" data-cancel="' + esc(t.task_id) + '">取消</button>' : "") +
      "</div></div>";
  }

  function loadTasks() {
    api("/api/tasks").then(function (d) {
      var items = (d && d.items) || [];
      q("#tasksHint").textContent = items.length + " 条";
      q("#tasksList").innerHTML = items.length
        ? items.map(taskRow).join("")
        : '<div class="empty">还没有任务</div>';
    }).catch(function (e) {
      q("#tasksList").innerHTML = '<div class="empty">加载失败：' + esc(e.message || e) + "</div>";
    });
  }

  /* ---------------- 路由 ---------------- */
  var PAGE_TITLE = { overview: "概览", conversations: "会话与聊天", mentions: "@我",
    search: "全局搜索", compose: "发送测试", limits: "频率与安全",
    site: "站点配置", platform: "平台接入", nodes: "本机通道", tasks: "本机任务" };

  function show(page) {
    qa(".panel").forEach(function (p) { p.classList.toggle("active", p.dataset.panel === page); });
    qa(".nav button[data-page]").forEach(function (b) {
      if (b.dataset.page === page) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    q("main").scrollTop = 0;
    if (q("#pageTitle")) q("#pageTitle").textContent = PAGE_TITLE[page] || page;
    // 切到 @我 时立即拉一次（面板打开才渲染列表，后台只刷徽标）
    if (page === "mentions" && typeof loadMentions === "function") loadMentions();
    if (page === "nodes" && typeof loadNodes === "function") loadNodes();
    if (page === "tasks" && typeof loadTasks === "function") loadTasks();
  }
  qa(".nav button[data-page]").forEach(function (b) { b.onclick = function () { show(b.dataset.page); }; });

  /* 分组折叠 */
  qa(".nav-head").forEach(function (h) {
    h.onclick = function () {
      var g = h.closest(".nav-group");
      var open = g.classList.toggle("open");
      h.setAttribute("aria-expanded", open ? "true" : "false");
      try { localStorage.setItem("wl_nav_" + g.dataset.group, open ? "1" : "0"); } catch (e) {}
    };
    try {
      var v = localStorage.getItem("wl_nav_" + h.dataset.toggle);
      if (v === "0") { var g = h.closest(".nav-group"); g.classList.remove("open"); h.setAttribute("aria-expanded", "false"); }
    } catch (e) {}
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-goto]");
    if (t) show(t.dataset.goto);
  });

  /* ---------------- 状态 ---------------- */
  function applyBrand(b) {
    S.brand = b || S.brand || {};
    var name = S.brand.name || "企微助手";
    if (q(".nav-title b")) q(".nav-title b").textContent = name;
    if (q(".nav-title span")) q(".nav-title span").textContent = S.brand.subtitle || "本地工作台";
    var logo = q("#navLogo");
    if (logo) {
      if (S.brand.logo_url) {
        logo.innerHTML = '<img src="' + esc(S.brand.logo_url) + '" alt="logo">';
        logo.style.background = "transparent";
      } else {
        logo.textContent = S.brand.logo || "安";
        logo.style.background = "";
      }
    }
    document.title = name;
    var link = q("#favLink");
    if (!link) {
      link = document.createElement("link");
      link.id = "favLink"; link.rel = "icon";
      document.head.appendChild(link);
    }
    if (S.brand.favicon_url) link.href = S.brand.favicon_url;
    // 站点配置页的表单也跟着回填
    if (q("#siteName") && !q("#siteName").value) {
      q("#siteName").value = name;
      q("#siteSub").value = S.brand.subtitle || "";
      q("#siteLogoText").value = S.brand.logo || "";
    }
    paintSitePreview();
  }

  function paintSitePreview() {
    var b = S.brand || {};
    var pv = q("#logoPreview");
    if (pv) {
      var txt = q("#siteLogoText") ? q("#siteLogoText").value : (b.logo || "安");
      pv.innerHTML = b.logo_url
        ? '<img src="' + esc(b.logo_url) + '" alt="logo">'
        : '<span>' + esc(txt || "安") + "</span>";
    }
    var fv = q("#favPreview");
    if (fv) fv.innerHTML = b.favicon_url
      ? '<img src="' + esc(b.favicon_url) + '" alt="fav">'
      : '<span>—</span>';
  }

  function loadBrand() {
    return api("/api/brand").then(applyBrand).catch(function () {});
  }

  function paintStatus() {
    var st = S.status; if (!st) return;
    var acc0 = st.account || {};
    q("#pillAccount").textContent = "账号 " + (acc0.id || "—") +
      (acc0.user_id ? (" · UID " + String(acc0.user_id).slice(-6)) : "");
    q("#pillAccount").title = acc0.source === "auto" ? "自动识别自当前接管的企微" : "来自配置";
    var hk = st.hook || { state: "unknown" };
    var hp = q("#pillHook");
    var okHook = String(hk.state).indexOf("hooked") === 0;
    hp.textContent = "hook " + (okHook ? "已注入" : hk.state === "mock" ? "mock" : "未注入");
    hp.className = "pill " + (okHook ? "ok" : hk.state === "mock" ? "neutral" : "danger");
    hp.title = "进程 " + (hk.pid || "—") + " · 检查于 " + (hk.checked_at || "—");
    var ph = q("#pHook");
    if (ph) ph.textContent = (hk.state || "—") + " · pid " + (hk.pid || "—");
    var pf = q("#pillPlatform");
    pf.textContent = st.platform.bound ? "平台 已绑定 · " + (st.platform.workspace || "") : "平台 未绑定";
    pf.className = "pill " + (st.platform.bound ? "info" : "neutral");
    var ps = q("#pillSend");
    ps.textContent = st.paused ? "发送 已暂停" : "发送 " + (st.conversations.authorized ? "可用" : "受限");
    ps.className = "pill " + (st.paused ? "danger" : st.conversations.authorized ? "ok" : "warn");
    q("#btnPause").textContent = st.paused ? "恢复发送" : "总暂停";
    q("#ovBanner").hidden = !st.paused;

    if (q("#mConv")) q("#mConv").textContent = st.conversations.total;
    if (q("#mConvSub")) q("#mConvSub").textContent = "已授权 " + st.conversations.authorized;
    S.convTotal = st.conversations.total;
    var s2 = st.stats || {};
    q("#mSent").textContent = s2.sent_today || 0;
    q("#mSentSub").textContent = "其中已撤回 " + (s2.recalled_today || 0);
    q("#mPending").textContent = (s2.held || 0) + (s2.approval || 0);
    q("#mPendingSub").textContent = "待放行 " + (s2.held || 0) + " · 待确认 " + (s2.approval || 0);
    if (window.loadOvStats) window.loadOvStats();
    renderPlatform(st);
    q("#fAdapter").textContent = st.adapter.adapter;
    q("#fPolicy").textContent = "v" + st.policy_version;
    q("#fClock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    var w = st.watcher || {};
    q("#fLive").textContent = w.running ? ("推送中" + (w.last ? " · " + String(w.last).slice(11, 19) : "")) : "未连接（定时同步）";
    var acc = st.account || {};
    var accTxt = "账号 " + esc(acc.id || "—");
    if (acc.user_id) accTxt += " · UID " + esc(String(acc.user_id).slice(-6));
    q("#composeAcct").innerHTML = '<span class="pill neutral" title="' +
      (acc.source === "auto" ? "自动探测自当前接管的企微" : "来自配置") + '">' + accTxt + "</span>";
    if (st.brand) applyBrand(st.brand);
    // 通道状态由 loadPlatformConfig（含心跳）渲染，这里只补充下发版本
    if (q("#pVer") && st.platform && st.platform.version) {
      q("#pVer").textContent = "v" + st.platform.version + " → applied v" + (st.platform.applied || st.platform.version);
    }
  }

  function refreshStatus() {
    return api("/api/status").then(function (st) { S.status = st; paintStatus(); });
  }

  /* ---------------- 命令详情 ---------------- */
  function openCmdDetail(id) {
    api("/api/commands/" + encodeURIComponent(id) + "?with_body=1").then(function (c) {
      var ev = (c.events || []).map(function (e) {
        return "<li><b>" + esc(e.state) + "</b><span>" + esc((e.ts || "").replace("T", " ").slice(0, 19)) +
          "</span><span>" + esc(e.reason || "") + "</span></li>";
      }).join("");
      openModal("命令 " + c.cmd_id,
        '<div class="kv" style="margin-bottom:10px">' +
        "<dt>目标</dt><dd>" + esc(c.conv_name || c.conv_id) + "</dd>" +
        "<dt>类型</dt><dd>" + esc(c.kind) + "</dd>" +
        "<dt>状态</dt><dd>" + esc(c.state) +
        (c.reason_hint ? "（" + esc(c.reason_hint) + "）" : (c.reason ? "（" + esc(c.reason) + "）" : "")) + "</dd>" +
        '<dt>时间</dt><dd class="mono">' + esc((c.created_at || "").replace("T", " ").slice(0, 19)) + "</dd>" +
        '<dt>LID</dt><dd class="mono">' + esc(c.lid || "—") + "</dd>" +
        '<dt>证据</dt><dd class="mono">' + esc(c.evidence || "—") + "</dd></div>" +
        '<div class="small muted" style="margin-bottom:4px">发出的内容</div>' +
        '<div class="cmd-body">' + esc(c.body || (c.payload && JSON.stringify(c.payload)) || "（空）") + "</div>" +
        (ev ? '<div class="small muted" style="margin-top:10px">状态流转</div><ul class="timeline">' + ev + "</ul>" : ""),
        "关闭", closeModal);
    }).catch(function (e) { toast(e.message, "danger"); });
  }


  /* ---------------- 搜索 / @我 ---------------- */
  function convOf(id, name, kind) {
    return S.convs.filter(function (c) { return String(c.conv_id) === String(id); })[0]
      || { conv_id: String(id), name: name || String(id), kind: kind === "group" ? "群聊" : "私聊" };
  }

  S.search = { q: "", page: 1, size: 50, total: 0 };

  function doSearch(reset) {
    if (reset !== false) S.search.page = 1;
    S.search.q = (q("#searchQ").value || "").trim();
    if (!S.search.q) return;
    q("#searchMeta").textContent = "搜索中…";
    var off = (S.search.page - 1) * S.search.size;
    api("/api/archive/records?q=" + encodeURIComponent(S.search.q) +
        "&limit=" + S.search.size + "&offset=" + off).then(function (r) {
      var items = r.items || [];
      S.search.total = r.total || 0;
      var pages = Math.max(1, Math.ceil(S.search.total / S.search.size));
      q("#searchMeta").textContent = "共 " + S.search.total + " 条 · 第 " + S.search.page + "/" + pages + " 页（点结果定位原文）";
      var body = q("#searchBody");
      if (!items.length) { body.innerHTML = '<tr class="tbl-empty"><td colspan="4">没有匹配。</td></tr>'; return; }
      body.innerHTML = items.map(function (m) {
        var kind = (m.media || {}).kind;
        var tag = kind === "image" ? '<span class="chip">图片</span>' :
                  kind === "file" ? '<span class="chip">文件</span>' :
                  kind === "emotion" ? '<span class="chip">表情</span>' : "";
        var txt = (m.display || m.caption || "").replace(/\s+/g, " ");
        return '<tr class="clickable" data-conv="' + esc(m.conv_id) + '" data-lid="' + esc(m.lid) +
            '" data-name="' + esc(m.conv || "") + '" data-kind="' + esc(m.kind || "") + '">' +
          '<td class="mono faint">' + esc((m.msg_time || "").slice(5, 16)) + "</td>" +
          "<td>" + esc(m.conv || m.conv_id) + "</td>" +
          "<td>" + esc(m.sender || "—") + "</td>" +
          '<td><span class="trunc">' + tag + " " + esc(txt || "(仅附件)") + "</span></td></tr>";
      }).join("");
    }).catch(function (e) { q("#searchMeta").textContent = "失败"; toast(e.message, "danger"); });
  }
  q("#btnSearch").onclick = doSearch;
  q("#searchQ").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
  q("#btnSearch").onclick = function () { doSearch(); };
  q("#searchPrev").onclick = function () { if (S.search.page > 1) { S.search.page--; doSearch(false); } };
  q("#searchNext").onclick = function () {
    var pages = Math.max(1, Math.ceil(S.search.total / S.search.size));
    if (S.search.page < pages) { S.search.page++; doSearch(false); }
  };

  q("#searchBody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-conv]"); if (!tr) return;
    if (tr.dataset.lid) { locateMessage(tr.dataset.conv, tr.dataset.lid, tr.dataset.ts); return; }
    openDrawer(convOf(tr.dataset.conv, tr.dataset.name, tr.dataset.kind));
  });

  S.mentionSeen = S.mentionSeen || {};   // 已读的 lid
  S.mentionLast = S.mentionLast || null;

  function mentionBadge(items) {
    var badge = q("#navMentionBadge");
    if (!badge) return;
    // 首次加载把已有 @ 当基线（不当成新未读），之后只计新增
    if (!S.mentionBaseline) {
      (items || []).forEach(function (m) { S.mentionSeen[String(m.lid)] = true; });
      S.mentionBaseline = true;
      badge.hidden = true; badge.textContent = "0";
      return;
    }
    var fresh = (items || []).filter(function (m) {
      return !S.mentionSeen[String(m.lid)];
    }).length;
    badge.hidden = !fresh;
    badge.textContent = fresh > 99 ? "99+" : String(fresh);
  }

  S.mentionTimer = null;

  function startMentionTimer() {
    if (S.mentionTimer) { clearInterval(S.mentionTimer); S.mentionTimer = null; }
    var sec = parseInt((q("#mentionEvery") || {}).value, 10);
    if (!sec) {
      var b = q("#navMentionBadge");
      if (b) b.hidden = true;
      return;                       // 关闭自动刷新
    }
    S.mentionTimer = setInterval(function () {
      if (document.hidden) return;
      var onPanel = q(".panel[data-panel=mentions]").classList.contains("active");
      loadMentions({ badgeOnly: !onPanel });
    }, sec * 1000);
  }

  function loadMentions(opts) {
    opts = opts || {};
    var hours = (opts.hours || q("#mentionHours").value);
    q("#mentionList").innerHTML = '<div class="empty"><b>加载中…</b></div>';
    api("/api/mentions?hours=" + hours + "&limit=80").then(function (r) {
      var items = r.items || [];
      mentionBadge(items);
      if (opts.badgeOnly) return;          // 后台轮询只更新徽标，不打扰当前面板
      if (!items.length) {
        q("#mentionList").innerHTML = '<div class="card"><div class="empty"><b>这段时间没有 @ 你的消息</b><p>包括 @全体成员。</p></div></div>';
        return;
      }
      q("#mentionList").innerHTML = items.map(function (m) {
        var tag = m.kind === "at_all" ? '<span class="pill warn">@全体</span>' : '<span class="pill info">@我</span>';
        return '<div class="mention" data-lid="' + esc(m.lid || "") + '" data-ts="' + esc(m.ts || "") +
          '" data-conv="' + esc(m.conv_id) +
          '" data-name="' + esc(m.conv) + '" data-kind="' + esc(m.kind) + '">' +
          '<div class="mm-h">' + tag + "<b>" + esc(m.conv) + "</b><span>" + esc(m.sender) + "</span>" +
          '<span class="spacer"></span><span class="mono">' + esc((m.time || "").slice(5, 16)) + "</span></div>" +
          '<div class="mm-t">' + esc((m.text || "").slice(0, 240)) + "</div></div>";
      }).join("");
    }).catch(function (e) { toast(e.message, "danger"); });
  }
  q("#btnMentions").onclick = function () { loadMentions(); };
  q("#mentionEvery").onchange = function () {
    try { localStorage.setItem("wl_mention_every", q("#mentionEvery").value); } catch (e) {}
    startMentionTimer();
    var sel = q("#mentionEvery");
    var lbl = (sel && sel.options && sel.options[sel.selectedIndex])
      ? sel.options[sel.selectedIndex].text : (sel.value === "0" ? "关闭" : sel.value + " 秒");
    toast("自动刷新已设为 " + lbl);
  };
  try {
    var savedEvery = localStorage.getItem("wl_mention_every");
    if (savedEvery !== null) q("#mentionEvery").value = savedEvery;
  } catch (e) {}
  q("#mentionHours").onchange = loadMentions;

  q("#mentionList").addEventListener("click", function (e) {
    var d = e.target.closest(".mention"); if (!d) return;
    if (d.dataset.lid) S.mentionSeen[String(d.dataset.lid)] = true;
    var badge = q("#navMentionBadge");
    if (badge && !badge.hidden) {
      var left = Math.max(0, (parseInt(badge.textContent, 10) || 0) - 1);
      badge.hidden = left === 0; badge.textContent = String(left);
    }
    if (d.dataset.lid) {
      locateMessage(d.dataset.conv, d.dataset.lid, d.dataset.ts);
    } else {
      openDrawer(convOf(d.dataset.conv, d.dataset.name, d.dataset.kind));
    }
  });

  /* 引用回复 / 上下文 */
  function setReply(conv, lid, preview) {
    S.reply = { conv: conv, lid: lid, preview: preview || "" };
    var box = q("#replyBox");
    box.hidden = false;
    q("#replyText").textContent = (preview || "").slice(0, 60);
    show("compose");
    if (!S.selected[conv]) { S.selected[conv] = true; paintTargets(); }
  }

  q("#replyClear").onclick = function () { S.reply = null; q("#replyBox").hidden = true; };

  function showContext(conv, lid) {
    api("/api/context?conv=" + encodeURIComponent(conv) + "&lid=" + encodeURIComponent(lid) + "&n=11").then(function (r) {
      var msgs = r.messages || [];
      openModal("上下文 · " + (r.conv || ""),
        msgs.map(function (m) {
          var me = String(m.sender_account || "") === (window.WL_SELF_ACCOUNT || "self");
          return '<div class="msg" style="margin-bottom:6px">' +
            '<div class="m-h"><b>' + esc(me ? "我" : m.sender) + "</b><span>" + esc((m.time || "").slice(5, 16)) + "</span></div>" +
            '<div class="m-t">' + esc(m.display || m.text || "") + "</div></div>";
        }).join("") || "（没有上下文）", "关闭", closeModal);
    }).catch(function (e) { toast(e.message, "danger"); });
  }

  /* ---------------- 会话 ---------------- */
  function paintConvs() {
    var body = q("#convBody");
    var term = (q("#convSearch").value || "").trim().toLowerCase();
    var type = q("#convType").value;
    var auth = q("#convAuth").value;
    var rows = S.convs.filter(function (c) {
      if (term && c.name.toLowerCase().indexOf(term) < 0 && c.conv_id.indexOf(term) < 0) return false;
      if (type && c.kind !== type) return false;
      if (auth !== "" && String(c.authorized) !== auth) return false;
      return true;
    });
    S.convFiltered = rows;
    if (!S.convs.length) {
      body.innerHTML = '<tr class="tbl-empty"><td colspan="10">还没有加载会话。点上方「加载会话」。</td></tr>';
    } else if (!rows.length) {
      body.innerHTML = '<tr class="tbl-empty"><td colspan="11">没有匹配的会话。</td></tr>';
    } else {
      var paged = (window.convPaged ? window.convPaged() : rows);
      body.innerHTML = paged.map(function (c) {
        var chk = window.convSel ? (window.convSel[c.conv_id] ? " checked" : "") : "";
        return '<tr data-conv="' + esc(c.conv_id) + '" data-name="' + esc(c.name) + '" data-kind="' + esc(c.kind) + '" style="cursor:pointer">' +
          '<td><input type="checkbox" class="chk rowchk" data-cid="' + esc(c.conv_id) + '"' + chk + '></td>' +
          "<td>" + esc(c.name) + "</td>" +
          "<td>" + esc(c.kind) + "</td>" +
          '<td class="mono">' + esc(c.conv_id) + "</td>" +
          '<td class="faint">' + esc(c.last_seen || "—") + "</td>" +
          '<td><button class="btn sm' + (c.approval ? " primary" : "") + '" data-approval="' + esc(c.conv_id) +
            '" title="点击切换：发送前是否需要人工确认">' + (c.approval ? "需确认" : "免确认") + "</button></td>" +
          '<td><label class="switch" title="允许平台把文件/图片发给该会话"><input type="checkbox" data-allowfile="' + esc(c.conv_id) + '"' +
            (c.allow_file ? " checked" : "") + '><span class="track"></span></label></td>' +
          '<td><label class="switch" title="允许发表情（关掉后 AI 传来的表情也会被拦，文字照常）"><input type="checkbox" data-allowemo="' + esc(c.conv_id) + '"' +
            ((c.allow_emotion === undefined ? 1 : c.allow_emotion) ? " checked" : "") + '><span class="track"></span></label></td>' +
          '<td><select class="select sm" data-mode="' + esc(c.conv_id) + '">' +
            ["observe", "mention", "all"].map(function (m) {
              return '<option value="' + m + '"' + ((c.reply_mode || "mention") === m ? " selected" : "") + ">" +
                ({ observe: "只观察", mention: "被@才回", all: "全部回复" })[m] + "</option>";
            }).join("") + "</select></td>" +
          '<td><label class="switch" title="记录归档：' + (c.archive_count || 0) + ' 条"><input type="checkbox" data-archive="' + esc(c.conv_id) + '"' +
            (c.archived ? " checked" : "") + '><span class="track"></span></label></td>' +
          '<td><label class="switch"><input type="checkbox" data-conv="' + esc(c.conv_id) + '"' +
            (c.authorized ? " checked" : "") + (c.blocked ? " disabled" : "") + '><span class="track"></span></label>' +
            (c.blocked ? ' <span class="pill danger">禁止（平台）</span>' : "") + "</td></tr>";
      }).join("");
    }
    if (window.convSyncBar) window.convSyncBar();
    var loadedAt = S.convs.length ? (S.convs[0].loaded_at || "") : "";
    q("#convMeta").textContent = S.convs.length
      ? "上次加载 " + loadedAt + " · " + S.convs.length + " 个会话"
      : "尚未加载";
    paintTargets();
    if (window.fillGroups) window.fillGroups();
    refreshAtList();
  }

  function loadConvs() {
    var btn = q("#btnLoad");
    btn.disabled = true; btn.textContent = "加载中…";
    return loadConvs({ quiet: false }).finally(function () {
      btn.disabled = false; btn.textContent = "加载会话";
    });
  }

  // 加载会话：带上默认策略（授权/归档/回复模式），后端只对**新**会话生效
  function loadDefaults() {
    var allow = q("#defaultAuth") && q("#defaultAuth").value === "1";
    return {
      authorized: allow ? 1 : 0,
      reply_mode: allow ? "mention" : null,     // 被@才回
      archived: allow ? 1 : null                // 归档开
    };
  }

  // 重新拉会话清单并重画（加载/自动刷新/批量操作后都走这里）
  function reloadConvs() {
    return api("/api/conversations").then(function (r) {
      S.convs = (r && r.items) || [];
      if (window.convResetPage) window.convResetPage();
      paintConvs();
      return S.convs;
    });
  }

  function loadConvs(opts) {
    opts = opts || {};
    return api("/api/conversations/load", { method: "POST", body: { defaults: loadDefaults() } })
      .then(function (res) {
        if (!opts.quiet) toast("新增 " + (res.new || 0) + " 个，更新 " + (res.updated || 0) + " 个");
        else if (res.new) toast("自动刷新：新增 " + res.new + " 个会话");
        return reloadConvs();
      })
      .catch(function (e) { if (!opts.quiet) toast(e.message, "danger"); throw e; });
  }

  q("#btnLoad").onclick = loadConvs;

  // 定时刷新：按配置的间隔重新加载会话（新会话自动套用默认策略）
  (function () {
    var selEl = q("#autoRefresh");
    if (!selEl) return;
    var timer = null;
    function start(sec) {
      if (timer) { clearInterval(timer); timer = null; }
      if (sec > 0) {
        timer = setInterval(function () { loadConvs({ quiet: true }); }, sec * 1000);
      }
    }
    var saved = localStorage.getItem("autoRefresh");
    if (saved === null) saved = selEl.value || "30";
    selEl.value = saved;
    start(parseInt(saved, 10) || 0);
    selEl.addEventListener("change", function () {
      var sec = parseInt(selEl.value, 10) || 0;
      localStorage.setItem("autoRefresh", String(sec));
      start(sec);
      toast(sec ? "自动刷新：每 " + sec + " 秒" : "自动刷新已关闭");
    });
  })();
  ["#convSearch", "#convType", "#convAuth"].forEach(function (s) {
    q(s).addEventListener("input", paintConvs);
    q(s).addEventListener("change", paintConvs);
  });
  q("#convBody").addEventListener("change", function (e) {
    if (!e.target.dataset.conv) return;
    var cid = e.target.dataset.conv, val = e.target.checked;
    api("/api/conversations/" + encodeURIComponent(cid), { method: "PATCH", body: { authorized: val } })
      .then(function () {
        var c = S.convs.filter(function (x) { return x.conv_id === cid; })[0];
        if (c) c.authorized = val ? 1 : 0;
        paintConvs(); refreshStatus();
        toast((val ? "已允许发送：" : "已禁止发送：") + (c ? c.name : cid));
      })
      .catch(function (err) { e.target.checked = !val; toast(err.message, "danger"); });
  });
  q("#convBody").addEventListener("change", function (e) {
    if (e.target.dataset.allowfile) {
      var fid = e.target.dataset.allowfile, fon = e.target.checked;
      api("/api/conversations/" + encodeURIComponent(fid),
          { method: "PATCH", body: { allow_file: fon } })
        .then(function () {
          var c = S.convs.filter(function (x) { return x.conv_id === fid; })[0];
          if (c) c.allow_file = fon ? 1 : 0;
          paintConvs();
          toast(fon ? "已允许向该会话发文件" : "已禁止向该会话发文件");
        })
        .catch(function (err) { e.target.checked = !fon; toast(err.message, "danger"); });
      return;
    }
    if (e.target.dataset.allowemo) {
      var eid2 = e.target.dataset.allowemo, eon = e.target.checked;
      api("/api/conversations/" + encodeURIComponent(eid2),
          { method: "PATCH", body: { allow_emotion: eon } })
        .then(function () {
          var c2 = S.convs.filter(function (x) { return x.conv_id === eid2; })[0];
          if (c2) c2.allow_emotion = eon ? 1 : 0;
          paintConvs();
          toast(eon ? "已允许向该会话发表情" : "已关闭该会话的表情发送（文字照常）");
        })
        .catch(function (err) { e.target.checked = !eon; toast(err.message, "danger"); });
      return;
    }
    if (e.target.dataset.mode) {
      var mid = e.target.dataset.mode, mode = e.target.value;
      api("/api/conversations/" + encodeURIComponent(mid), { method: "PATCH", body: { reply_mode: mode } })
        .then(function (row) {
          var c = S.convs.filter(function (x) { return x.conv_id === mid; })[0];
          if (c) c.reply_mode = row.reply_mode;
          toast("响应模式：" + e.target.options[e.target.selectedIndex].text);
        })
        .catch(function (err) { toast(err.message, "danger"); });
      return;
    }
    if (!e.target.dataset.archive) return;
    var cid = e.target.dataset.archive, val = e.target.checked;
    api("/api/archive/" + encodeURIComponent(cid) + "/toggle", { method: "POST", body: { enabled: val } })
      .then(function () {
        var c = S.convs.filter(function (x) { return x.conv_id === cid; })[0];
        if (c) c.archived = val ? 1 : 0;
        toast((val ? "已开启归档：" : "已关闭归档：") + (c ? c.name : cid));
      })
      .catch(function (err) { e.target.checked = !val; toast(err.message, "danger"); });
  });

  function setAllArchive(on) {
    var todo = S.convs.filter(function (c) { return (!!c.archived) !== on; });
    if (!todo.length) { toast("已经是全部" + (on ? "开启" : "关闭") + "了"); return; }
    Promise.all(todo.map(function (c) {
      return api("/api/archive/" + encodeURIComponent(c.conv_id) + "/toggle",
        { method: "POST", body: { enabled: on } }).then(function () { c.archived = on ? 1 : 0; });
    })).then(function () { paintConvs(); toast("已" + (on ? "开启" : "关闭") + " " + todo.length + " 个会话的归档"); });
  }

  q("#convBody").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-approval]");
    if (btn) {                                   // 审批切换
      var pid = btn.dataset.approval;
      var c = S.convs.filter(function (x) { return x.conv_id === pid; })[0];
      var next = !(c && c.approval);
      api("/api/conversations/" + encodeURIComponent(pid), { method: "PATCH", body: { approval: next } })
        .then(function () { if (c) c.approval = next ? 1 : 0; paintConvs(); });
      return;
    }
    if (e.target.closest("input,select,label,button")) return;   // 其它控件不触发抽屉
    var tr = e.target.closest("tr[data-conv]");
    if (tr) openDrawer(convOf(tr.dataset.conv, tr.dataset.name, tr.dataset.kind));
  });


  /* ---------------- 会话抽屉：归档 / 成员 / 进出 ---------------- */
  var DR = { conv: null, tab: "chat", name: "" };

  function openDrawer(c) {
    DR.conv = c.conv_id; DR.name = c.name; DR.tab = "chat";
    q("#drawer").hidden = false; q("#drawerMask").hidden = false;
    q("#dTitle").textContent = c.name;
    qa(".drawer-tabs button[data-tab]").forEach(function (x) { x.classList.toggle("on", x.dataset.tab === DR.tab); });
    q("#dSub").textContent = c.conv_id + " · " + c.kind;
    q("#dArchive").checked = false;
    api("/api/archive/" + encodeURIComponent(c.conv_id)).then(function (st) {
      q("#dArchive").checked = !!st.enabled;
    }).catch(function () {});
    if (q("#dAllowFile")) q("#dAllowFile").checked = !!c.allow_file;
    if (q("#dAllowLink")) q("#dAllowLink").checked = !!c.allow_link;
    if (q("#dAllowEmotion")) q("#dAllowEmotion").checked = (c.allow_emotion === undefined ? true : !!c.allow_emotion);
    paintDrawer();
  }
  function closeDrawer() { q("#drawer").hidden = true; q("#drawerMask").hidden = true; }
  q("#dClose").onclick = closeDrawer;
  q("#drawerMask").onclick = closeDrawer;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  qa(".drawer-tabs button[data-tab]").forEach(function (b) {
    b.onclick = function () {
      DR.tab = b.dataset.tab;
      qa(".drawer-tabs button[data-tab]").forEach(function (x) { x.classList.toggle("on", x === b); });
      paintDrawer();
    };
  });

  function dToggle(id, field, onMsg, offMsg) {
    var box = q("#" + id);
    if (!box) return;
    box.onchange = function () {
      var on = box.checked;
      var body = {};
      body[field] = on ? 1 : 0;
      api("/api/conversations/" + encodeURIComponent(DR.conv), { method: "PATCH", body: body })
        .then(function () {
          var c = S.convs.filter(function (x) { return String(x.conv_id) === String(DR.conv); })[0];
          if (c) c[field] = on ? 1 : 0;
          paintConvs();
          toast(on ? onMsg : offMsg);
        })
        .catch(function (e) { box.checked = !on; toast(e.message, "danger"); });
    };
  }
  dToggle("dAllowFile", "allow_file", "已允许发文件", "已禁止发文件");
  dToggle("dAllowLink", "allow_link", "已允许发链接", "已禁止发链接");
  dToggle("dAllowEmotion", "allow_emotion", "已允许发表情", "已关闭表情发送（文字照常）");

  q("#dArchive").onchange = function () {
    api("/api/archive/" + encodeURIComponent(DR.conv) + "/toggle",
      { method: "POST", body: { enabled: q("#dArchive").checked } })
      .then(function () { toast(q("#dArchive").checked ? "已开启归档" : "已关闭归档"); paintDrawer(); })
      .catch(function (e) { toast(e.message, "danger"); });
  };
  q("#dBody").addEventListener("click", function (e) {
    var rl = e.target.dataset.arcRecall, dl = e.target.dataset.dl;
    var ctxLid = e.target.dataset.ctx, repLid = e.target.dataset.reply;
    if (ctxLid) { showContext(DR.conv, ctxLid); return; }
    if (repLid) {
      var row = null;
      api("/api/archive/" + encodeURIComponent(DR.conv) + "/messages?limit=80").then(function (r) {
        var mm = (r.items || []).filter(function (x) { return String(x.lid) === String(repLid); })[0];
        setReply(DR.conv, repLid, mm ? (mm.display || "") : "");
        closeDrawer();
      });
      return;
    }
    if (rl) {
      e.target.disabled = true;
      api("/api/archive/" + encodeURIComponent(DR.conv) + "/recall", { method: "POST", body: { lid: rl } })
        .then(function (r) {
          if (r.ok) { toast("已撤回"); paintDrawer(); }
          else { toast("撤回失败：" + ({"NOT_MINE": "不是自己发的", "ALREADY_RECALLED": "已经撤回过", "NOT_FOUND": "消息不在归档里"}[r.reason] || r.reason), "danger"); e.target.disabled = false; }
        })
        .catch(function (err) { toast(err.message, "danger"); e.target.disabled = false; });
    }
    if (dl) {
      e.target.disabled = true; e.target.textContent = "下载中…";
      api("/api/archive/" + encodeURIComponent(DR.conv) + "/download", { method: "POST", body: { lid: dl } })
        .then(function (r) {
          if (r.ok) { toast("已就绪：" + r.name); paintDrawer(); }
          else {
            e.target.disabled = false; e.target.textContent = "下载";
            toast(r.reason === "NOT_CACHED" ? "下载未成功：客户端没有返回文件（检查下载探针是否挂载）" : "下载失败：" + r.reason, "warn");
          }
        })
        .catch(function (err) { toast(err.message, "danger"); e.target.disabled = false; e.target.textContent = "下载"; });
    }
  });

  q("#dSync").onclick = function () {
    q("#dSync").disabled = true;
    api("/api/archive/" + encodeURIComponent(DR.conv) + "/sync", { method: "POST", body: {} })
      .then(function (r) { toast("同步完成，新增 " + r.new + " 条"); paintDrawer(); })
      .catch(function (e) { toast(e.message, "danger"); })
      .finally(function () { q("#dSync").disabled = false; });
  };

  function paintDrawer() {
    var body = q("#dBody");
    if (DR.tab === "chat") {
      if (window.loadChat) window.loadChat(DR.conv);
      return;
    }
    var tabAtReq = DR.tab;
    body.innerHTML = '<div class="empty-lite micro faint">加载中…</div>';
    if (DR.tab === "mem") {
      api("/api/groups/" + encodeURIComponent(DR.conv) + "/members").then(function (r) {
        if (DR.tab !== tabAtReq) return;          /* 用户已经切走了，别把旧结果盖上去 */
        var items = r.items || [];
        if (!items.length) { body.innerHTML = '<div class="empty"><b>还没有成员快照</b><p>在「会话与消息」里给这个群打开归档，之后每次同步会抓一次成员快照。</p></div>'; return; }
        var present = items.filter(function (m) { return m.present > 0; }).length;
        var gone = items.length - present;
        body.innerHTML = '<div class="micro faint" style="margin-bottom:6px">当前在群 <b>' + present +
          '</b> 人' + (gone ? '，另有 <b>' + gone + '</b> 人曾出现但已不在' : '') +
          '　（这是最近一次抓取的快照，不是流水）</div>' +
          '<table class="tbl"><thead><tr><th>姓名</th><th>账号</th><th>入群时间</th><th>状态</th></tr></thead><tbody>' +
          items.map(function (m) {
            return "<tr><td>" + esc(m.name) + '</td><td class="mono">' + esc(m.eng || "—") + "</td>" +
              '<td class="faint">' + esc(m.join_time || "—") + "</td><td>" +
              (m.present > 0 ? '<span class="pill ok">在群</span>'
                : '<span class="pill warn">本次未见</span>') + "</td></tr>";
          }).join("") + "</tbody></table>";
      }).catch(function (err) {
        if (DR.tab !== tabAtReq) return;
        body.innerHTML = '<div class="empty"><b>成员加载失败</b><p>' + esc(err.message) + "</p></div>";
      });
    } else {
      api("/api/groups/" + encodeURIComponent(DR.conv) + "/events").then(function (r) {
        if (DR.tab !== tabAtReq) return;
        var items = r.items || [];
        if (!items.length) { body.innerHTML = '<div class="empty"><b>还没有进出记录</b><p>进出是「变化流水」：只有确实有人入群/退群/改名才记一条。需要先开归档，且至少对比过两次快照。</p></div>'; return; }
        var KIND = { join: ["加入", "ok"], leave: ["退出", "danger"], rename: ["改名", "neutral"] };
        body.innerHTML = '<div class="micro faint" style="margin-bottom:6px">最近 <b>' + items.length +
          '</b> 条成员变化（只记入群/退群/改名，不重复记现状）</div>' + items.map(function (e) {
          var k = KIND[e.kind] || [e.kind || "变化", "neutral"];
          return '<div class="msg"><div class="m-h"><span class="pill ' + k[1] + '">' + esc(k[0]) + "</span>" +
            "<b>" + esc(zwStrip(e.name)) + "</b><span>" +
            esc((e.at || "").replace("T", " ").slice(0, 19)) + "</span></div>" +
            (e.detail ? '<div class="m-t micro faint">' + esc(e.detail) + "</div>" : "") + "</div>";
        }).join("");
      }).catch(function (err) {
        if (DR.tab !== tabAtReq) return;
        body.innerHTML = '<div class="empty"><b>进出记录加载失败</b><p>' + esc(err.message) + "</p></div>";
      });
    }
  }

  q("#convBody").addEventListener("change", function (e) {
    if (e.target.dataset.allowfile) {
      var fid = e.target.dataset.allowfile, fon = e.target.checked;
      api("/api/conversations/" + encodeURIComponent(fid),
          { method: "PATCH", body: { allow_file: fon } })
        .then(function () {
          var c = S.convs.filter(function (x) { return x.conv_id === fid; })[0];
          if (c) c.allow_file = fon ? 1 : 0;
          paintConvs();
          toast(fon ? "已允许向该会话发文件" : "已禁止向该会话发文件");
        })
        .catch(function (err) { e.target.checked = !fon; toast(err.message, "danger"); });
      return;
    }
    if (e.target.dataset.allowemo) {
      var eid2 = e.target.dataset.allowemo, eon = e.target.checked;
      api("/api/conversations/" + encodeURIComponent(eid2),
          { method: "PATCH", body: { allow_emotion: eon } })
        .then(function () {
          var c2 = S.convs.filter(function (x) { return x.conv_id === eid2; })[0];
          if (c2) c2.allow_emotion = eon ? 1 : 0;
          paintConvs();
          toast(eon ? "已允许向该会话发表情" : "已关闭该会话的表情发送（文字照常）");
        })
        .catch(function (err) { e.target.checked = !eon; toast(err.message, "danger"); });
      return;
    }
    if (e.target.dataset.mode) {
      var mid = e.target.dataset.mode, mode = e.target.value;
      api("/api/conversations/" + encodeURIComponent(mid), { method: "PATCH", body: { reply_mode: mode } })
        .then(function (row) {
          var c = S.convs.filter(function (x) { return x.conv_id === mid; })[0];
          if (c) c.reply_mode = row.reply_mode;
          toast("响应模式：" + e.target.options[e.target.selectedIndex].text);
        })
        .catch(function (err) { toast(err.message, "danger"); });
      return;
    }
    if (!e.target.dataset.archive) return;
    var cid = e.target.dataset.archive, val = e.target.checked;
    api("/api/archive/" + encodeURIComponent(cid) + "/toggle", { method: "POST", body: { enabled: val } })
      .then(function () {
        var c = S.convs.filter(function (x) { return x.conv_id === cid; })[0];
        if (c) c.archived = val ? 1 : 0;
        toast((val ? "已开启归档：" : "已关闭归档：") + (c ? c.name : cid));
      })
      .catch(function (err) { e.target.checked = !val; toast(err.message, "danger"); });
  });

  function setAllArchive(on) {
    var todo = S.convs.filter(function (c) { return (!!c.archived) !== on; });
    if (!todo.length) { toast("已经是全部" + (on ? "开启" : "关闭") + "了"); return; }
    Promise.all(todo.map(function (c) {
      return api("/api/archive/" + encodeURIComponent(c.conv_id) + "/toggle",
        { method: "POST", body: { enabled: on } }).then(function () { c.archived = on ? 1 : 0; });
    })).then(function () { paintConvs(); toast("已" + (on ? "开启" : "关闭") + " " + todo.length + " 个会话的归档"); });
  }

  q("#convBody").addEventListener("click", function (e) {
    if (e.target.closest(".switch") || e.target.dataset.approval) return;
    var tr = e.target.closest("tr"); if (!tr) return;
    var cid = tr.querySelector("input[data-conv]");
    if (!cid) return;
    var c = S.convs.filter(function (x) { return x.conv_id === cid.dataset.conv; })[0];
    if (c) openDrawer(c);
  });

  /* ---------------- 群内 @ ---------------- */
  function selectedConvIds() { return Object.keys(S.selected).filter(function (k) { return S.selected[k]; }); }
  window.selectedTargets = selectedConvIds;   /* 表情卡也要用同一份勾选 */

  function refreshAtList() {
    if (q("#kind").value !== "text") { q("#atBox").hidden = true; return; }
    var ids = selectedConvIds();
    var groups = ids.map(function (id) { return S.convs.filter(function (c) { return c.conv_id === id; })[0]; })
      .filter(function (c) { return c && c.kind === "群聊"; });
    var box = q("#atBox");
    if (!groups.length) { box.hidden = true; q("#atList").innerHTML = ""; return; }
    box.hidden = false;
    var cid = groups[0].conv_id;
    api("/api/groups/" + encodeURIComponent(cid) + "/members").then(function (r) {
      var ZERO = /[\u200b\u200c\u200d\ufeff\u00a0]/g;
      var seen = {};
      var items = [];
      (r.items || []).filter(function (m) { return m.present; }).forEach(function (m) {
        var name = String(m.name || "").replace(ZERO, "").trim();
        if (!name) return;
        var key = name;
        if (seen[key]) {                       // 同一人两条记录时优先留带账号的
          if (!seen[key].eng && m.eng) { seen[key].eng = m.eng; seen[key].uid = m.uid; }
          return;
        }
        var row = { name: name, eng: m.eng || "", uid: m.uid || "" };
        seen[key] = row; items.push(row);
      });
      items.sort(function (a, b) { return a.name.localeCompare(b.name, "zh"); });
      q("#atList").innerHTML = items.map(function (m) {
        var val = m.eng || m.uid;               // 机器人没有账号，用 uid 也能 @
        var tip = m.eng ? " (" + m.eng + ")" : " · uid";
        return '<option value="' + esc(val) + '">' + esc(m.name) + esc(tip) + "</option>";
      }).join("") || '<option value="">（成员未同步，先去会话详情打开归档）</option>';
    }).catch(function () {});
  }

  /* ---------------- 发送 ---------------- */
  function authorizedConvs() { return S.convs.filter(function (c) { return c.authorized && !c.blocked; }); }

  function paintTargets() {
    var list = q("#targetList");
    var items = authorizedConvs();
    var kw = (q("#targetSearch").value || "").trim().toLowerCase();
    if (kw) items = items.filter(function (c) {
      return (c.name || "").toLowerCase().indexOf(kw) >= 0 || String(c.conv_id).indexOf(kw) >= 0;
    });
    q("#targetEmpty").hidden = items.length > 0;
    list.hidden = items.length === 0;
    list.innerHTML = items.map(function (c) {
      var on = S.selected[c.conv_id];
      return '<li class="' + (on ? "on" : "") + '" data-conv="' + esc(c.conv_id) + '">' +
        '<input class="chk" type="checkbox"' + (on ? " checked" : "") + '>' +
        "<div><div>" + esc(c.name) + '</div><div class="t-id">' + esc(c.conv_id) + "</div></div>" +
        '<div class="t-m">' + (c.approval ? '<span class="pill warn">需确认</span>' : "") + "</div></li>";
    }).join("");
    var n = Object.keys(S.selected).filter(function (k) { return S.selected[k]; }).length;
    q("#targetCount").textContent = "已选 " + n;
    q("#batchHint").hidden = n < 2;
    if (n >= 2) q("#batchText").textContent = "本次发给 " + n + " 个会话，逐条执行、逐条回报。";
    precheck();
    refreshAtList();
  }

  if (q("#targetSearch")) q("#targetSearch").oninput = paintTargets;

  if (q("#atSearch")) q("#atSearch").oninput = function () {
    var kw = (this.value || "").trim().toLowerCase();
    qa("#atList option").forEach(function (o) {
      o.hidden = !!kw && (o.textContent || "").toLowerCase().indexOf(kw) < 0;
    });
  };

  q("#targetList").addEventListener("click", function (e) {
    var li = e.target.closest("li"); if (!li) return;
    var cid = li.dataset.conv;
    if (e.target.tagName !== "INPUT") {
      S.selected[cid] = !S.selected[cid];
    } else {
      S.selected[cid] = e.target.checked;
    }
    paintTargets();
  });

  function renderPlatform(st) {
    var box = q("#platBody");
    if (!box) return;
    var p = (st && st.platform) || {};
    if (!p.bound) { box.innerHTML = '<div class="micro faint">未同步：填写平台地址与一次性凭据后点「绑定」，会把本地策略推上去</div>'; return; }
    var ack = p.restrictions || {};
    var pc = ack.per_conv || {};
    var w = ack.window || {};
    box.innerHTML = [
      '<div class="row small"><span>工作区</span><span class="spacer"></span><b class="mono">' + esc(p.workspace || "-") + "</b></div>",
      '<div class="row small"><span>最近同步</span><span class="spacer"></span><b class="mono">' + esc((p.last_sync || "").slice(0, 19).replace("T", " ")) + "</b></div>",
      '<div class="row small"><span>平台更严项</span><span class="spacer"></span><b class="mono">' +
        esc((pc.minute || "-") + "/分 · " + (w.start || "-") + "–" + (w.end || "-")) + "</b></div>",
      '<div class="micro faint">方向是单向：本地策略推给平台留档；平台更严的规则只在平台侧执行，不回写、不覆盖本地。</div>'
    ].join("");
  }

  // 表情清单：发送测试里 kind=emotion 的下拉数据（此前缺失导致 boot 抛错，
  // 连带 loadRecent/loadLocalWindow 都没执行）
  function loadEmotions() {
    return api("/api/emotions").then(function (r) {
      S.emotions = r.items || [];
      var sel = q("#emotion");
      if (!sel) return;
      var groups = {};
      S.emotions.forEach(function (e) {
        var g = e.group || "其他";
        (groups[g] = groups[g] || []).push(e);
      });
      sel.innerHTML = Object.keys(groups).map(function (g) {
        return '<optgroup label="' + esc(g) + '">' +
          groups[g].map(function (e) {
            return '<option value="' + esc(e.id) + '">' + esc(e.name || e.id) + "</option>";
          }).join("") + "</optgroup>";
      }).join("") || '<option value="">（本机还没有表情清单）</option>';
      describeEmotion();
    }).catch(function () { S.emotions = []; });
  }

  function describeEmotion() {
    var sel = q("#emotion"), box = q("#emoMeaning"), row = q("#emoAnnoRow");
    if (!sel || !box) return;
    var it = (S.emotions || []).filter(function (x) { return x.id === sel.value; })[0];
    if (!it) { box.textContent = "—"; if (row) row.hidden = true; return; }
    var txt = it.name || it.id;
    if (it.meaning && it.meaning !== it.name) txt += " —— " + it.meaning;
    if (it.when) txt += "（" + it.when + "）";
    box.textContent = txt;
    if (row) row.hidden = it.needs_review !== true;
  }

  var emoSelEl = q("#emotion");
  if (emoSelEl) emoSelEl.onchange = describeEmotion;
  (function () {
    var rb = q("#emoRefresh");
    if (rb) rb.onclick = function () {
      rb.disabled = true; rb.textContent = "刷新中…";
      api("/api/emotions/refresh", { method: "POST", body: {} })
        .then(function (r) { toast("表情已刷新：共 " + (r.count || 0) + " 个"); return loadEmotions(); })
        .catch(function (e) { toast(e.message, "danger"); })
        .finally(function () { rb.disabled = false; rb.textContent = "刷新表情"; });
    };
    var as = q("#emoAnnoSave");
    if (as) as.onclick = function () {
      var id = q("#emotion").value;
      var meaning = (q("#emoAnno").value || "").trim();
      if (!meaning) { toast("先写含义", "warn"); return; }
      api("/api/emotions/annotate", { method: "POST", body: { id: id, meaning: meaning } })
        .then(function () { toast("已标注"); q("#emoAnno").value = ""; return loadEmotions(); })
        .catch(function (e) { toast(e.message, "danger"); });
    };
  })();

  function loadLocalWindow() {
    return api("/api/policies/local").then(function (p) {
      S.localWindow = (p && p.window) || null;
      if (S.localWindow) {
        q("#winStart").value = S.localWindow.start || "";
        q("#winEnd").value = S.localWindow.end || "";
        q("#winHint").textContent = "当前 " + S.localWindow.start + "–" + S.localWindow.end;
        precheck();
      }
    }).catch(function () {});
  }

  if (q("#btnWinSave")) q("#btnWinSave").onclick = function () {
    var start = (q("#winStart").value || "").trim(), end = (q("#winEnd").value || "").trim();
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) { toast("时间格式 HH:MM", "danger"); return; }
    api("/api/policies/local", { method: "PUT", body: { window: { start: start, end: end, weekdays: [1,2,3,4,5,6,7] } } })
      .then(function (p) {
        S.localWindow = p.window;
        q("#winHint").textContent = "当前 " + p.window.start + "–" + p.window.end;
        toast("发送时段已更新");
        precheck();
      }).catch(function (e) { toast(e.message, "danger"); });
  };

  function precheck() {
    var sel = Object.keys(S.selected).filter(function (k) { return S.selected[k]; });
    var kind = q("#kind").value;
    var text = q("#body").value || "";
    var rows = [];
    var denies = 0, confirms = 0;
    function row(cls, t, d) {
      rows.push('<li class="' + cls + '"><div><div class="small">' + t + '</div><div class="micro faint">' + d + "</div></div></li>");
    }
    if (!sel.length) { row("", "未选择目标", "先勾选至少一个已授权会话"); denies++; }
    if (kind === "text" && !text.trim()) { row("", "内容为空", "文本不能为空"); denies++; }
    if (kind === "text" && text.length > 1000) { row("", "正文超上限", "上限 1000 字"); denies++; }
    if (kind === "file" && !S.filePath) { row("", "未选择文件", "先选一个文件"); denies++; }
    if (S.status && S.status.paused) { row("", "节点已总暂停", "恢复后才可派发"); denies++; }
    sel.forEach(function (cid) {
      var c = S.convs.filter(function (x) { return x.conv_id === cid; })[0];
      if (c && c.approval) confirms++;
    });
    if (sel.length && !denies) {
      var w = S.localWindow;
      row("", "策略与时段检查",
        w ? ("本地发送时段 " + w.start + "–" + w.end + "（平台限制只约束平台下发的命令）")
          : "提交后由服务端复核额度、时段与内容");
    }
    q("#precheck").innerHTML = rows.join("");
    var sum = q("#preSummary");
    if (denies) { sum.className = "pill danger"; sum.textContent = denies + " 阻断"; }
    else if (confirms) { sum.className = "pill warn"; sum.textContent = confirms + " 需确认"; }
    else { sum.className = "pill ok"; sum.textContent = "可提交"; }
    q("#btnSubmit").disabled = denies > 0;
  }

  q("#body").addEventListener("input", function () {
    q("#bodyCount").textContent = (q("#body").value.length) + " / 1000";
    precheck();
  });
  q("#kind").addEventListener("change", function () {
    var k = q("#kind").value;
    refreshAtList();
    q("#kindText").hidden = k !== "text";
    q("#kindEmotion").hidden = k !== "emotion";
    q("#kindFile").hidden = k !== "file";
    precheck();
  });
  q("#fileInput").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result).split(",")[1];
      api("/api/upload", { method: "POST", body: { name: f.name, b64: b64 } })
        .then(function (r) {
          S.filePath = r.path;
          q("#fileHint").textContent = "已固定：" + r.path + "（" + f.size + " 字节）";
          precheck();
        })
        .catch(function (err) { toast(err.message, "danger"); });
    };
    rd.readAsDataURL(f);
  });

  function pollCmd(id) {
    return api("/api/commands/" + encodeURIComponent(id)).then(function (c) {
      updateResult(c);
      if (c.state === "WAITING_APPROVAL") return c;
      if (["SUCCEEDED", "FAILED", "UNKNOWN", "REJECTED", "CANCELLED", "EXPIRED"].indexOf(c.state) < 0) {
        return new Promise(function (res) { setTimeout(res, 900); }).then(function () { return pollCmd(id); });
      }
      return c;
    });
  }

  function updateResult(c) {
    var tr = document.getElementById("row-" + c.cmd_id);
    if (!tr) {
      tr = document.createElement("tr");
      tr.id = "row-" + c.cmd_id;
      q("#resultBody").appendChild(tr);
      var empty = q("#resultBody .tbl-empty");
      if (empty) empty.remove();
    }
    var cls = c.state === "SUCCEEDED" ? "ok" : c.state === "UNKNOWN" ? "danger" :
      c.state === "FAILED" || c.state === "REJECTED" ? "danger" : "info";
    var act = "";
    if (c.state === "SUCCEEDED") {
      act = c.recalled ? '<span class="micro faint">已撤回</span>'
        : '<button class="btn sm" data-recall="' + esc(c.cmd_id) + '">撤回</button>';
    } else if (c.state === "WAITING_WINDOW") {
      act = '<button class="btn sm primary" data-release="' + esc(c.cmd_id) + '">放行</button> ' +
        '<button class="btn sm ghost" data-cancel="' + esc(c.cmd_id) + '">取消</button>';
    } else if (c.state === "WAITING_APPROVAL") {
      act = '<button class="btn sm primary" data-approve="' + esc(c.cmd_id) + '">批准</button> ' +
        '<button class="btn sm ghost" data-reject="' + esc(c.cmd_id) + '">拒绝</button>';
    } else if (c.state === "QUEUED") {
      act = '<button class="btn sm ghost" data-cancel="' + esc(c.cmd_id) + '">取消待发</button>';
    } else if (c.state === "UNKNOWN") {
      act = '<span class="micro faint">仅对账</span>';
    }
    tr.innerHTML = '<td class="mono faint">' + esc((c.created_at || "").slice(11, 16)) + "</td>" +
      "<td>" + esc(c.conv_name || c.conv_id) + "</td>" +
      "<td>" + esc(c.kind) + "</td>" +
      '<td><span class="pill ' + cls + '">' + esc(c.state) + "</span>" +
        receiptPill(c) +
        ((c.reason_hint || c.reason)
          ? '<div class="micro faint" title="' + esc(c.reason || "") + '">' +
            esc(String(c.reason_hint || c.reason).slice(0, 24)) + "</div>" : "") + "</td>" +
      '<td class="mono micro faint">' + esc(c.lid || c.evidence || "—") + "</td>" +
      '<td class="right">' + act + "</td>";
  }


  // 真实回执：发送返回成功 ≠ 已送达，回读会话确认后才算 VERIFIED
  function receiptPill(c) {
    if (c.state !== "SUCCEEDED") return "";
    var st = c.receipt_state || "";
    if (st === "VERIFIED") return '<div class="micro"><span class="pill ok">已送达</span></div>';
    if (st === "UNKNOWN") {
      return '<div class="micro"><span class="pill warn">待确认</span>' +
        '<span class="micro faint" title="' + esc(c.receipt_note || "") + '"> ' +
        esc(String(c.receipt_note || "").slice(0, 14)) + "</span></div>";
    }
    return "";
  }

  q("#btnSubmit").onclick = function () {
    var sel = Object.keys(S.selected).filter(function (k) { return S.selected[k]; });
    var kind = q("#kind").value;
    var one = function (cid) {
      var body = { conv_id: cid, kind: kind, idem: cid + ":" + kind + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 7) };
      if (kind === "text") {
        body.text = q("#body").value;
        var at = qa("#atList option").filter(function (o) { return o.selected && o.value; }).map(function (o) { return o.value; });
        if (at.length) body.at = at;
        if (S.reply && String(S.reply.conv) === String(cid)) body.reply_to = S.reply.lid;
      }
      if (kind === "emotion") body.emotion = q("#emotion").value;
      if (kind === "file") body.file_path = S.filePath;
      return api("/api/commands", { method: "POST", body: body })
        .then(function (c) { updateResult(c); return pollCmd(c.cmd_id); })
        .catch(function (e) { toast(e.message, "danger"); });
    };
    q("#btnSubmit").disabled = true;
    Promise.all(sel.map(one)).then(function () { refreshStatus(); precheck(); toast("已提交并执行完成"); });
  };

  q("#resultBody").addEventListener("click", function (e) {
    var rid = e.target.dataset.recall, cid = e.target.dataset.cancel;
    var ap = e.target.dataset.approve, rj = e.target.dataset.reject, rl = e.target.dataset.release;
    if (rl) {
      api("/api/commands/" + encodeURIComponent(rl) + "/release", { method: "POST", body: {} })
        .then(function (c) { updateResult(c); pollCmd(c.cmd_id); toast("已放行，进入队列"); })
        .catch(function (err) { toast(err.message, "danger"); });
      return;
    }
    if (ap) {
      api("/api/commands/" + encodeURIComponent(ap) + "/approve", { method: "POST", body: {} })
        .then(function (c) { updateResult(c); pollCmd(c.cmd_id); toast("已批准，继续执行"); })
        .catch(function (err) { toast(err.message, "danger"); });
      return;
    }
    if (rj) {
      api("/api/commands/" + encodeURIComponent(rj) + "/reject", { method: "POST", body: {} })
        .then(function (c) { updateResult(c); toast("已拒绝", "warn"); })
        .catch(function (err) { toast(err.message, "danger"); });
      return;
    }
    if (rid) {
      api("/api/commands/" + encodeURIComponent(rid) + "/recall", { method: "POST", body: {} })
        .then(function (c) {
          updateResult(c);
          toast(c.recalled ? "已撤回" : "撤回失败：" + ((c.recall && c.recall.reason) || ""), c.recalled ? "" : "danger");
        })
        .catch(function (err) { toast(err.message, "danger"); });
    }
    if (cid) {
      api("/api/commands/" + encodeURIComponent(cid) + "/cancel", { method: "POST", body: {} })
        .then(function (c) { updateResult(c); toast("已取消待发"); })
        .catch(function (err) { toast(err.message, "danger"); });
    }
  });
  q("#btnClear").onclick = function () {
    q("#resultBody").innerHTML = '<tr class="tbl-empty"><td colspan="6">还没有本次发送记录。</td></tr>';
  };

  /* ---------------- 频率 ---------------- */
  function paintPolicy() {
    var p = S.policy; if (!p) return;
    var loc = p.local, eff = p.effective, plat = (p.platform && p.platform.restrictions) || {};
    var rows = [
      ["单会话 · 每分钟", loc.per_conv.minute, (plat.per_conv || {}).minute, eff.per_conv.minute, "per_conv.minute"],
      ["单会话 · 每小时", loc.per_conv.hour, (plat.per_conv || {}).hour, eff.per_conv.hour, "per_conv.hour"],
      ["单会话 · 每天", loc.per_conv.day, (plat.per_conv || {}).day, eff.per_conv.day, "per_conv.day"],
      ["账号合计 · 每分钟", loc.account.minute, (plat.account || {}).minute, eff.account.minute, "account.minute"],
      ["队列深度", loc.queue_max, plat.queue_max, eff.queue_max, "queue_max"],
      ["命令有效期（秒）", loc.expire_seconds, plat.expire_seconds, eff.expire_seconds, "expire_seconds"]
    ];
    q("#limTable tbody").innerHTML = rows.map(function (r) {
      return "<tr><td>" + r[0] + "</td>" +
        '<td><input class="input sm" type="number" data-key="' + r[4] + '" value="' + r[1] + '"></td>' +
        '<td class="mono">' + (r[2] == null ? "—" : r[2]) + "</td>" +
        '<td class="mono">' + r[3] + "</td></tr>";
    }).join("");
    q("#winStart").value = loc.window.start;
    q("#winEnd").value = loc.window.end;
    q("#denyWords").value = (loc.deny_keywords || []).join(",");
    q("#queueMax").value = loc.queue_max;
    q("#expireSec").value = loc.expire_seconds;
    q("#maxChars").value = loc.max_chars;
    q("#policyPill").textContent = "本地 v" + loc.version + (p.platform.bound ? " · 平台 v" + p.platform.version : "");
  }

  function loadPolicy() {
    return api("/api/policies/effective").then(function (p) { S.policy = p; paintPolicy(); });
  }

  q("#btnSavePolicy").onclick = function () {
    var patch = { per_conv: {}, account: {} };
    qa("#limTable input[data-key]").forEach(function (inp) {
      var v = parseInt(inp.value, 10);
      var k = inp.dataset.key;
      if (k.indexOf(".") > 0) {
        var parts = k.split(".");
        patch[parts[0]][parts[1]] = v;
      } else {
        patch[k] = v;
      }
    });
    patch.window = { start: q("#winStart").value, end: q("#winEnd").value, weekdays: [1, 2, 3, 4, 5] };
    patch.deny_keywords = q("#denyWords").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    patch.max_chars = parseInt(q("#maxChars").value, 10) || 1000;
    api("/api/policies/local", { method: "PUT", body: patch })
      .then(function () { toast("已保存为本地策略 v" + (S.policy.local.version + 1)); return Promise.all([loadPolicy(), refreshStatus()]); })
      .catch(function (e) { toast(e.message, "danger"); });
  };
  /* ---------------- 平台 ---------------- */
  function loadPlatformConfig() {
    return api("/api/platform/config").then(function (c) {
      S.gwCfg = c;
      if (q("#gwUrl")) q("#gwUrl").value = c.gateway_url || "";
      if (q("#gwWs")) q("#gwWs").value = c.workspace_id || "";
      if (q("#gwNode")) q("#gwNode").value = c.node_id || "";
      if (q("#gwCurUrl")) q("#gwCurUrl").textContent = c.gateway_url || "—";
      if (q("#gwCurSeen")) q("#gwCurSeen").textContent = c.gateway_seen || "—";
      if (q("#gwCurNode")) q("#gwCurNode").textContent = c.gateway_node || c.node_id || "—";
      if (q("#brandName") && !q("#brandName").value) {
        var b = (S.status && S.status.brand) || S.brand || {};
        q("#brandName").value = b.name || "企微助手";
        q("#brandLogo").value = b.logo || "安";
        q("#brandSub").value = b.subtitle || "本地工作台";
        var acc = (S.status && S.status.account) || {};
        if (acc.id) {
          q("#acctHint").textContent = "当前账号 " + acc.id +
            (acc.user_id ? (" · UID " + acc.user_id) : "") +
            "（" + (acc.source === "auto" ? "自动识别" : "配置") + "）";
        }
      }
      var st = q("#gwCurState");
      if (st) {
        st.textContent = c.gateway_connected ? "已连接" : "未连接";
        st.className = "pill " + (c.gateway_connected ? "ok" : "warn");
      }
      var pil = q("#pltState");
      if (pil) {
        pil.textContent = c.gateway_connected ? "通道在线" : "通道离线";
        pil.className = "pill " + (c.gateway_connected ? "ok" : "warn");
      }
      return c;
    }).catch(function () {});
  }

  q("#btnGwTest").onclick = function () {
    var url = (q("#gwUrl").value || "").trim();
    var box = q("#gwTestResult");
    if (!url) { box.className = ""; box.textContent = "请先填写通道地址"; return; }
    box.className = ""; box.textContent = "测试中…";
    api("/api/platform/test", { method: "POST",
        body: { url: url, token: (q("#gwToken").value || "").trim() } })
      .then(function (r) {
        box.className = r.ok ? "ok" : "bad";
        box.textContent = (r.ok ? "✓ " : "✗ ") + (r.message || "");
      })
      .catch(function (e) { box.className = "bad"; box.textContent = "✗ " + e.message; });
  };

  q("#btnGwSave").onclick = function () {
    var url = (q("#gwUrl").value || "").trim();
    if (!url) { toast("请先填写通道地址", "danger"); return; }
    api("/api/platform/config", { method: "PUT", body: {
        url: url, workspace_id: (q("#gwWs").value || "").trim(),
        token: (q("#gwToken").value || "").trim() } })
      .then(function () {
        q("#gwToken").value = "";
        toast("已保存；重启客户端服务后按新地址连接");
        return Promise.all([loadPlatformConfig(), refreshStatus()]);
      })
      .catch(function (e) { toast(e.message, "danger"); });
  };

  function uploadBrand(kind, file, done) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("图片不能超过 2MB", "danger"); return; }
    var fr = new FileReader();
    fr.onload = function () {
      api("/api/brand/upload", { method: "POST",
          body: { kind: kind, name: file.name, data_b64: String(fr.result) } })
        .then(function (r) {
          S.brand = S.brand || {};
          S.brand[kind + "_url"] = r.url;
          applyBrand(S.brand);
          toast(kind === "logo" ? "Logo 已更新" : "浏览器图标已更新");
          if (done) done();
        })
        .catch(function (e) { toast("上传失败：" + e.message, "danger"); });
    };
    fr.readAsDataURL(file);
  }

  q("#logoFile") && (q("#logoFile").onchange = function (e) { uploadBrand("logo", e.target.files[0]); });
  q("#favFile") && (q("#favFile").onchange = function (e) { uploadBrand("favicon", e.target.files[0]); });
  q("#logoClear") && (q("#logoClear").onclick = function () {
    api("/api/brand", { method: "PUT", body: { logo_url: "" } }).then(function (b) {
      S.brand = b; applyBrand(b); toast("已删除 Logo 图片");
    });
  });
  q("#favClear") && (q("#favClear").onclick = function () {
    api("/api/brand", { method: "PUT", body: { favicon_url: "" } }).then(function (b) {
      S.brand = b; applyBrand(b); toast("已删除浏览器图标");
    });
  });
  q("#siteLogoText") && (q("#siteLogoText").oninput = paintSitePreview);
  q("#btnSiteSave") && (q("#btnSiteSave").onclick = function () {
    api("/api/brand", { method: "PUT", body: {
        name: q("#siteName").value, subtitle: q("#siteSub").value,
        logo: q("#siteLogoText").value } })
      .then(function (b) { S.brand = b; applyBrand(b); toast("已保存"); refreshStatus(); })
      .catch(function (e) { toast(e.message, "danger"); });
  });
  q("#btnSiteReset") && (q("#btnSiteReset").onclick = function () {
    api("/api/brand", { method: "PUT", body: {
        name: "企微助手", subtitle: "本地工作台", logo: "安", logo_url: "", favicon_url: "" } })
      .then(function (b) {
        S.brand = b; q("#siteName").value = b.name; q("#siteSub").value = b.subtitle;
        q("#siteLogoText").value = b.logo; applyBrand(b); toast("已恢复默认");
      });
  });

  q("#btnAccountRefresh").onclick = function () {
    q("#acctHint").textContent = "识别中…";
    api("/api/account/refresh", { method: "POST", body: {} })
      .then(function (acc) {
        q("#acctHint").textContent = acc.user_id
          ? ("当前账号 " + acc.id + " · UID " + acc.user_id + "（" +
             (acc.source === "auto" ? "自动识别" : "配置") + "）")
          : "没识别到，检查客户端是否登录";
        refreshStatus();
      })
      .catch(function (e) { q("#acctHint").textContent = "识别失败：" + e.message; });
  };




  /* ---------------- 接入令牌 ---------------- */
  function loadNodeToken() {
    api("/api/platform/node-token").then(function (d) {
      var hint = q("#tkHint");
      if (hint) hint.textContent = d.set ? ("已设置 · 尾号 " + d.tail) : "未设置";
      var inp = q("#nodeToken");
      if (inp) inp.value = d.set ? (d.masked || "************") : "";
      var btn = q("#btnSaveToken");
      if (btn) btn.textContent = d.set ? "替换令牌" : "保存令牌";
    }).catch(function () {});
  }

  if (q("#btnSaveToken")) q("#btnSaveToken").onclick = function () {
    var v = (q("#nodeToken").value || "").trim();
    if (!v || v.indexOf("*") >= 0) { toast("请输入新令牌（脱敏值不会保存）", "warn"); return; }
    api("/api/platform/node-token", { method: "POST", body: { token: v } })
      .then(function (d) { toast("已保存 · 尾号 " + d.tail, "ok"); loadNodeToken(); })
      .catch(function (e) { toast("保存失败：" + e.message, "danger"); });
  };

  if (q("#btnClearToken")) q("#btnClearToken").onclick = function () {
    openModal("清除接入令牌",
      "<div class='small'>清除后这台客户端无法再被平台登记，需要重新填令牌。</div>",
      "确认清除", function () {
        closeModal();
        api("/api/platform/node-token", { method: "POST", body: { token: "" } })
          .then(function () { toast("已清除", "warn"); loadNodeToken(); });
      });
  };

  if (q("#btnDelGateway")) q("#btnDelGateway").onclick = function () {
    openModal("删除当前平台连接",
      "<div class='small'>会清掉本机的通道地址与通道令牌；平台侧节点记录不受影响。</div>",
      "确认删除", function () {
        closeModal();
        api("/api/platform/gateway/delete", { method: "POST", body: {} })
          .then(function () { toast("已删除连接配置", "warn"); refreshStatus(); });
      });
  };

  loadNodeToken();

  /* ---------------- 其它 ---------------- */
  q("#btnPause").onclick = function () {
    var next = !(S.status && S.status.paused);
    api("/api/control/pause", { method: "POST", body: { paused: next } })
      .then(function () { toast(next ? "已总暂停" : "已恢复", next ? "warn" : ""); return refreshStatus(); })
      .then(precheck);
  };

  /* ================= 记录中心：发送记录 / 收到消息，筛选 + 翻页 + 下钻 ================= */
  var REC = { src: "cmd", page: 1, size: 50, total: 0,
              q: "", state: "", kind: "", from: "", to: "", cat: "", dir: "in",
              convId: "", sender: "", label: "", files: false };
  S.cmdSel = S.cmdSel || {};
  S.cmdRows = S.cmdRows || [];

  function recFilters() {
    var p = ["limit=" + REC.size, "offset=" + ((REC.page - 1) * REC.size)];
    if (REC.q) p.push("q=" + encodeURIComponent(REC.q));
    if (REC.from) p.push("from=" + REC.from);
    if (REC.to) p.push("to=" + REC.to);
    if (REC.src === "cmd") {
      if (REC.state) p.push("state=" + encodeURIComponent(REC.state));
      if (REC.kind) p.push("kind=" + REC.kind);
      if (REC.convId) p.push("conv_id=" + encodeURIComponent(REC.convId));
    } else {
      if (REC.convId) p.push("conv_id=" + encodeURIComponent(REC.convId));
      if (REC.sender) p.push("sender=" + encodeURIComponent(REC.sender));
      if (REC.cat) p.push("cat=" + encodeURIComponent(REC.cat));
      if (REC.dir) p.push("dir=" + encodeURIComponent(REC.dir));
    }
    return p.join("&");
  }

  function setRecSource(src) {
    REC.src = src; REC.page = 1; REC.files = false;
    if (q("#recFilesBtn")) q("#recFilesBtn").textContent = "附件清单";
    qa("#recTabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.src === src); });
    q("#recTitle").textContent = src === "cmd" ? "发送记录" : "收到消息";
    // 收到消息没有状态/类型语义，隐藏对应控件
    q("#recState").style.display = src === "cmd" ? "" : "none";
    q("#recKind").style.display = src === "cmd" ? "" : "none";
    q("#recCat").style.display = src === "cmd" ? "none" : "";
    q("#btnBatchRecall").style.display = src === "cmd" ? "" : "none";
    q("#selCount").style.display = src === "cmd" ? "" : "none";
    loadRecords();
  }

  function loadRecords() {
    var fileQuery = recFilters().replace(/(^|&)cat=[^&]*/g, "").replace(/^&/, "");
    if (REC.files && (REC.cat === "image" || REC.cat === "file")) {
      fileQuery = fileQuery.replace(/(^|&)kind=[^&]*/g, "").replace(/^&/, "") + "&kind=" + REC.cat;
    }
    var url = REC.files
      ? ("/api/archive/attachments?" + fileQuery)
      : (REC.src === "cmd" ? "/api/commands?" : "/api/archive/records?") + recFilters();
    return api(url).then(function (r) {
      REC.total = r.total || 0;
      paintRecords(r.items || []);
    }).catch(function (e) {
      q("#recBody").innerHTML = '<tr class="tbl-empty"><td colspan="7">加载失败：' + esc(e.message) + "</td></tr>";
    });
  }

  function paintRecords(items) {
    var head = q("#recHead"), body = q("#recBody");
    if (REC.src === "cmd") {
      S.cmdRows = items;
      head.innerHTML = "<tr><th style='width:28px'><input type='checkbox' id='ckAll' class='chk'></th>" +
        "<th>时间</th><th>目标</th><th>类型</th><th>内容</th><th>状态</th><th class='right'>操作</th></tr>";
      if (!items.length) {
        body.innerHTML = '<tr class="tbl-empty"><td colspan="7">没有符合条件的发送记录</td></tr>';
      } else {
        body.innerHTML = items.map(function (c) {
          var cls = c.state === "SUCCEEDED" ? "ok" :
            (c.state === "UNKNOWN" || c.state === "FAILED" || c.state === "REJECTED" || c.state === "CANCELLED") ? "danger" :
            (c.state === "WAITING_WINDOW" || c.state === "WAITING_APPROVAL") ? "warn" : "info";
          var canRecall = c.state === "SUCCEEDED" && !c.recalled;
          return '<tr data-cmd="' + esc(c.cmd_id) + '">' +
            '<td><input type="checkbox" class="chk rowck" data-id="' + esc(c.cmd_id) + '"' +
              (canRecall ? (S.cmdSel[c.cmd_id] ? " checked" : "") : " disabled") + "></td>" +
            '<td class="mono faint">' + esc((c.created_at || "").replace("T", " ").slice(5, 19)) + "</td>" +
            "<td>" + esc(c.conv_name || c.conv_id) + "</td>" +
            "<td>" + esc(c.kind) + "</td>" +
            '<td><span class="trunc" style="max-width:300px">' + esc(c.preview || "—") + "</span></td>" +
            '<td><span class="pill ' + cls + '">' + esc(c.state) + "</span>" +
              (c.recalled ? ' <span class="pill warn">已撤回</span>' : "") + "</td>" +
            '<td class="right">' + cmdActions(c) + "</td></tr>";
        }).join("");
      }
      var live = {};
      items.forEach(function (c) {
        if (c.state === "SUCCEEDED" && !c.recalled && S.cmdSel[c.cmd_id]) live[c.cmd_id] = true;
      });
      S.cmdSel = live;
      var ckAll = q("#ckAll");
      if (ckAll) ckAll.onchange = function (e) {
        items.forEach(function (c) {
          if (c.state === "SUCCEEDED" && !c.recalled) S.cmdSel[c.cmd_id] = e.target.checked;
        });
        paintRecords(items); syncBatch();
      };
    } else if (REC.files) {
      // 附件清单视图：只看图片/文件，可直接查看、下载、定位
      head.innerHTML = "<tr><th>时间</th><th>会话</th><th>方向</th><th>类型</th><th>文件名</th>" +
        "<th class='right'>大小</th><th class='right'>操作</th></tr>";
      if (!items.length) {
        body.innerHTML = '<tr class="tbl-empty"><td colspan="7">这段时间没有符合条件的附件</td></tr>';
      } else {
        body.innerHTML = items.map(function (m) {
          var md = m.media || {};
          var isImg = md.kind === "image";
          var name = md.name || (isImg ? "图片" : "文件");
          var size = md.size ? fmtSize(md.size) : "—";
          return '<tr data-conv="' + esc(m.conv_id) + '" data-lid="' + esc(m.lid) + '">' +
            '<td class="mono faint">' + esc((m.msg_time || "").slice(5, 16)) + "</td>" +
            "<td>" + esc(m.conv || m.conv_id) + "</td>" +
            "<td>" + (m.mine ? '<span class="chip">发出</span>' : '<span class="chip ok">收到</span>') + "</td>" +
            "<td>" + (isImg ? '<span class="chip">图片</span>' : '<span class="chip">文件</span>') + "</td>" +
            '<td><span class="trunc" style="max-width:300px">' + esc(name) + "</span></td>" +
            '<td class="right mono faint">' + size + "</td>" +
            '<td class="right">' +
              '<button class="btn sm ghost" data-preview="' + esc(md.url || "") + '" data-kind="' + esc(md.kind || "") +
                '" data-name="' + esc(name) + '">查看</button> ' +
              '<a class="btn sm ghost" href="' + esc(md.url || "#") + '" download="' + esc(name) + '">下载</a> ' +
              '<button class="btn sm ghost" data-locate="' + esc(m.lid) + '" data-conv="' + esc(m.conv_id) + '">定位</button>' +
            "</td></tr>";
        }).join("");
      }
    } else {
      head.innerHTML = "<tr><th>时间</th><th>会话</th><th>分类</th><th>发送者</th><th>内容</th><th class='right'>操作</th></tr>";
      if (!items.length) {
        body.innerHTML = '<tr class="tbl-empty"><td colspan="6">没有符合条件的收到消息</td></tr>';
      } else {
        body.innerHTML = items.map(function (m) {
          var md = m.media || {};
          var kind = md.kind;
          var cat = m.cat || (kind === "image" ? "image" : kind === "file" ? "file" : "text");
          var chip = cat === "image" ? '<span class="chip">图片</span>' :
                     cat === "file" ? '<span class="chip">文件</span>' :
                     cat === "emotion" ? '<span class="chip">表情</span>' :
                     cat === "text" ? '<span class="chip ok">消息</span>' :
                     '<span class="chip">其他</span>';
          var txt = (m.display || m.caption || "").replace(/\s+/g, " ").slice(0, 90);
          if (!txt && md.name) txt = md.name;
          if (!txt) txt = emptyLabel(m);
          if (cat === "recalled") txt = "该消息已撤回";
          var open = md.url
            ? '<button class="btn sm ghost" data-preview="' + esc(md.url) + '" data-kind="' + esc(md.kind || "") +
              '" data-name="' + esc(md.name || "") + '">查看</button> '
            : "";
          return '<tr data-conv="' + esc(m.conv_id) + '" data-lid="' + esc(m.lid) + '">' +
            '<td class="mono faint">' + esc((m.msg_time || "").slice(5, 16)) + "</td>" +
            "<td>" + esc(m.conv || m.conv_id) + "</td>" +
            "<td>" + chip + "</td>" +
            "<td>" + esc(m.sender || "—") + "</td>" +
            '<td><span class="trunc" style="max-width:330px">' + esc(txt) + "</span></td>" +
            '<td class="right">' + open +
              '<button class="btn sm ghost" data-locate="' + esc(m.lid) +
              '" data-conv="' + esc(m.conv_id) + '">定位</button></td></tr>';
        }).join("");
      }
    }
    var pages = Math.max(1, Math.ceil(REC.total / REC.size));
    q("#recInfo").textContent = "共 " + REC.total + " 条 · 第 " + REC.page + "/" + pages + " 页";
    q("#recPage").textContent = REC.page + " / " + pages;
    q("#recPrev").disabled = REC.page <= 1;
    q("#recNext").disabled = REC.page >= pages;
    if (REC.src === "cmd") syncBatch();
  }

  function emptyLabel(m) {
    var kind = (m.media || {}).kind;
    if (kind === "voice") return "[语音]";
    if (kind === "video") return "[视频]";
    if (kind === "card") return "[链接卡片]";
    if (kind === "emotion") return "[表情]";
    if (kind === "image") return "[图片]";
    if (kind === "file") return "[文件]";
    if (m.cat === "recalled" || m.recalled) return "该消息已撤回";
    if (m.ctype === 2) return "[无正文]";
    return "[" + (m.cat || "消息") + "]";
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }

  function previewMedia(url, kind, name) {
    if (!url) return;
    var body = kind === "image"
      ? '<img src="' + esc(url) + '" alt="' + esc(name) + '" style="max-width:100%;border-radius:10px">'
      : '<div class="small">' + esc(name || "文件") + '</div>' +
        '<div class="micro faint" style="margin-top:6px">点击「下载」保存到本机后查看</div>' +
        '<div class="row" style="margin-top:10px"><a class="btn primary" href="' + esc(url) +
        '" download="' + esc(name || "file") + '">下载</a></div>';
    openModal(name || "附件预览", body, "关闭", function () { closeModal(); });
  }

  function loadAttachments() {
    REC.files = true;
    if (q("#recDir")) REC.dir = q("#recDir").value || "in";
    if (q("#recFilesBtn")) q("#recFilesBtn").textContent = "返回消息列表";
    REC.src = "msg";
    q("#recTitle").textContent = "附件清单";
    qa("#recTabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.src === "msg"); });
    q("#recState").style.display = "none";
    q("#recKind").style.display = "none";
    q("#recCat").style.display = "";
    q("#btnBatchRecall").style.display = "none";
    q("#selCount").style.display = "none";
    loadRecords();
  }

  function cmdActions(c) {
    var st = c.state, b = [];
    if (st === "SUCCEEDED" && !c.recalled) {
      b.push('<button class="btn sm ghost" data-id="' + esc(c.cmd_id) + '" data-act="recall">撤回</button>');
    } else if (st === "WAITING_APPROVAL") {
      b.push('<button class="btn sm" data-id="' + esc(c.cmd_id) + '" data-act="approve">批准</button>');
      b.push('<button class="btn sm ghost" data-id="' + esc(c.cmd_id) + '" data-act="reject">驳回</button>');
    } else if (st === "WAITING_WINDOW") {
      b.push('<button class="btn sm" data-id="' + esc(c.cmd_id) + '" data-act="release">放行</button>');
    } else if (st === "QUEUED" || st === "RECEIVED") {
      b.push('<button class="btn sm ghost" data-id="' + esc(c.cmd_id) + '" data-act="cancel">取消</button>');
    }
    return b.join(" ") || '<span class="micro faint">—</span>';
  }

  function selectedRows() {
    return Object.keys(S.cmdSel).filter(function (k) { return S.cmdSel[k]; });
  }
  function syncBatch() {
    var ids = selectedRows();
    var btn = q("#btnBatchRecall");
    if (btn) btn.disabled = ids.length === 0;
    var cnt = q("#selCount");
    if (cnt) cnt.textContent = ids.length ? ("已选 " + ids.length) : "";
  }

  /* 下钻：把记录区切到对应数据源并套用筛选 */
  function drill(opts) {
    REC.page = 1;
    if (opts.src) setRecSource(opts.src);
    else {
      REC.state = opts.state || ""; REC.kind = opts.kind || "";
      REC.from = opts.from || ""; REC.to = opts.to || "";
      REC.convId = opts.convId || ""; REC.q = opts.q || "";
      q("#recState").value = REC.state; q("#recKind").value = REC.kind;
      q("#recFrom").value = REC.from; q("#recTo").value = REC.to; q("#recQ").value = REC.q;
      loadRecords();
    }
    var card = q("#recCard");
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToRec() {
    var card = q("#recCard");
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ------- 绑定 UI ------- */
  q("#recTabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-src]");
    if (b) setRecSource(b.dataset.src);
  });
  q("#recDir").onchange = function () {
    REC.dir = q("#recDir").value || "in";
    REC.page = 1;
    loadRecords();
  };
  q("#recCat").onchange = function () {
    REC.cat = q("#recCat").value || "";
    REC.page = 1;
    loadRecords();
  };
  q("#recFilesBtn").onclick = function () {
    if (REC.files) { setRecSource("msg"); return; }
    loadAttachments();
  };
  q("#recApply").onclick = function () {
    REC.page = 1;
    REC.q = (q("#recQ").value || "").trim();
    REC.cat = q("#recCat").value || "";
    REC.state = q("#recState").value || "";
    REC.kind = q("#recKind").value || "";
    REC.from = q("#recFrom").value || "";
    REC.to = q("#recTo").value || "";
    loadRecords();
  };
  q("#recReset").onclick = function () {
    REC.page = 1; REC.q = REC.state = REC.kind = REC.from = REC.to = "";
    REC.convId = ""; REC.sender = ""; REC.cat = ""; REC.files = false;
    REC.dir = "in"; q("#recCat").value = ""; q("#recDir").value = "in";
    q("#recQ").value = ""; q("#recState").value = ""; q("#recKind").value = "";
    q("#recFrom").value = ""; q("#recTo").value = "";
    loadRecords();
  };
  q("#recQ").addEventListener("keydown", function (e) { if (e.key === "Enter") q("#recApply").onclick(); });
  q("#recSize").onchange = function () { REC.size = parseInt(q("#recSize").value, 10) || 50; REC.page = 1; loadRecords(); };
  q("#recPrev").onclick = function () { if (REC.page > 1) { REC.page--; loadRecords(); } };
  q("#recNext").onclick = function () {
    if (REC.page < Math.ceil(REC.total / REC.size)) { REC.page++; loadRecords(); }
  };
  q("#recBody").addEventListener("click", function (e) {
    var pv = e.target.closest("button[data-preview]");
    if (pv) { previewMedia(pv.dataset.preview, pv.dataset.kind, pv.dataset.name); return; }
    var loc = e.target.closest("button[data-locate]");
    if (loc) { locateMessage(loc.dataset.conv, loc.dataset.locate, loc.dataset.ts); return; }
    var b = e.target.closest("button[data-act]");
    if (b) {
      b.disabled = true;
      api("/api/commands/" + encodeURIComponent(b.dataset.id) + "/" + b.dataset.act, { method: "POST", body: {} })
        .then(function () { toast("已处理"); loadRecords(); refreshStatus(); })
        .catch(function (err) { b.disabled = false; toast(err.message, "danger"); });
      return;
    }
    if (e.target.closest("input")) return;
    var row = e.target.closest("tr[data-conv]");
    if (row && row.dataset.lid) locateMessage(row.dataset.conv, row.dataset.lid);
  });
  q("#recBody").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowck")) return;
    S.cmdSel[e.target.dataset.id] = e.target.checked;
    syncBatch();
  });
  q("#btnBatchRecall").onclick = function () { batchRecall(); };

  /* ------- 指标卡下钻 ------- */
  q("#cardSent").onclick = function () { drill({ src: "cmd", from: todayStr(), to: todayStr(), state: "SUCCEEDED" }); };
  q("#cardPending").onclick = function () { drill({ src: "cmd", state: "WAITING_APPROVAL,WAITING_WINDOW,QUEUED,RECEIVED" }); };
  q("#cardTodayIn").onclick = function () { drill({ src: "msg", from: todayStr(), to: todayStr() }); };
  q("#cardTodayOut").onclick = function () { drill({ src: "cmd", from: todayStr(), to: todayStr() }); };
  q("#cardArch").onclick = function () { drill({ src: "msg" }); };
  q("#cardGroups").onclick = function () { show("conversations"); };
  q("#cardActive").onclick = function () { drill({ src: "msg", from: todayStr(), to: todayStr() }); };
  q("#cardMedia").onclick = function () {
    REC.dir = "in"; if (q("#recDir")) q("#recDir").value = "in";
    loadAttachments(); scrollToRec();
  };
  q("#cardStorage").onclick = function () {
    var d = S.storage || { items: [] };
    var html = '<div class="micro faint" style="margin-bottom:8px">共 ' + fmtSize(d.total_bytes || 0) +
      ' · ' + (d.total_files || 0) + ' 个文件</div>' +
      (d.items || []).map(function (x) {
        return '<div class="speaker"><span class="sp-n">' + esc(x.label) + '</span>' +
          '<span class="mono faint">' + x.files + ' 个</span>' +
          '<b class="mono">' + fmtSize(x.bytes) + "</b></div>";
      }).join("");
    openModal("本地存储占用", html, "关闭", function () { closeModal(); });
  };

  /* ------- 活跃度排名 ------- */
  function loadActivity() {
    var days = q("#actRange").value || "7";
    return api("/api/archive/activity?days=" + days).then(function (r) {
      var items = r.items || [];
      var body = q("#actBody");
      if (!items.length) {
        body.innerHTML = '<tr class="tbl-empty"><td colspan="7">这段区间没有消息</td></tr>';
        return;
      }
      body.innerHTML = items.slice(0, 12).map(function (x, i) {
        return '<tr class="clickable" data-act-conv="' + esc(x.conv_id) + '" data-act-name="' + esc(x.name) + '">' +
          "<td class='mono faint'>" + (i + 1) + "</td>" +
          "<td><b>" + esc(x.name) + "</b></td>" +
          "<td>" + esc(x.kind || "—") + "</td>" +
          "<td class='right mono'>" + x.messages + "</td>" +
          "<td class='right mono'>" + (x.people || 0) + "</td>" +
          "<td class='faint'>" + esc(new Date((x.last_ts || 0) * 1000).toLocaleString("zh-CN", { hour12: false }).slice(5, 16)) + "</td>" +
          '<td class="right"><button class="btn sm ghost" data-act-conv="' + esc(x.conv_id) +
            '">发言排行</button></td></tr>';
      }).join("");
    }).catch(function (e) {
      q("#actBody").innerHTML = '<tr class="tbl-empty"><td colspan="7">统计加载失败：' + esc(e.message) + "</td></tr>";
    });
  }
  q("#actRange").onchange = loadActivity;
  q("#actBody").addEventListener("click", function (e) {
    var el = e.target.closest("[data-act-conv]");
    if (!el) return;
    showSpeakers(el.dataset.actConv, el.dataset.actName || "");
  });

  /* 定位到某条消息：打开聊天抽屉、加载该条上下文并高亮 */
  function locateMessage(convId, lid, ts) {
    S.pendingLocate = { conv: String(convId), lid: String(lid), ts: ts || "" };
    var known = (S.convs || []).filter(function (x) { return String(x.conv_id) === String(convId); })[0];
    openDrawer(known || { conv_id: String(convId), name: String(convId), kind: "" });
  }

  function batchRecall() {
    var ids = selectedRows();
    if (!ids.length) return;
    openModal("批量撤回", "将撤回 <b>" + ids.length + "</b> 条已发送消息，确认？", "撤回", function () {
      closeModal();
      api("/api/commands/batch-recall", { method: "POST", body: { cmd_ids: ids } })
        .then(function (r) {
          if (r.recalled) toast("已撤回 " + r.recalled + " 条");
          if (r.failed && r.failed.length) {
            toast("有 " + r.failed.length + " 条没撤回：" + (r.failed[0].error || "未知原因"), "danger");
          } else if (!r.recalled) {
            toast("没有可撤回的消息（可能已超时或已撤回）", "warn");
          }
          S.cmdSel = {}; loadRecords(); refreshStatus();
        })
        .catch(function (e) { toast("批量撤回失败：" + e.message, "danger"); });
    });
  }

  function showSpeakers(convId, name) {
    var days = q("#actRange").value || "7";
    api("/api/archive/activity?days=" + days + "&conv_id=" + encodeURIComponent(convId)).then(function (r) {
      var sp = r.speakers || [];
      var total = sp.reduce(function (a, x) { return a + (x.messages || 0); }, 0) || 1;
      var html = '<div class="micro faint" style="margin-bottom:8px">近 ' + days + ' 天发言排行 · 共 ' +
        sp.length + ' 人（列表可滚动）</div>' +
        (sp.length ? sp.map(function (x) {
          var pct = Math.round((x.messages / total) * 100);
          return '<div class="speaker"><span class="sp-n">' + esc(x.name) +
            (x.mine ? ' <span class="chip">我</span>' : "") + "</span>" +
            '<span class="mono faint">' + pct + "%</span>" +
            '<b class="mono">' + x.messages + "</b></div>";
        }).join("") : '<div class="empty">这段区间没有发言</div>');
      openModal("发言排行 · " + (name || convId), html, "关闭", function () { closeModal(); });
      var b = q("#modalBody");
      if (b) b.scrollTop = 0;
    });
  }


  function boot() {
    Promise.all([refreshStatus(), reloadConvs(), loadPolicy(), loadEmotions(), loadRecords(), loadLocalWindow(), loadActivity(),
                 loadPlatformConfig(), loadBrand()])
      .catch(function (e) { toast("启动失败：" + e.message, "danger"); });
    setInterval(function () {
      if (document.hidden) return;
      refreshStatus();
      if (q(".panel[data-panel=overview]").classList.contains("active")) loadRecords();
    }, 5000);

    // @我：按用户选择的间隔刷新；面板打开时刷新列表，否则只刷徽标
    startMentionTimer();
    loadMentions({ badgeOnly: true });
  }

  /* ---------------- 实时流 ---------------- */
  function startStream() {
    if (!window.EventSource) return;
    var es = new EventSource("/api/stream");
    es.onmessage = function (e) {
      var ev;
      try { ev = JSON.parse(e.data); } catch (err) { return; }
      if (ev.ev !== "msg") return;
      if (!q("#drawer").hidden && String(ev.conv_id) === String(DR.conv)) paintDrawer();
      var row = S.convs.filter(function (c) { return String(c.conv_id) === String(ev.conv_id); })[0];
      if (row) row.last_seen = ev.t || row.last_seen;
      refreshStatus();
    };
    es.onerror = function () { /* EventSource 自己会重连 */ };
  }

  /* ---------------- 登录门 ---------------- */
  var booted = false;
  function startApp() {
    if (booted) return;
    booted = true;
    q("#gate").hidden = true;
    boot();
    startStream();
  }
  function showGate(needsSetup) {
    if (q("#gateBrand")) {
      var b = S.brand || {};
      q("#gateBrand").textContent = (b.name || "企微助手") + " · " + (b.subtitle || "本地工作台");
      if (b.logo_url && q("#gateLogo")) {
        q("#gateLogo").innerHTML = '<img src="' + esc(b.logo_url) + '" alt="logo" style="width:100%;height:100%;object-fit:contain">';
      }
    }
    q("#gate").hidden = false;
    q("#gateTitle").textContent = needsSetup ? "设置账号密码" : "登录";
    q("#gateHint").textContent = needsSetup
      ? "首次使用：设置一个账号和密码（密码至少 6 位），之后用它们登录。"
      : "输入账号与密码。";
    q("#gatePw2Box").hidden = !needsSetup;
    q("#gateSubmit").textContent = needsSetup ? "设置并进入" : "登录";
    if (needsSetup) {
      if (!q("#gateUser").value) q("#gateUser").value = "admin";
      q("#gateUser").focus();
    } else {
      // 预填必须用服务端当前账号：本地可能还存着改名前的旧账号，直接提交会一直 401
      q("#gateUser").value = (S.authUser || localStorage.getItem("loginUser") || "admin");
      q("#gatePw").focus();
    }
  }

  q("#gateForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = q("#gatePw").value;
    var pw2 = q("#gatePw2").value;
    q("#gateErr").textContent = "";
    var needsSetup = !q("#gatePw2Box").hidden;
    if (needsSetup && pw !== pw2) { q("#gateErr").textContent = "两次输入不一致"; return; }
    if (pw.length < 6) { q("#gateErr").textContent = "口令至少 6 位"; return; }
    var url = needsSetup ? "/api/auth/setup" : "/api/auth/login";
    var user = (q("#gateUser").value || "").trim();
    if (!user) { q("#gateErr").textContent = "请填账号"; return; }
    localStorage.setItem("loginUser", user);
    var remember = q("#gateRemember") ? !!q("#gateRemember").checked : true;
    api(url, { method: "POST", body: { user: user, password: pw, remember: remember } })
      .then(function (r) {
        if (r && r.token) localStorage.setItem("sessionToken", r.token);
        localStorage.setItem("needsSetup", "0");
        startApp();                       // 先把界面放出来
        setTimeout(function () { location.reload(); }, 150);   // 再整页重载，拿到干净状态
      })
      .catch(function (err) {
        if (err.payload && err.payload.code === "ALREADY_SET") {
          showGate(false);
          q("#gateErr").textContent = "已设置过密码，请直接登录";
          return;
        }
        q("#gateErr").textContent = (err.message || "登录失败") +
          (S.authUser ? "（当前账号是 " + S.authUser + "）" : "");
      });
  });

  q("#btnLogout").onclick = function () {
    api("/api/auth/logout", { method: "POST", body: {} }).then(function () { location.reload(); });
  };



/* ================= 会话批量操作 + 翻页（WxGw 式管理） ================= */
(function () {
  var sel = {}, page = 1;
  var PS = parseInt(localStorage.getItem("convPageSize") || "20", 10) || 20;

  function visibleConvs() { return S.convFiltered || S.convs || []; }
  function pagedConvs() {
    var start = (page - 1) * PS;
    return visibleConvs().slice(start, start + PS);
  }
  window.convPaged = pagedConvs;

  function syncBar() {
    var n = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
    q("#convSelCnt").textContent = n ? "已选 " + n + " 项" : "未选";
    // 没选会话时，所有批量动作都不可点（灰掉而不是消失）
    Array.prototype.forEach.call(document.querySelectorAll("#convBatchActs .bb-btn"), function (b) {
      b.disabled = !n;
    });
    var total = visibleConvs().length, pages = Math.max(1, Math.ceil(total / PS));
    if (page > pages) page = pages;
    q("#convPageInfo").textContent = "第 " + page + "/" + pages + " 页 · 共 " + total + " 条";
    q("#convPrev").disabled = page <= 1;
    q("#convNext").disabled = page >= pages;
    q("#convAll").checked = pagedConvs().length > 0 && pagedConvs().every(function (c) { return sel[c.conv_id]; });
  }
  window.convSyncBar = syncBar;

  function batch(set, label) {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    if (!ids.length) { toast("先勾选会话", "warn"); return; }
    openModal("批量" + label, "将对 <b>" + ids.length + "</b> 个会话执行「" + label + "」，确认？", "执行", function () {
      closeModal();
      api("/api/conversations/batch", { method: "POST", body: { conv_ids: ids, set: set } })
        .then(function (r) {
          S.convs = r.conversations || [];
          sel = {}; paintConvs(); toast("已批量" + label + " " + (r.updated || ids.length) + " 个会话");
        })
        .catch(function (e) { toast("批量操作失败：" + e.message, "err"); });
    });
  }

  // 一个委托搞定五组动作：审批 / 文件 / 响应 / 归档 / 发送
  q("#convBatchActs").addEventListener("click", function (e) {
    var b = e.target.closest(".bb-btn");
    if (!b || b.disabled) return;
    var set;
    try { set = JSON.parse(b.dataset.batch); } catch (err) { return; }
    batch(set, b.dataset.label || b.textContent.trim());
  });

  q("#convAll").addEventListener("change", function (e) {
    pagedConvs().forEach(function (c) { sel[c.conv_id] = e.target.checked; });
    paintConvs();
  });
  q("#convPrev").onclick = function () { if (page > 1) { page--; paintConvs(); } };
  q("#convNext").onclick = function () {
    if (page < Math.ceil(visibleConvs().length / PS)) { page++; paintConvs(); }
  };

  // 每页条数
  var psSel = q("#convPageSize");
  if (psSel) {
    psSel.value = String(PS);
    psSel.addEventListener("change", function () {
      PS = parseInt(psSel.value, 10) || 20;
      localStorage.setItem("convPageSize", String(PS));
      page = 1;
      paintConvs();
    });
  }

  q("#convBody").addEventListener("change", function (e) {
    var cb = e.target.closest("input.rowchk");
    if (!cb) return;
    sel[cb.dataset.cid] = cb.checked;
    syncBar();
  });
  window.convSel = sel;
  window.convResetPage = function () { page = 1; };
})();

/* ================= 登录账号管理 ================= */
(function () {
  function el(id) { return document.querySelector("#" + id); }
  if (!el("accSave")) return;

  function load() {
    api("/api/account").then(function (r) {
      if (el("accUser")) el("accUser").value = r.user || "";
      el("accSetAt").textContent = r.pw_set_at ? "上次改密 " + r.pw_set_at : "还没改过密码";
      el("accState").textContent = "在线会话 " + (r.sessions || 0) + " 个";
      localStorage.setItem("loginUser", r.user || "");
    }).catch(function () {});
  }
  window.loadAccount = load;

  el("accSave").onclick = function () {
    var cur = el("accCur").value || "";
    var nu = (el("accUser").value || "").trim();
    var n1 = el("accNew").value || "";
    var n2 = el("accNew2").value || "";
    if (!cur) { toast("先填当前密码", "warn"); return; }
    if (n1 || n2) {
      if (n1 !== n2) { toast("两次新密码不一致", "warn"); return; }
      if (n1.length < 6) { toast("新密码至少 6 位", "warn"); return; }
    }
    if (!n1 && nu === (S.authUser || "")) { toast("账号和密码都没改", "warn"); return; }
    openModal("保存账号", "确认修改登录账号或密码？其它已登录的浏览器会失效。", "保存", function () {
      closeModal();
      var b = el("accSave"); b.disabled = true; b.textContent = "保存中…";
      api("/api/account", { method: "POST", body: { current_password: cur, user: nu, new_password: n1 } })
        .then(function (r) {
          S.authUser = r.user; localStorage.setItem("loginUser", r.user);
          el("accCur").value = ""; el("accNew").value = ""; el("accNew2").value = "";
          toast("已保存" + (r.changed && r.changed.password ? "，密码已更新" : ""));
          load();
        })
        .catch(function (e) { toast(e.message, "danger"); })
        .finally(function () { b.disabled = false; b.textContent = "保存"; });
    });
  };
  load();
})();



/* ================= 主动发起 + 建群 / 群管理 ================= */
(function () {
  // ---------- 主动发起（发送页） ----------
  var dmPicked = null;
  function dmEl(id) { return document.querySelector("#" + id); }

  if (dmEl("dmResolve")) {
    dmEl("dmResolve").onclick = function () {
      var q = (dmEl("dmTo").value || "").trim();
      if (!q) return;
      api("/api/contacts?q=" + encodeURIComponent(q)).then(function (r) {
        var it = (r.items || [])[0];
        if (!it) { dmEl("dmResolved").textContent = "没找到这个人"; dmPicked = null; return; }
        dmPicked = it;
        dmEl("dmResolved").textContent = "命中：" + it.name + "（" + it.eng + " · uid " + it.rid + "）" +
          (it.dm_exists ? " · 已有会话" : " · 还没有会话，发送时会自动建");
      }).catch(function (e) { dmEl("dmResolved").textContent = "核对失败：" + e.message; });
    };

    dmEl("dmSend").onclick = function () {
      var text = (dmEl("dmText").value || "").trim();
      var raw = (dmEl("dmTo").value || "").trim();
      var user = dmPicked ? String(dmPicked.rid) : raw;
      if (!user) { toast("先填对方 uid 或账号", "warn"); return; }
      if (!text) { toast("内容不能为空", "warn"); return; }
      var who = dmPicked ? (dmPicked.name + "（" + dmPicked.eng + "）") : user;
      openModal("主动发送", "将直接发给 <b>" + esc(who) + "</b>，没有会话会自动建。确认？", "发送", function () {
        closeModal();
        var btn = dmEl("dmSend"); btn.disabled = true; btn.textContent = "发送中…";
        api("/api/dm-send", { method: "POST", body: { user: user, text: text } })
          .then(function (r) {
            if (r.ok) { toast("已发送"); dmEl("dmText").value = ""; }
            else { toast("未成功：" + String(r.output || "").split("\n").filter(Boolean).slice(-1)[0], "danger"); }
          })
          .catch(function (e) { toast(e.message, "danger"); })
          .finally(function () { btn.disabled = false; btn.textContent = "主动发送"; });
      });
    };
  }

  // ---------- 建群 ----------
  var picked = [];
  function renderPicked() {
    var box = dmEl("ngPicked"); if (!box) return;
    box.innerHTML = picked.map(function (p) {
      return '<li class="target" data-rid="' + esc(p.rid) + '"><span class="tname">' + esc(p.name) +
        ' <span class="faint mono">' + esc(p.eng) + '</span></span>' +
        '<button class="btn sm ghost" data-rm="' + esc(p.rid) + '">移除</button></li>';
    }).join("") || '<li class="empty-lite micro faint">还没选人</li>';
    dmEl("ngCount").textContent = picked.length + " 人";
    var warn = dmEl("ngWarn");
    if (warn) {
      warn.hidden = picked.length <= 63;
      warn.textContent = "最多 63 个受邀成员";
    }
  }
  if (dmEl("ngSearch")) {
    var t = null;
    dmEl("ngSearch").oninput = function () {
      clearTimeout(t);
      var q = (dmEl("ngSearch").value || "").trim();
      if (!q) { dmEl("ngResults").innerHTML = ""; return; }
      t = setTimeout(function () {
        api("/api/contacts?q=" + encodeURIComponent(q)).then(function (r) {
          dmEl("ngResults").innerHTML = (r.items || []).map(function (it) {
            var on = picked.some(function (p) { return String(p.rid) === String(it.rid); });
            return '<li class="target" data-add="' + esc(it.rid) + '"><span class="tname">' + esc(it.name) +
              ' <span class="faint mono">' + esc(it.eng) + '</span></span>' +
              '<button class="btn sm' + (on ? ' ghost' : '') + '" data-pick="' + esc(it.rid) + '">' +
              (on ? "已选" : "加入") + "</button></li>";
          }).join("") || '<li class="empty-lite micro faint">没找到</li>';
        });
      }, 260);
    };
    function addPicked(it) {
      if (picked.length >= 63) { toast("最多 63 个成员", "warn"); return false; }
      if (picked.some(function (p) { return String(p.rid) === String(it.rid); })) return true;
      picked.push({ rid: it.rid, name: it.name, eng: it.eng || "" });
      renderPicked();
      return true;
    }

    dmEl("ngBatchGo").onclick = function () {
      var text = (dmEl("ngBatch").value || "").trim();
      if (!text) { toast("先输入姓名或账号", "warn"); return; }
      var btn = dmEl("ngBatchGo"); btn.disabled = true; btn.textContent = "识别中…";
      dmEl("ngBatchState").textContent = "";
      dmEl("ngAmbiguous").innerHTML = "";
      api("/api/contacts/resolve", { method: "POST", body: { text: text } })
        .then(function (r) {
          (r.resolved || []).forEach(addPicked);
          var amb = r.ambiguous || [], miss = r.missing || [];
          var html = "";
          amb.forEach(function (g, gi) {
            html += '<div class="banner warn" style="margin-bottom:6px">' +
              '<b>「' + esc(g.token) + '」' + (g.reason === "同名" ? "有重名" : "有多个匹配") +
              '，要拉哪一位？</b><div style="margin-top:6px">' +
              g.candidates.map(function (c, ci) {
                return '<label style="display:block;margin:2px 0"><input type="radio" name="amb' + gi +
                  '" value="' + esc(c.rid) + '"' + (ci === 0 ? "" : "") + '> ' + esc(c.name) +
                  ' <span class="faint mono">' + esc(c.eng) + '</span>' +
                  (c.job ? ' <span class="faint">' + esc(c.job) + '</span>' : "") + "</label>";
              }).join("") +
              '<button class="btn sm" data-amb="' + gi + '">加入所选</button></div></div>';
          });
          if (miss.length) {
            html += '<div class="micro faint">没找到：' + miss.map(esc).join("、") + "</div>";
          }
          dmEl("ngAmbiguous").innerHTML = html;
          dmEl("ngAmbiguous").onclick = function (ev) {
            var b = ev.target.closest("button[data-amb]"); if (!b) return;
            var gi2 = b.dataset.amb;
            var sel = document.querySelector('input[name="amb' + gi2 + '"]:checked');
            if (!sel) { toast("先选一位", "warn"); return; }
            var g2 = amb[Number(gi2)];
            var cand = (g2.candidates || []).filter(function (c) { return String(c.rid) === String(sel.value); })[0];
            if (cand && addPicked(cand)) { b.closest(".banner").remove(); }
          };
          var n = (r.resolved || []).length;
          dmEl("ngBatchState").textContent = "识别 " + n + " 人" +
            (amb.length ? "，" + amb.length + " 个待确认" : "") +
            (miss.length ? "，" + miss.length + " 个没找到" : "");
        })
        .catch(function (e) { dmEl("ngBatchState").textContent = "失败：" + e.message; })
        .finally(function () { btn.disabled = false; btn.textContent = "识别并加入"; });
    };

    dmEl("ngResults").onclick = function (e) {
      var b = e.target.closest("button[data-pick]"); if (!b) return;
      var rid = b.dataset.pick;
      var li = b.closest("li");
      var name = (li.querySelector(".tname").textContent || "").trim().split(" ")[0];
      if (!picked.some(function (p) { return String(p.rid) === String(rid); })) {
        if (picked.length >= 63) { toast("最多 63 个成员", "warn"); return; }
        picked.push({ rid: rid, name: name, eng: "" });
        renderPicked();
      }
    };
    dmEl("ngPicked").onclick = function (e) {
      var b = e.target.closest("button[data-rm]"); if (!b) return;
      picked = picked.filter(function (p) { return String(p.rid) !== String(b.dataset.rm); });
      renderPicked();
    };
    dmEl("ngCreate").onclick = function () {
      var name = (dmEl("ngName").value || "").trim();
      if (!picked.length) { toast("先加成员", "warn"); return; }
      openModal("建群", "将创建群「<b>" + esc(name || "(默认名)") + "</b>」，成员 " + picked.length +
        " 人（含你共 " + (picked.length + 1) + " 人）。确认？", "建群", function () {
        closeModal();
        var btn = dmEl("ngCreate"); btn.disabled = true; btn.textContent = "建群中…";
        api("/api/group-create", { method: "POST", body: { name: name, users: picked.map(function (p) { return p.rid; }) } })
          .then(function (r) {
            if (r.ok) {
              toast("建群成功" + (r.conv_id ? "，conv_id=" + r.conv_id : ""));
              picked = []; renderPicked(); dmEl("ngName").value = "";
              reloadConvs().then(function () { fillGroups(); });
            } else {
              toast("建群未成功：" + String(r.output || "").split("\n").filter(Boolean).slice(-1)[0], "danger");
            }
          })
          .catch(function (e) { toast(e.message, "danger"); })
          .finally(function () { btn.disabled = false; btn.textContent = "建群"; });
      });
    };
  }

  // ---------- 群管理 ----------
  function fillGroups() {
    var sel = dmEl("gmConv"); if (!sel) return;
    var cur = sel.value;
    var groups = (S.convs || []).filter(function (c) { return c.kind === "群聊"; });
    sel.innerHTML = '<option value="">— 选择群聊 —</option>' + groups.map(function (c) {
      return '<option value="' + esc(c.conv_id) + '">' + esc(c.name) + "（" + esc(c.conv_id) + "）</option>";
    }).join("");
    if (cur) sel.value = cur;
  }
  window.fillGroups = fillGroups;

  if (dmEl("gmConv")) {
    var caps = null;
    api("/api/group/capabilities").then(function (r) { caps = r; applyCaps(); }).catch(function () {});
    function applyCaps() {
      var has = function (k) { return !!(caps && caps[k]); };
      dmEl("gmRename").disabled = !has("rename");
      dmEl("gmNoticeSet").disabled = !has("notice");
      dmEl("gmAdminAdd").disabled = !has("admin");
      dmEl("gmAdminDel").disabled = !has("admin");
      ["gmAdd", "gmDel", "gmInvite", "gmQuit", "gmDismiss",
       "gmPin", "gmUnpin", "gmUntopAll"].forEach(function (k) {
        if (dmEl(k)) dmEl(k).disabled = false;
      });
      var miss = [];
      if (!has("rename")) miss.push("改群名");
      if (!has("notice")) miss.push("群公告");
      if (!has("admin")) miss.push("群管理员");
      var hint = dmEl("gmCapHint");
      hint.textContent = miss.length ? "本机钩子暂不支持：" + miss.join(" / ") : "";
    }
    dmEl("gmConv").onchange = function () {
      var cid = dmEl("gmConv").value;
      var c = (S.convs || []).filter(function (x) { return String(x.conv_id) === String(cid); })[0];
      dmEl("gmHint").textContent = c ? c.name : "选一个群";
      dmEl("gmName").value = c ? c.name : "";
      dmEl("gmAdmin").innerHTML = '<option value="">— 选择成员 —</option>';
      if (!cid) return;
      api("/api/group/members?conv_id=" + encodeURIComponent(cid)).then(function (r) {
        dmEl("gmAdmin").innerHTML = '<option value="">— 选择成员 —</option>' +
          (r.items || []).filter(function (m) { return m.uid; }).map(function (m) {
            return '<option value="' + esc(m.uid) + '">' + esc((m.name || m.uid)) + "</option>";
          }).join("");
      }).catch(function () {});
    };
    function gmCall(op, payload, label, after) {
      var cid = dmEl("gmConv").value;
      if (!cid) { toast("先选一个群", "warn"); return; }
      openModal(label, "对群「" + (dmEl("gmHint").textContent || cid) + "」执行：" + label + "。确认？", "执行", function () {
        closeModal();
        api("/api/group/manage", { method: "POST", body: Object.assign({ conv_id: cid, op: op }, payload || {}) })
          .then(function (r) {
            if (r.ok) { toast(label + "成功"); if (after) after(r); }
            else { toast(label + "未成功：" + String(r.output || "").split("\n").filter(Boolean).slice(-1)[0], "danger"); }
          })
          .catch(function (e) { toast(e.message, "danger"); });
      });
    }

    dmEl("gmRename").onclick = function () {
      var n = (dmEl("gmName").value || "").trim();
      if (!n) { toast("先填新群名", "warn"); return; }
      gmCall("rename", { name: n }, "改群名", function () { reloadConvs().then(function () { fillGroups(); }); });
    };
    dmEl("gmNoticeSet").onclick = function () {
      var t = (dmEl("gmNotice").value || "").trim();
      if (!t) { toast("先写公告内容", "warn"); return; }
      gmCall("notice", { name: t }, "发布公告");
    };
    function gmUserOp(op, label, confirmText) {
      var cid = dmEl("gmConv").value;
      var raw = (dmEl("gmUser").value || "").trim();
      if (!cid) { toast("先选一个群", "warn"); return; }
      if (op !== "quit" && op !== "dismiss" && !raw) { toast("先填成员 uid 或账号", "warn"); return; }
      openModal(label, confirmText || (label + "：" + (raw || "当前群") + "，确认？"), "执行", function () {
        closeModal();
        var body = { conv_id: cid, op: op };
        if (op !== "quit" && op !== "dismiss") body.users = [raw];
        api("/api/group/manage", { method: "POST", body: body })
          .then(function (r) {
            if (r.ok) { toast(label + "成功"); reloadConvs().then(function () { fillGroups(); }); }
            else { toast(label + "未成功：" + String(r.output || "").split("\n").filter(Boolean).slice(-1)[0], "danger"); }
          })
          .catch(function (e) { toast(e.message, "danger"); });
      });
    }

    dmEl("gmAdd").onclick = function () { gmUserOp("add", "拉人", "把该成员直接拉进群？"); };
    dmEl("gmDel").onclick = function () { gmUserOp("del", "踢人", "把该成员移出群？"); };
    dmEl("gmInvite").onclick = function () { gmUserOp("invite", "发邀请", "给对方发入群邀请（需要对方确认）？"); };
    dmEl("gmQuit").onclick = function () { gmUserOp("quit", "退群", "退出这个群？退群后需要别人重新拉你。"); };

    function gmPinOp(op, label) {
      var cid = dmEl("gmConv").value;
      if (!cid) { toast("先选一个群", "warn"); return; }
      var seq = parseInt((dmEl("gmPinSeq").value || "0"), 10) || 0;
      dmEl("gmPinState").textContent = label + "：执行中…";
      api("/api/group/manage", { method: "POST",
        body: { conv_id: cid, op: op, seq: seq, confirm: true } })
        .then(function (r) {
          dmEl("gmPinState").textContent = (r.ok ? "✓ " : "✗ ") + label +
            (r.ok ? " 完成" : "（" + String(r.output || "").slice(-60) + "）");
          toast(r.ok ? label + "完成" : label + "失败", r.ok ? "ok" : "danger");
        })
        .catch(function (e) { dmEl("gmPinState").textContent = "✗ " + e.message; toast(e.message, "danger"); });
    }
    dmEl("gmPin").onclick = function () { gmPinOp("pin", "置顶"); };
    dmEl("gmUnpin").onclick = function () { gmPinOp("unpin", "取消置顶"); };
    dmEl("gmUntopAll").onclick = function () { gmPinOp("untopall", "全部取消置顶"); };
    dmEl("gmDismiss").onclick = function () {
      var cid = dmEl("gmConv").value;
      if (!cid) { toast("先选一个群", "warn"); return; }
      var name = dmEl("gmHint").textContent || cid;
      openModal("解散群", "解散「" + esc(name) + "」？<b>不可撤回</b>，所有成员都会被移出。", "确认解散", function () {
        closeModal();
        api("/api/group/manage", { method: "POST", body: { conv_id: cid, op: "dismiss", confirm: true } })
          .then(function (r) {
            if (r.ok) { toast("已解散"); reloadConvs().then(function () { fillGroups(); }); }
            else { toast("解散未成功：" + String(r.output || "").split("\n").filter(Boolean).slice(-1)[0], "danger"); }
          })
          .catch(function (e) { toast(e.message, "danger"); });
      });
    };

    dmEl("gmAdminAdd").onclick = function () {
      var u = dmEl("gmAdmin").value;
      if (!u) { toast("先选成员", "warn"); return; }
      gmCall("admin", { users: [u] }, "设为管理员");
    };
    dmEl("gmAdminDel").onclick = function () {
      var u = dmEl("gmAdmin").value;
      if (!u) { toast("先选成员", "warn"); return; }
      gmCall("unadmin", { users: [u] }, "取消管理员");
    };
  }
})();

/* ================= 聊天记录视图（WxGw 气泡风格） ================= */
(function () {
  var history = { msgs: [], more: false, conv: null };

  var ICO = {
    pdf:  { c: "rgba(255,77,79,.15)", f: "#FF4D4F" }, doc: { c: "rgba(41,182,246,.15)", f: "#29B6F6" },
    xls:  { c: "rgba(76,211,138,.15)", f: "#4CD38A" }, ppt: { c: "rgba(255,159,28,.15)", f: "#FF9F1C" },
    zip:  { c: "rgba(255,207,0,.15)", f: "#FFCF00" }, img: { c: "rgba(206,120,255,.15)", f: "#CE78FF" },
    txt:  { c: "rgba(160,163,169,.15)", f: "#A0A3A9" }, def: { c: "rgba(160,163,169,.15)", f: "#A0A3A9" }
  };
  function icoKind(name) {
    var e = (name || "").split(".").pop().toLowerCase();
    if (e === "pdf") return "pdf";
    if (e === "doc" || e === "docx" || e === "wps") return "doc";
    if (e === "xls" || e === "xlsx" || e === "csv" || e === "et") return "xls";
    if (e === "ppt" || e === "pptx") return "ppt";
    if (e === "zip" || e === "rar" || e === "7z" || e === "gz" || e === "tar") return "zip";
    if (["png", "jpg", "jpeg", "gif", "bmp", "webp"].indexOf(e) >= 0) return "img";
    if (e === "txt" || e === "md" || e === "log" || e === "json") return "txt";
    return "def";
  }
  function fileSvg(kind) {
    var f = ICO[kind];
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + f.f + '" stroke-width="2">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 2v6h6"/></svg>';
  }
  function emptyLabel(m) {
    var kind = (m.media || {}).kind;
    if (kind === "voice") return "[语音]";
    if (kind === "video") return "[视频]";
    if (kind === "card") return "[链接卡片]";
    if (kind === "emotion") return "[表情]";
    if (kind === "image") return "[图片]";
    if (kind === "file") return "[文件]";
    if (m.cat === "recalled" || m.recalled) return "该消息已撤回";
    if (m.ctype === 2) return "[无正文]";
    return "[" + (m.cat || "消息") + "]";
  }

  function fmtSize(n) {
    if (!n) return "";
    if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n > 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }
  var AVA_COLORS = ["c1", "c2", "c3", "c4"];
  function avaColor(name) {
    var h = 0; for (var i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVA_COLORS[h % 4];
  }
  function cleanBlob(t) {
    return String(t || "").replace(/\u200b/g, "").split(/\s+/).filter(function (tok) {
      if (!tok) return false;
      if (/^WN\d{4}-/.test(tok)) return false;                       // WN 号
      if (/^[0-9a-f]{32}$/.test(tok)) return false;                  // md5
      if (/^(?:[A-Za-z]:[\\/]|\/|\\\\|~[\\/])/.test(tok)) return false;  // 路径
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$/.test(tok)) return false;
      if (/^[;；\-|]$/.test(tok)) return false;
      return true;
    }).join(" ");
  }
  function cleanName(n) { return (n || "").replace(/[\u200b-\u200d\ufeff]/g, "") || "?"; }

  function render() {
    var box = q("#dBody .chat-view");
    if (!box) return;
    if (!history.msgs.length) {
      box.innerHTML = '<div class="tbl-empty" style="padding:30px">该会话还没有聊天记录</div>';
      return;
    }
    var html = history.more
      ? '<div class="chat-day" style="cursor:pointer" id="chatMore">↑ 加载更早消息（共 ' + history.total + ' 条）</div>'
      : "";
    var lastDay = "";
    var showSys = !!(q("#dShowSys") && q("#dShowSys").checked);
    history.msgs.forEach(function (m) {
      var isEmptyEvent = !(m.display || "").trim() && !(m.caption || "").trim() && !m.media;
      if (isEmptyEvent && !showSys) return;      // 无正文的会话事件默认不展示
      var day = (m.msg_time || "").slice(0, 10);
      if (day && day !== lastDay) {
        html += '<div class="chat-day">' + day + '</div>'; lastDay = day;
      }
      var mine = !!m.mine;
      var name = cleanName(m.sender);
      var sys = m.ctype === 2001 || m.ctype === 35 ||
        (!(m.display || "").trim() && !(m.caption || "").trim() && !m.media);
      var meta = '<div class="chat-meta"><b>' + esc(mine ? "企微助手" : name) + '</b>' +
        (m.kind === "群聊" && !mine ? '<span class="tag group">群聊</span>' : "") +
        (mine ? '<span class="tag mine">我</span>' : "") +
        (m.recalled ? '<span class="tag recalled">已撤回</span>' : "") +
        '<span>' + esc((m.msg_time || "").slice(11, 16)) + '</span></div>';
      // 正文只用服务端清洗过的 display（WN 号/md5/路径已剥掉），媒体单独渲染卡片
      var body = esc(m.display || "");
      var cap = esc(m.caption || "");
      if (cap) body = body ? (body + "\n" + cap) : cap;
      var mt = m.media || null;
      if (mt && mt.kind === "image") {
        var qs = "?conv_id=" + encodeURIComponent(history.conv) + "&lid=" + encodeURIComponent(mt.lid || "") +
                 "&md5=" + encodeURIComponent(mt.md5 || "");
        body += '<img class="chat-img" src="/api/media/' + encodeURIComponent(mt.name || mt.md5 || "") + qs +
          '" loading="lazy" alt="图片" title="点击看大图" data-full="/api/media/' +
          encodeURIComponent(mt.name || mt.md5 || "") + qs + '">';
      } else if (mt && (mt.kind === "file")) {
        var kind = icoKind(mt.name);
        var fqs = "?conv_id=" + encodeURIComponent(history.conv) + "&lid=" + encodeURIComponent(mt.lid || "");
        body += '<div class="att is-link" data-url="/api/files/' + encodeURIComponent(mt.name || "") + fqs + '">' +
          '<div class="att-ico" style="background:' + ICO[kind].c + '">' + fileSvg(kind) + '</div>' +
          '<div><div class="att-name">' + esc(mt.name || "文件") + '</div>' +
          '<div class="att-sub">点击下载（未缓存会自动从客户端取）</div></div></div>';
      } else if (mt && mt.kind === "emotion") {
        body += '<div class="att"><div class="att-ico" style="background:rgba(255,207,0,.15)">🙂</div>' +
          '<div><div class="att-name">表情</div></div></div>';
      } else if (mt && mt.kind === "voice") {
        body += '<div class="att"><div class="att-ico" style="background:rgba(41,182,246,.15)">🎤</div>' +
          '<div><div class="att-name">语音消息</div></div></div>';
      } else if (mt && mt.kind === "video") {
        body += '<div class="att"><div class="att-ico" style="background:rgba(206,120,255,.15)">🎬</div>' +
          '<div><div class="att-name">视频消息</div></div></div>';
      } else if (mt && mt.kind === "recalled") {
        body += '<div class="bubble sysmsg">该消息已撤回</div>';
      }
      // 兜底：若服务端没给 media 但正文里还残留机器字段，前端再洗一遍
      if (!body.trim() && !mt) body = esc(cleanBlob(m.text || ""));
      html += sys && !body.trim()
        ? '<div class="chat-item"><div class="chat-main"><div class="bubble sysmsg">' +
          esc(m.kind || "系统") + ' 事件 · ' + esc(m.msg_time || "") + '</div></div></div>'
        : '<div class="chat-item' + (mine ? " me" : "") +
          (history.highlight && String(m.lid) === String(history.highlight) ? " hit" : "") + '">' +
          '<div class="chat-ava ' + (mine ? "bot" : avaColor(name)) + '">' + esc((mine ? "安" : name)[0]) + '</div>' +
          '<div class="chat-main">' + meta + '<div class="bubble">' + body + '</div></div></div>';
    });
    box.innerHTML = html;
    q("#chatMore") && (q("#chatMore").onclick = loadMore);
  }
  function loadMore() {
    if (!history.msgs.length) return;
    api("/api/archive/messages?conv_id=" + encodeURIComponent(history.conv) +
        "&limit=50&before=" + encodeURIComponent(history.msgs[0].ts))
      .then(function (r) {
        history.msgs = r.messages.concat(history.msgs);
        history.more = r.more; history.total = r.total;
        render();
      });
  }
  window.loadChatAround = function (convId, lid, ts, retried) {
    history.conv = convId;
    history.highlight = lid ? String(lid) : null;
    q("#dBody").innerHTML = '<div class="chat-view"><div class="tbl-empty" style="padding:30px">定位中…</div></div>';
    var qs = "conv_id=" + encodeURIComponent(convId);
    if (lid) qs += "&around=" + encodeURIComponent(lid);
    if (ts) qs += "&around_ts=" + encodeURIComponent(ts);
    api("/api/archive/messages?" + qs).then(function (r) {
      var msgs = r.messages || [];
      if (!msgs.length) {
        if (!retried) {
          // 本地还没有这个会话的消息 → 先自动同步一次再重试，省得用户手动点
          q("#dBody").innerHTML = '<div class="chat-view"><div class="tbl-empty" style="padding:30px">本地没有该会话记录，正在从客户端同步…</div></div>';
          api("/api/archive/" + encodeURIComponent(convId) + "/sync", { method: "POST", body: {} })
            .then(function (sr) {
              if (sr && sr.new) toast("已同步 " + sr.new + " 条");
              window.loadChatAround(convId, lid, ts, true);
            })
            .catch(function () { window.loadChatAround(convId, lid, ts, true); });
          return;
        }
        // 同步后仍然没有 → 退回到普通加载，别把用户卡在空白页
        toast("这条消息不在本地归档里，已加载最近记录", "warn");
        window.loadChat(convId);
        return;
      }
      history.msgs = msgs;
      history.more = true; history.total = msgs.length;
      if (r.approx && r.target) history.highlight = String(r.target);
      render();
      if (r.approx) toast("原文未归档，已按时间定位到最近一条", "warn");
      var el = q("#dBody .chat-item.hit");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }).catch(function (e) {
      q("#dBody").innerHTML = '<div class="chat-view"><div class="tbl-empty" style="padding:30px">定位失败：' + esc(e.message) + "</div></div>";
    });
  };

  window.loadChat = function (convId) {
    // 有定位请求时交给 loadChatAround（否则它的结果会被这里的普通加载覆盖）
    var pend = S.pendingLocate;
    if (pend && String(pend.conv) === String(convId)) {
      S.pendingLocate = null;
      window.loadChatAround(pend.conv, pend.lid, pend.ts);
      return;
    }
    history.conv = convId;
    history.highlight = null;
    q("#dBody").innerHTML = '<div class="chat-view"><div class="tbl-empty" style="padding:30px">加载中…</div></div>';
    api("/api/archive/messages?conv_id=" + encodeURIComponent(convId) + "&limit=50")
      .then(function (r) { history.msgs = r.messages; history.more = r.more; history.total = r.total; render(); })
      .catch(function (e) {
        q("#dBody .chat-view").innerHTML = '<div class="tbl-empty" style="padding:30px">加载失败：' + esc(e.message) + '</div>';
      });
  };
  q("#dBody").addEventListener("click", function (e) {
    var att = e.target.closest(".att.is-link");
    if (att) { window.open(att.dataset.url, "_blank"); return; }
    var img = e.target.closest(".chat-img");
    if (img && img.dataset.full) window.open(img.dataset.full, "_blank");
  });
})();

/* ================= 概览运营指标 ================= */
window.loadOvStats = function () {
  api("/api/archive/stats").then(function (st) {
    q("#mTodayIn").textContent = st.today_in || 0;
    q("#mTodayOut").textContent = st.today_out || 0;
    q("#mActive").textContent = st.active_24h || 0;
    if (q("#mGroups")) q("#mGroups").textContent = st.group_count || 0;
    if (q("#mGroupsSub")) q("#mGroupsSub").textContent =
      "单聊 " + (st.dm_count || 0) + (S.convTotal ? (" · 共 " + S.convTotal) : "");
    if (q("#mTodayOutSub")) q("#mTodayOutSub").textContent = "本账号发出";
    q("#mMediaN").textContent = st.media_files || 0;
    q("#mMediaSub").textContent = "图片 " + (st.image_count || 0) + " · 文件 " + (st.file_count || 0);
    // 归档是累计规模（不是今日量），和"今日收到"分开表述，避免看起来重复
    var arch = q("#mArch");
    if (arch) arch.textContent = st.archive_total || 0;
    var sub = q("#mArchSub");
    // 只表达累计规模（“今日收到/发出”另有卡片），避免两个口径看起来重复
    if (sub) sub.textContent = "覆盖 " + (st.archive_convs || 0) + " 个会话" +
      (st.system_events ? (" · 另 " + st.system_events + " 条系统事件") : "");
  }).catch(function () {});

  api("/api/storage").then(function (d) {
    var v = q("#mStorage"), sub2 = q("#mStorageSub");
    if (!v) return;
    v.textContent = fmtSize(d.total_bytes || 0).replace(" ", "");
    if (sub2) sub2.textContent = (d.total_files || 0) + " 个文件 · 附件 " + (d.media_files || 0);
    S.storage = d;
  }).catch(function () {});
  api("/api/archive/attachments?kind=file,image&limit=1").then(function (d) {
    if (q("#mMediaSub")) q("#mMediaSub").textContent =
      "图片 " + ((d.by_kind || {}).image || 0) + " · 文件 " + ((d.by_kind || {}).file || 0);
  }).catch(function () {});
};

  api("/api/auth/status").then(function (st) {
    localStorage.setItem("needsSetup", st.needs_setup ? "1" : "0");
    if (st.user) { S.authUser = st.user; localStorage.setItem("loginUser", st.user); }
    // 未登录但本地还留着旧令牌：清掉重试一次，别让过期令牌一直挡着
    if (!st.authed && localStorage.getItem("sessionToken")) {
      localStorage.removeItem("sessionToken");
      if (!sessionStorage.getItem("authRetried")) {
        sessionStorage.setItem("authRetried", "1");
        location.reload();
        return;
      }
    }
    if (st.authed) sessionStorage.removeItem("authRetried");
    if (st.authed) { startApp(); }
    else { loadBrand().then(function () { showGate(!!st.needs_setup); }); }
  }).catch(function () {
    // 服务刚重启/网络抖动时状态查不到：不要当成"没设过密码"，
    // 否则会看到"设置账号密码"，设完又被要求登录（今天踩过）
    loadBrand().then(function () {
      showGate(localStorage.getItem("needsSetup") === "1");
    });
  });
})();
