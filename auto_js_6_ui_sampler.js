/**
 * AutoJs6 UI 取样器（点选/框选 → 截图 + 控件候选 + 代码生成）
 * —— 适配“AutoJs6”  ——
 *
 * ✅ 解决：悬浮窗输入框不弹键盘/不出复制粘贴
 *    - 悬浮窗里不再放 input
 *    - 采集完成后用 dialogs.rawInput() 弹出系统输入弹窗（能弹输入法/能长按复制粘贴）
 *
 * ✅ 流程：
 *    1) 点“点选/框选” → 先采集到临时目录
 *    2) 采集完成后弹出“采集名”输入弹窗
 *    3) 未填写/取消 → 不输出到 Documents（直接丢弃临时数据）
 *    4) 采集名已存在 → 重新输入（不自动改名）
 *
 * ✅ 界面：
 *    - 背景不透明（更清楚）
 *    - 点“点选/框选”时自动缩小（最小化）
 *
 * ✅ 日志：
 *    - 关键操作全打日志（点选/框选/截图/写文件/弹窗/保存/打开方式…）
 *
 * 输出目录：/storage/emulated/0/Documents/AutoJs6_UI_Sampler/<采集名>/
 */

// ====== 配置 ======
var CFG = {
  outRoot: "/storage/emulated/0/Documents/AutoJs6_UI_Sampler",
  pointCropSize: 260,
  findTimeout: 2000,
  treeRetry: 3,
  treeRetryInterval: 220,
  hideDelayBeforeCapture: 180,
  dumpAllNodes: false,
  maxNameTry: 5,
  autoMinimizeOnSelect: true
};

// ====== Android 类 ======
importClass(android.view.View);
importClass(android.view.MotionEvent);
importClass(android.graphics.Color);
importClass(android.graphics.drawable.GradientDrawable);
importClass(java.io.File);

// ====== 日志（尽量贴近你看到的格式） ======
function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
function pad3(n) { n = String(n); while (n.length < 3) n = "0" + n; return n; }
function ts() {
  var d = new Date();
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + "." + pad3(d.getMilliseconds());
}
function logV(msg) { console.verbose(ts() + "/V: " + msg); }
function logI(msg) { console.log(ts() + "/I: " + msg); }
function logW(msg) { console.warn(ts() + "/W: " + msg); }
function logE(msg) { console.error(ts() + "/E: " + msg); }

// ====== 小工具 ======
function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
function safeCall(obj, name, args) {
  try {
    if (obj && obj[name] && typeof obj[name] === "function") return obj[name].apply(obj, args || []);
  } catch (e) {}
  return null;
}
function runUi(fn) {
  // 兼容：本脚本不使用 "ui"; 但部分版本仍存在 ui.run
  try {
    if (typeof ui !== "undefined" && ui && typeof ui.run === "function") ui.run(fn);
    else fn();
  } catch (e) {
    try { fn(); } catch (e2) {}
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function normalizeRect(r) {
  if (r.x != null && r.y != null && r.w != null && r.h != null) {
    var x0 = clamp(Math.round(r.x), 0, device.width - 1);
    var y0 = clamp(Math.round(r.y), 0, device.height - 1);
    var w0 = clamp(Math.round(r.w), 1, device.width - x0);
    var h0 = clamp(Math.round(r.h), 1, device.height - y0);
    return { x: x0, y: y0, w: w0, h: h0 };
  }
  var x1 = clamp(Math.round(r.x1), 0, device.width - 1);
  var y1 = clamp(Math.round(r.y1), 0, device.height - 1);
  var x2 = clamp(Math.round(r.x2), 0, device.width - 1);
  var y2 = clamp(Math.round(r.y2), 0, device.height - 1);
  var left = Math.min(x1, x2);
  var top = Math.min(y1, y2);
  var w = Math.max(1, Math.abs(x2 - x1));
  var h = Math.max(1, Math.abs(y2 - y1));
  return { x: left, y: top, w: w, h: h };
}

function makePointCropRect(x, y, size) {
  var half = Math.floor(size / 2);
  var left = clamp(x - half, 0, device.width - 1);
  var top = clamp(y - half, 0, device.height - 1);
  var right = clamp(x + half, 1, device.width);
  var bottom = clamp(y + half, 1, device.height);
  var w = Math.max(1, right - left);
  var h = Math.max(1, bottom - top);
  if (left + w > device.width) left = device.width - w;
  if (top + h > device.height) top = device.height - h;
  return { x: left, y: top, w: w, h: h };
}

function ensureDirHard(dir) {
  // AutoJs 的 ensureDir 通常是“确保父目录存在”，所以传一个文件路径最稳
  try {
    files.ensureDir(dir + "/.keep");
    if (!files.exists(dir)) {
      try {
        files.createWithDirs(dir + "/.keep");
        files.remove(dir + "/.keep");
      } catch (e2) {}
    }
  } catch (e) {}
}

function deleteDirRecursive(path) {
  try {
    var f = new File(path);
    if (!f.exists()) return;
    if (f.isFile()) { f.delete(); return; }
    var list = f.listFiles();
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.isDirectory()) deleteDirRecursive(c.getAbsolutePath());
        else c.delete();
      }
    }
    f.delete();
  } catch (e) {}
}

function copyDirRecursive(src, dst) {
  ensureDirHard(dst);
  var sf = new File(src);
  var list = sf.listFiles();
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    var name = String(f.getName());
    var sp = f.getAbsolutePath();
    var dp = dst + "/" + name;
    if (f.isDirectory()) copyDirRecursive(sp, dp);
    else {
      try {
        files.copy(sp, dp);
      } catch (e) {
        try { files.writeBytes(dp, files.readBytes(sp)); }
        catch (e2) { throw e2; }
      }
    }
  }
}

function sanitizeName(name) {
  if (name == null) return "";
  name = String(name).trim();
  if (!name) return "";
  name = name.replace(/[\\/:*?\"<>|]/g, "_");
  if (name.length > 60) name = name.substring(0, 60);
  return name.trim();
}

function getTempRoot() {
  var p = safe(function () { return context.getCacheDir().getAbsolutePath(); }, null);
  if (!p) p = "/data/local/tmp";
  var dir = p + "/autojs6_ui_sampler_tmp";
  ensureDirHard(dir);
  try {
    var test = dir + "/.__test__";
    files.write(test, "ok");
    files.remove(test);
    return dir;
  } catch (e) {
    var cwd = safe(function () { return files.cwd(); }, "/storage/emulated/0/");
    dir = cwd + "/.ui_sampler_tmp";
    ensureDirHard(dir);
    return dir;
  }
}

function retry(fn, times, interval) {
  var lastErr = null;
  for (var i = 0; i < times; i++) {
    try {
      var res = fn();
      if (res != null) return res;
    } catch (e) {
      lastErr = e;
    }
    sleep(interval);
  }
  if (lastErr) logW("retry 最后一次错误：" + lastErr);
  return [];
}

// ====== 状态 ======
var STATE = {
  accReady: false,
  capReady: false,
  initStarted: false,
  minimized: false,
  pending: null, // { tempDir, meta, ranked }
  lastSavedDir: ""
};

// ====== UI 美化（不透明背景） ======
function makeCardDrawable() {
  var gd = new GradientDrawable();
  // 255 不透明
  gd.setColor(Color.argb(255, 32, 34, 40));
  gd.setCornerRadius(28);
  gd.setStroke(2, Color.argb(255, 90, 92, 102));
  return gd;
}
function makeChipDrawable(ok) {
  var gd = new GradientDrawable();
  gd.setCornerRadius(18);
  gd.setColor(ok ? Color.argb(255, 0, 200, 83) : Color.argb(255, 255, 82, 82));
  return gd;
}

// ====== 悬浮窗（不再包含 input） ======
logI("脚本启动：UI 取样器（弹窗命名 + 自动缩小 + 全程日志）");
logI("输出根目录：" + CFG.outRoot);
ensureDirHard(CFG.outRoot);

var ctrl = floaty.window(
  <frame id="card" padding="0">
    <vertical padding="14">
      <horizontal id="header" gravity="center_vertical">
        <text id="title" text="UI 取样器" textColor="#FFFFFF" textSize="16sp" />
        <frame w="8" h="8" marginLeft="8" />
        <text id="badge" text="INIT" textColor="#FFFFFF" textSize="11sp" padding="6 3" />
        <frame w="0" h="1" layout_weight="1" />
        <text id="min" text="—" textColor="#DDDDDD" textSize="18sp" padding="10 0" />
      </horizontal>

      <text id="status" text="初始化中…(无障碍/截图权限)" textColor="#E0E0E0" textSize="12sp" marginTop="8" />

      <horizontal id="row1" marginTop="10">
        <button id="btnPoint" text="点选" w="0" layout_weight="1" />
        <button id="btnRect" text="框选" w="0" layout_weight="1" marginLeft="8" />
      </horizontal>

      <horizontal id="row2" marginTop="8">
        <button id="btnReCap" text="重请求截图" w="0" layout_weight="1" />
        <button id="btnOpen" text="打开结果" w="0" layout_weight="1" marginLeft="8" />
      </horizontal>

      <horizontal id="row3" marginTop="8">
        <button id="btnExit" text="退出" w="*" />
      </horizontal>

      <text id="last" text="" textColor="#CFD8DC" textSize="11sp" marginTop="10" />
      <text id="rootHint" text="" textColor="#B39DDB" textSize="10sp" marginTop="6" />
    </vertical>
  </frame>
);

safeCall(ctrl, "setPosition", [30, 220]);
try { ctrl.card.setBackgroundDrawable(makeCardDrawable()); } catch (e0) {}
try { ctrl.badge.setBackgroundDrawable(makeChipDrawable(false)); } catch (e1) {}
try { ctrl.rootHint.setText("保存到：" + CFG.outRoot); } catch (e2) {}

function setBadge(ok, text) {
  try {
    ctrl.badge.setBackgroundDrawable(makeChipDrawable(!!ok));
    ctrl.badge.setText(text || (ok ? "OK" : "INIT"));
  } catch (e) {}
}

// ====== 拖动窗口 ======
(function enableDrag() {
  var downX = 0, downY = 0;
  var winX = 30, winY = 220;
  var dragging = false;
  ctrl.header.setOnTouchListener(function (v, e) {
    try {
      var action = e.getAction();
      var x = e.getRawX();
      var y = e.getRawY();
      if (action === MotionEvent.ACTION_DOWN) {
        dragging = true;
        downX = x; downY = y;
        winX = safe(function () { return ctrl.getX(); }, safe(function () { return ctrl.getWindowX(); }, 30));
        winY = safe(function () { return ctrl.getY(); }, safe(function () { return ctrl.getWindowY(); }, 220));
        return true;
      }
      if (action === MotionEvent.ACTION_MOVE && dragging) {
        var nx = Math.round(winX + (x - downX));
        var ny = Math.round(winY + (y - downY));
        safeCall(ctrl, "setPosition", [nx, ny]);
        return true;
      }
      if (action === MotionEvent.ACTION_UP || action === MotionEvent.ACTION_CANCEL) {
        dragging = false;
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  });
})();

function setMinimized(mini) {
  STATE.minimized = !!mini;
  runUi(function () {
    try {
      ctrl.row1.setVisibility(STATE.minimized ? View.GONE : View.VISIBLE);
      ctrl.row2.setVisibility(STATE.minimized ? View.GONE : View.VISIBLE);
      ctrl.row3.setVisibility(STATE.minimized ? View.GONE : View.VISIBLE);
      ctrl.last.setVisibility(STATE.minimized ? View.GONE : View.VISIBLE);
      ctrl.rootHint.setVisibility(STATE.minimized ? View.GONE : View.VISIBLE);
      ctrl.min.setText(STATE.minimized ? "+" : "—");
    } catch (e) {}
  });
}

ctrl.min.click(function () {
  logI("点击：最小化切换");
  setMinimized(!STATE.minimized);
});

function hideCtrl(hide) {
  runUi(function () {
    try { ctrl.card.setVisibility(hide ? View.GONE : View.VISIBLE); }
    catch (e) { try { ctrl.setVisibility(hide ? View.GONE : View.VISIBLE); } catch (e2) {} }
  });
}

function autoMinimizeForSelection() {
  if (!CFG.autoMinimizeOnSelect) return;
  setMinimized(true);
  // 放到上方角落不挡手势
  safeCall(ctrl, "setPosition", [20, 120]);
}

// ====== 按钮 ======
ctrl.btnPoint.click(function () {
  logI("点击：点选");
  if (!STATE.capReady) { toast("还没拿到截图权限，请先允许"); logW("点选被拦截：截图权限未就绪"); return; }
  if (!STATE.accReady) { toast("无障碍还没就绪，请先开启"); logW("点选被拦截：无障碍未就绪"); return; }
  autoMinimizeForSelection();
  try { ctrl.status.setText("点一下目标位置…"); } catch (e) {}
  startOverlay("point");
});

ctrl.btnRect.click(function () {
  logI("点击：框选");
  if (!STATE.capReady) { toast("还没拿到截图权限，请先允许"); logW("框选被拦截：截图权限未就绪"); return; }
  if (!STATE.accReady) { toast("无障碍还没就绪，请先开启"); logW("框选被拦截：无障碍未就绪"); return; }
  autoMinimizeForSelection();
  try { ctrl.status.setText("按住拖动框选区域…"); } catch (e) {}
  startOverlay("rect");
});

ctrl.btnReCap.click(function () {
  logI("点击：重请求截图权限");
  requestCapturePermissionAsync(false);
});

ctrl.btnOpen.click(function () {
  logI("点击：打开结果");
  if (!STATE.lastSavedDir) { toast("还没有保存过结果"); logW("打开结果失败：lastSavedDir 为空"); return; }
  openResultMenu(STATE.lastSavedDir);
});

ctrl.btnExit.click(function () {
  logI("点击：退出");
  try { ctrl.close(); } catch (e) {}
  exit();
});

// ====== 保活（放子线程） ======
threads.start(function () {
  while (true) sleep(1000);
});

// ====== 初始化 ======
bootstrapInit();

function bootstrapInit() {
  if (STATE.initStarted) return;
  STATE.initStarted = true;

  logI("初始化：检查无障碍");
  threads.start(function () {
    try {
      if (!auto.service) {
        runUi(function () {
          setBadge(false, "ACC?");
          try { ctrl.status.setText("请开启无障碍服务…(已打开设置)"); } catch (e0) {}
          toast("请开启无障碍服务（AutoJs6）");
          try { app.startActivity({ action: "android.settings.ACCESSIBILITY_SETTINGS" }); } catch (e2) {}
        });
      }
      try { auto.waitFor(); } catch (e3) {}
      STATE.accReady = !!auto.service;
      logI("无障碍状态：" + (STATE.accReady ? "READY" : "NOT READY"));
      runUi(function () {
        try {
          ctrl.status.setText(STATE.accReady ? "无障碍已就绪，等待截图权限…" : "无障碍未就绪（可能被系统拦截）");
        } catch (e4) {}
      });
    } catch (e5) {
      logW("无障碍初始化异常：" + e5);
    }
  });

  requestCapturePermissionAsync(false);
}

function requestCapturePermissionAsync(landscape) {
  runUi(function () {
    try { ctrl.status.setText("请求截图权限…请点允许"); } catch (e0) {}

    if (typeof requestScreenCaptureAsync === "function") {
      try {
        var p = requestScreenCaptureAsync(!!landscape);
        if (p && typeof p.then === "function") {
          p.then(function (ok) {
            STATE.capReady = !!ok;
            logI("截图权限结果：" + (STATE.capReady ? "READY" : "FAILED"));
            runUi(function () {
              if (STATE.capReady) {
                setBadge(true, "READY");
                try { ctrl.status.setText("初始化完成：可点选/框选"); } catch (e1) {}
              } else {
                setBadge(false, "CAPX");
                try { ctrl.status.setText("截图权限失败（点“重请求截图”重试）"); } catch (e2) {}
              }
            });
          }, function (err) {
            logW("requestScreenCaptureAsync 失败：" + err);
            STATE.capReady = false;
            runUi(function () {
              setBadge(false, "CAPX");
              try { ctrl.status.setText("截图权限失败（点“重请求截图”重试）"); } catch (e3) {}
            });
          });
        } else {
          STATE.capReady = !!p;
          logI("截图权限结果(非Promise)：" + (STATE.capReady ? "READY" : "FAILED"));
          if (STATE.capReady) {
            setBadge(true, "READY");
            try { ctrl.status.setText("初始化完成：可点选/框选"); } catch (e4) {}
          } else {
            setBadge(false, "CAPX");
            try { ctrl.status.setText("截图权限失败（点“重请求截图”重试）"); } catch (e5) {}
          }
        }
        return;
      } catch (e6) {
        logW("requestScreenCaptureAsync 调用异常：" + e6);
      }
    }

    // 兜底：子线程同步（不要在 UI 线程调用）
    threads.start(function () {
      var ok2 = false;
      try { ok2 = !!requestScreenCapture(!!landscape); } catch (e7) { logW("requestScreenCapture 异常：" + e7); }
      STATE.capReady = ok2;
      logI("截图权限结果(同步兜底)：" + (STATE.capReady ? "READY" : "FAILED"));
      runUi(function () {
        if (STATE.capReady) {
          setBadge(true, "READY");
          try { ctrl.status.setText("初始化完成：可点选/框选"); } catch (e8) {}
        } else {
          setBadge(false, "CAPX");
          try { ctrl.status.setText("截图权限失败（点“重请求截图”重试）"); } catch (e9) {}
        }
      });
    });
  });
}

// ====== Overlay 选择层 ======
function startOverlay(mode) {
  logV("Overlay 打开：" + mode);

  var overlay = floaty.rawWindow(
    <frame id="root" w="*" h="*" bg="#01000000">
      <frame id="rect" w="1" h="1" bg="#00000000" />
      <text id="hint" text="" textColor="#FFFFFF" textSize="14sp" padding="10" bg="#CC000000" />
    </frame>
  );

  safeCall(overlay, "setSize", [-1, -1]);
  safeCall(overlay, "setPosition", [0, 0]);

  var gd = new GradientDrawable();
  gd.setColor(Color.TRANSPARENT);
  gd.setStroke(4, Color.argb(255, 0, 229, 255));
  overlay.rect.setBackgroundDrawable(gd);

  overlay.hint.setText(mode === "point" ? "点一下目标位置" : "按住拖动框选区域");
  overlay.hint.setX(20);
  overlay.hint.setY(60);

  var sx = 0, sy = 0, ex = 0, ey = 0;
  var dragging = false;

  overlay.root.setOnTouchListener(function (v, e) {
    try {
      var action = e.getAction();
      var x = Math.round(e.getRawX());
      var y = Math.round(e.getRawY());

      if (mode === "point") {
        if (action === MotionEvent.ACTION_UP) {
          logI("点选位置：(" + x + ", " + y + ")");
          overlay.close();
          threads.start(function () { runCollectThenAskName("point", { x: x, y: y }); });
        }
        return true;
      }

      if (action === MotionEvent.ACTION_DOWN) {
        sx = x; sy = y; ex = x; ey = y;
        dragging = true;
        updateRectView(overlay.rect, sx, sy, ex, ey);
        return true;
      }

      if (action === MotionEvent.ACTION_MOVE && dragging) {
        ex = x; ey = y;
        updateRectView(overlay.rect, sx, sy, ex, ey);
        return true;
      }

      if (action === MotionEvent.ACTION_UP && dragging) {
        dragging = false;
        var rect = normalizeRect({ x1: sx, y1: sy, x2: ex, y2: ey });
        logI("框选区域：x=" + rect.x + " y=" + rect.y + " w=" + rect.w + " h=" + rect.h);
        overlay.close();
        threads.start(function () { runCollectThenAskName("rect", rect); });
        return true;
      }

      return true;
    } catch (err) {
      logE("Overlay 异常：" + err);
      try { overlay.close(); } catch (e2) {}
      toast("Overlay 异常：" + err);
      return true;
    }
  });
}

function updateRectView(view, x1, y1, x2, y2) {
  var l = Math.min(x1, x2);
  var t = Math.min(y1, y2);
  var r = Math.max(x1, x2);
  var b = Math.max(y1, y2);
  var w = Math.max(1, r - l);
  var h = Math.max(1, b - t);

  runUi(function () {
    try {
      view.setX(l);
      view.setY(t);
      var lp = view.getLayoutParams();
      lp.width = w;
      lp.height = h;
      view.setLayoutParams(lp);
    } catch (e) {}
  });
}

// ====== 采集：先到临时目录，然后弹窗要名字 ======
function runCollectThenAskName(mode, pointOrRect) {
  logI("开始采集（模式=" + mode + "）");

  // 上一份未处理就先丢弃
  if (STATE.pending && STATE.pending.tempDir) {
    logW("检测到未处理的上一份采集，先自动丢弃：" + STATE.pending.tempDir);
    discardPending("自动丢弃上一份未保存采集");
  }

  hideCtrl(true);
  sleep(CFG.hideDelayBeforeCapture);

  var rect;
  if (mode === "point") rect = makePointCropRect(pointOrRect.x, pointOrRect.y, CFG.pointCropSize);
  else rect = normalizeRect(pointOrRect);

  var tempDir = getTempRoot() + "/" + (new Date().toISOString().replace(/[:.]/g, "-"));
  ensureDirHard(tempDir);
  logV("临时目录：" + tempDir);

  var screenImg = captureScreen();
  try {
    ensureDirHard(tempDir);

    logV("保存 screen.png");
    images.save(screenImg, tempDir + "/screen.png");

    logV("裁剪 crop.png");
    var cropImg = images.clip(screenImg, rect.x, rect.y, rect.w, rect.h);
    images.save(cropImg, tempDir + "/crop.png");

    var cropBlack = isProbablyBlack(cropImg);
    try { cropImg.recycle(); } catch (e0) {}

    logV("采控件：" + (mode === "point" ? "按点" : "按框"));
    var rawNodes = (mode === "point")
      ? retry(function () { return pickNodesByPoint(pointOrRect.x, pointOrRect.y); }, CFG.treeRetry, CFG.treeRetryInterval)
      : retry(function () { return pickNodesByRect(rect); }, CFG.treeRetry, CFG.treeRetryInterval);

    logI("候选控件数量：" + (rawNodes ? rawNodes.length : 0));

    var allFlat = null;
    if (CFG.dumpAllNodes) {
      logV("dumpAllNodesFlat 开启：导出全量树（可能很大）");
      allFlat = retry(function () { return dumpAllNodesFlat(); }, CFG.treeRetry, CFG.treeRetryInterval);
    }

    var jsonNodes = buildNodeJsonList(rawNodes);
    var ranked = rankNodes(jsonNodes);
    var codeText = buildCodeText(ranked);

    var meta = {
      time: new Date().toISOString(),
      mode: mode,
      point: (mode === "point") ? pointOrRect : null,
      rect: rect,
      package: safe(function () { return currentPackage(); }, ""),
      activity: safe(function () { return currentActivity(); }, ""),
      device: {
        brand: device.brand,
        model: device.model,
        release: device.release,
        width: device.width,
        height: device.height,
        density: safe(function () { return context.getResources().getDisplayMetrics().density; }, null)
      },
      warnings: {
        cropProbablyBlack: cropBlack,
        emptyNodes: (!ranked || ranked.length === 0)
      }
    };

    logV("写入临时 meta/nodes/code");
    files.write(tempDir + "/meta.json", JSON.stringify(meta, null, 2));
    files.write(tempDir + "/nodes.json", JSON.stringify(ranked, null, 2));
    if (allFlat) files.write(tempDir + "/tree_flat.json", JSON.stringify(allFlat, null, 2));
    files.write(tempDir + "/code.txt", codeText);

    STATE.pending = { tempDir: tempDir, meta: meta, ranked: ranked };

    logI("采集完成：准备弹窗输入采集名");

  } catch (e2) {
    logE("采集失败：" + e2);
    toast("采集失败：" + e2);
    try { deleteDirRecursive(tempDir); } catch (e3) {}
    STATE.pending = null;
  } finally {
    try { screenImg.recycle(); } catch (e4) {}
    // 采集完先显示主窗（你要继续用），再弹命名窗
    hideCtrl(false);
    // 采集完成后默认恢复正常大小
    setMinimized(false);
  }

  if (STATE.pending && STATE.pending.tempDir) {
    // 你要求：命名弹窗独立，不要跟悬浮窗挤在一起
    threads.start(function () {
      promptNameAndSave();
    });
  }
}

function promptNameAndSave() {
  if (!STATE.pending || !STATE.pending.tempDir) {
    logW("命名弹窗：pending 为空，跳过");
    return;
  }

  // 命名时把悬浮窗先藏起来（你要求）
  logI("命名弹窗：隐藏悬浮窗");
  hideCtrl(true);

  try {
    var tryCount = 0;
    while (tryCount < CFG.maxNameTry) {
      tryCount++;

      logI("弹出采集名输入框（第 " + tryCount + " 次）");
      var raw = safe(function () { return dialogs.rawInput("采集名（必填）", ""); }, "");

      // Promise 兼容：如果返回 thenable，就等待
      if (raw && typeof raw.then === "function") {
        raw = waitThenable(raw);
      }

      // 取消/空
      if (raw == null) {
        toast("取消：不保存");
        logW("命名弹窗取消：丢弃临时采集");
        discardPending("用户取消命名");
        return;
      }

      var name = sanitizeName(raw);
      logI("输入采集名：" + JSON.stringify(raw) + " → " + JSON.stringify(name));

      if (!name) {
        toast("采集名必填：不保存");
        logW("未填写采集名：丢弃临时采集");
        discardPending("未填写采集名");
        return;
      }

      var outDir = CFG.outRoot + "/" + name;
      if (files.exists(outDir)) {
        toast("该采集名已存在，请换一个");
        logW("采集名已存在：" + outDir);
        continue; // 让你重新输入
      }

      // 保存
      doSavePendingTo(outDir);
      return;
    }

    toast("重试次数过多：已丢弃");
    logW("命名重试次数过多：丢弃临时采集");
    discardPending("命名重试次数过多");

  } catch (e) {
    logE("命名弹窗异常：" + e);
    toast("命名弹窗异常：" + e);
    discardPending("命名弹窗异常");
  } finally {
    // 弹窗结束后把悬浮窗再显示出来
    logI("命名弹窗结束：恢复悬浮窗");
    hideCtrl(false);
    setMinimized(false);
  }
}

// Rhino 环境里没有 await，就用阻塞等待 thenable（在子线程里等，不会卡 UI 线程）
function waitThenable(p) {
  var done = false;
  var value = null;
  var err = null;
  try {
    p.then(function (v) { done = true; value = v; }, function (e) { done = true; err = e; });
  } catch (e0) {
    return null;
  }
  var t0 = new Date().getTime();
  while (!done) {
    sleep(30);
    // 避免死等（30s）
    if (new Date().getTime() - t0 > 30000) {
      logW("等待 Promise 超时");
      return null;
    }
  }
  if (err) throw err;
  return value;
}

function doSavePendingTo(outDir) {
  if (!STATE.pending || !STATE.pending.tempDir) {
    toast("没有可保存的采集");
    logW("保存失败：pending 为空");
    return;
  }

  try {
    logI("创建输出目录：" + outDir);
    ensureDirHard(outDir);

    logI("复制临时数据 → 输出目录");
    copyDirRecursive(STATE.pending.tempDir, outDir);

    logV("清理临时目录：" + STATE.pending.tempDir);
    deleteDirRecursive(STATE.pending.tempDir);

    STATE.lastSavedDir = outDir;
    STATE.pending = null;

    toast("保存完成：" + outDir);
    logI("保存完成：" + outDir);

    runUi(function () {
      try {
        ctrl.last.setText("最近：" + outDir);
        ctrl.status.setText("已保存。可继续点选/框选");
      } catch (e) {}
    });

  } catch (e2) {
    logE("保存失败：" + e2);
    toast("保存失败：" + e2);
    // 保存失败不立刻丢弃，让你还能重试（但本版按你习惯：失败就丢弃，避免乱）
    discardPending("保存失败");
  }
}

function discardPending(reason) {
  reason = reason || "丢弃";
  if (!STATE.pending || !STATE.pending.tempDir) {
    logW("丢弃：pending 为空");
    return;
  }
  var td = STATE.pending.tempDir;
  STATE.pending = null;
  try {
    logI("丢弃采集（" + reason + "）：" + td);
    deleteDirRecursive(td);
  } catch (e) {
    logW("丢弃清理失败：" + e);
  }
  runUi(function () {
    try { ctrl.status.setText("未保存（已丢弃）。可继续点选/框选"); } catch (e1) {}
  });
}

// ====== 打开结果：多种方式（含 MT） ======
function openResultMenu(dir) {
  var items = [
    "复制路径到剪贴板",
    "系统文件管理器打开",
    "用 MT 管理器打开（先复制路径）"
  ];

  try {
    var idx = dialogs.select("打开结果", items);
    if (idx && typeof idx.then === "function") {
      idx.then(function (i) { handleOpenChoice(i, dir); });
    } else {
      handleOpenChoice(idx, dir);
    }
  } catch (e) {
    setClip(dir);
    toast("已复制路径：" + dir);
    logW("dialogs 不可用，已退化为复制路径");
  }
}

function handleOpenChoice(i, dir) {
  if (i == null || i < 0) return;

  if (i === 0) {
    setClip(dir);
    toast("已复制：" + dir);
    logI("已复制路径到剪贴板");
    return;
  }

  if (i === 1) {
    try {
      app.viewFile(dir);
      logI("系统方式打开：" + dir);
    } catch (e1) {
      setClip(dir);
      toast("系统无法直接打开目录，已复制路径");
      logW("系统打开失败，已复制路径：" + e1);
    }
    return;
  }

  if (i === 2) {
    setClip(dir);
    var pkgs = ["bin.mt.plus", "bin.mt.plus.canary", "bin.mt.plus.pro"];
    var launched = false;
    for (var k = 0; k < pkgs.length; k++) {
      var pkg = pkgs[k];
      if (app.isAppInstalled(pkg)) {
        app.launchPackage(pkg);
        launched = true;
        logI("已启动 MT 管理器：" + pkg + "（路径已复制）");
        toast("已打开 MT（路径已复制，可在地址栏粘贴）");
        break;
      }
    }
    if (!launched) {
      toast("未检测到 MT 管理器包名（已复制路径）");
      logW("未检测到 MT 包名，已复制路径");
    }
    return;
  }
}

// ====== 控件采集 / 排序 / 代码 ======
function pickNodesByPoint(x, y) {
  var col = boundsContains(x, y, x + 1, y + 1).find();
  return collectionToArray(col);
}

function pickNodesByRect(rect) {
  var r = normalizeRect(rect);
  var col = boundsInside(r.x, r.y, r.x + r.w, r.y + r.h).find();
  return collectionToArray(col);
}

function dumpAllNodesFlat() {
  var col = classNameMatches(/.*/).find();
  var arr = collectionToArray(col);
  return buildNodeJsonList(arr);
}

function collectionToArray(col) {
  if (!col) return [];
  try { if (typeof col.toArray === "function") return col.toArray(); } catch (e0) {}
  var out = [];
  try {
    var n = col.size ? col.size() : (col.length || 0);
    if (n && col.get) {
      for (var i = 0; i < n; i++) out.push(col.get(i));
      return out;
    }
  } catch (e1) {}
  try { if (Array.isArray(col)) return col; } catch (e2) {}
  try {
    var len = col.length;
    if (len) {
      for (var j = 0; j < len; j++) out.push(col[j]);
      return out;
    }
  } catch (e3) {}
  return out;
}

function buildNodeJsonList(nodes) {
  var arr = [];
  if (!nodes) nodes = [];
  for (var i = 0; i < nodes.length; i++) {
    var w = nodes[i];
    try {
      var b = w.bounds();
      var left = b.left, top = b.top, right = b.right, bottom = b.bottom;
      var cx = safe(function () { return w.centerX(); }, Math.floor((left + right) / 2));
      var cy = safe(function () { return w.centerY(); }, Math.floor((top + bottom) / 2));

      var j = {
        id: safe(function () { return w.id(); }, null),
        text: safe(function () { return w.text(); }, null),
        desc: safe(function () { return w.desc(); }, null),
        cls: safe(function () { return w.className(); }, null),
        pkg: safe(function () { return w.packageName(); }, null),
        clickable: safe(function () { return w.clickable(); }, null),
        enabled: safe(function () { return w.enabled(); }, null),
        visibleToUser: safe(function () { return w.visibleToUser(); }, null),
        depth: safe(function () { return w.depth(); }, null),
        bounds: { left: left, top: top, right: right, bottom: bottom },
        center: { x: cx, y: cy },
        area: Math.max(0, (right - left) * (bottom - top))
      };

      if (j.clickable === false) {
        var anc = findClickableAncestor(w, 6);
        if (anc) {
          var ab = anc.bounds();
          var al = ab.left, at = ab.top, ar = ab.right, ad = ab.bottom;
          j.clickableAncestor = {
            id: safe(function () { return anc.id(); }, null),
            text: safe(function () { return anc.text(); }, null),
            desc: safe(function () { return anc.desc(); }, null),
            cls: safe(function () { return anc.className(); }, null),
            clickable: safe(function () { return anc.clickable(); }, null),
            bounds: { left: al, top: at, right: ar, bottom: ad },
            center: {
              x: safe(function () { return anc.centerX(); }, Math.floor((al + ar) / 2)),
              y: safe(function () { return anc.centerY(); }, Math.floor((at + ad) / 2))
            }
          };
        }
      }
      arr.push(j);
    } catch (e) {}
  }

  var seen = {};
  var dedup = [];
  for (var k = 0; k < arr.length; k++) {
    var n2 = arr[k];
    var key = [
      n2.bounds.left, n2.bounds.top, n2.bounds.right, n2.bounds.bottom,
      n2.id || "", n2.text || "", n2.desc || "", n2.cls || ""
    ].join("|");
    if (seen[key]) continue;
    seen[key] = 1;
    dedup.push(n2);
  }
  return dedup;
}

function findClickableAncestor(w, maxUp) {
  var cur = w;
  for (var i = 0; i < maxUp; i++) {
    cur = safe(function () { return cur.parent(); }, null);
    if (!cur) return null;
    var c = safe(function () { return cur.clickable(); }, null);
    if (c === true) return cur;
  }
  return null;
}

function rankNodes(nodes) {
  var arr = (nodes || []).slice();
  for (var i = 0; i < arr.length; i++) {
    var n = arr[i];
    var score = 0;
    if (n.clickable) score += 1000;
    if (n.id) score += 250;
    if (n.text) score += 120;
    if (n.desc) score += 110;
    if (typeof n.depth === "number") score += n.depth * 12;
    if (typeof n.area === "number") score -= Math.min(600, Math.floor(n.area / 1200));
    n._score = score;
  }
  arr.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
  return arr;
}

function buildCodeText(nodes) {
  var lines = [];
  lines.push("// AutoJs6 点击代码候选（从更可能稳定的开始）");
  lines.push("// 注意：同名很多/动态列表时，优先用 id + bounds 约束");
  lines.push("");

  var max = Math.min(nodes.length, 12);
  for (var i = 0; i < max; i++) {
    var n = nodes[i];
    lines.push("// #" + (i + 1) + " score=" + n._score + " cls=" + (n.cls || "") + " clickable=" + n.clickable);

    var b = n.bounds;
    var cx = n.center.x;
    var cy = n.center.y;
    var xr = (cx / device.width).toFixed(6);
    var yr = (cy / device.height).toFixed(6);

    if (n.id) {
      lines.push("id(\"" + esc(n.id) + "\").boundsInside(" + b.left + ", " + b.top + ", " + b.right + ", " + b.bottom + ").findOne(" + CFG.findTimeout + ") && id(\"" + esc(n.id) + "\").boundsInside(" + b.left + ", " + b.top + ", " + b.right + ", " + b.bottom + ").findOne(" + CFG.findTimeout + ").clickBounds();");
      lines.push("id(\"" + esc(n.id) + "\").findOne(" + CFG.findTimeout + ") && id(\"" + esc(n.id) + "\").findOne(" + CFG.findTimeout + ").clickBounds();");
    }

    if (n.text) {
      lines.push("text(\"" + esc(n.text) + "\").boundsInside(" + b.left + ", " + b.top + ", " + b.right + ", " + b.bottom + ").findOne(" + CFG.findTimeout + ") && text(\"" + esc(n.text) + "\").boundsInside(" + b.left + ", " + b.top + ", " + b.right + ", " + b.bottom + ").findOne(" + CFG.findTimeout + ").click();");
      lines.push("text(\"" + esc(n.text) + "\").findOne(" + CFG.findTimeout + ") && text(\"" + esc(n.text) + "\").findOne(" + CFG.findTimeout + ").click();");
    }

    if (n.desc) {
      lines.push("desc(\"" + esc(n.desc) + "\").boundsInside(" + b.left + ", " + b.top + ", " + b.right + ", " + b.bottom + ").findOne(" + CFG.findTimeout + ") && desc(\"" + esc(n.desc) + "\").boundsInside(" + b.left + ", " + b.top + ", " + b.right + ", " + b.bottom + ").findOne(" + CFG.findTimeout + ").click();");
      lines.push("desc(\"" + esc(n.desc) + "\").findOne(" + CFG.findTimeout + ") && desc(\"" + esc(n.desc) + "\").findOne(" + CFG.findTimeout + ").click();");
    }

    if (n.clickable === false && n.clickableAncestor) {
      var a = n.clickableAncestor;
      var ab = a.bounds;
      lines.push("// 父级可点兜底：");
      if (a.id) lines.push("id(\"" + esc(a.id) + "\").boundsInside(" + ab.left + ", " + ab.top + ", " + ab.right + ", " + ab.bottom + ").findOne(" + CFG.findTimeout + ") && id(\"" + esc(a.id) + "\").boundsInside(" + ab.left + ", " + ab.top + ", " + ab.right + ", " + ab.bottom + ").findOne(" + CFG.findTimeout + ").clickBounds();");
      if (a.text) lines.push("text(\"" + esc(a.text) + "\").boundsInside(" + ab.left + ", " + ab.top + ", " + ab.right + ", " + ab.bottom + ").findOne(" + CFG.findTimeout + ") && text(\"" + esc(a.text) + "\").boundsInside(" + ab.left + ", " + ab.top + ", " + ab.right + ", " + ab.bottom + ").findOne(" + CFG.findTimeout + ").clickBounds();");
      if (a.desc) lines.push("desc(\"" + esc(a.desc) + "\").boundsInside(" + ab.left + ", " + ab.top + ", " + ab.right + ", " + ab.bottom + ").findOne(" + CFG.findTimeout + ") && desc(\"" + esc(a.desc) + "\").boundsInside(" + ab.left + ", " + ab.top + ", " + ab.right + ", " + ab.bottom + ").findOne(" + CFG.findTimeout + ").clickBounds();");
      lines.push("click(" + a.center.x + ", " + a.center.y + ");");
    }

    lines.push("click(" + cx + ", " + cy + "); // ratio x=" + xr + ", y=" + yr);
    lines.push("");
  }

  if (!nodes || nodes.length === 0) {
    lines.push("// 没采到控件：可能是 WebView/Canvas、无障碍没就绪、窗口切换瞬间、或系统限制");
    lines.push("// 建议：用坐标/找图（findImage）兜底；或重试采集");
  }

  return lines.join("\n");
}

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\n/g, "\\n");
}

function isProbablyBlack(img) {
  try {
    var w = img.getWidth();
    var h = img.getHeight();
    var samples = 20;
    var dark = 0;
    for (var i = 0; i < samples; i++) {
      var px = Math.floor((i + 1) * w / (samples + 1));
      var py = Math.floor((i + 1) * h / (samples + 1));
      var c = images.pixel(img, px, py);
      var rr = colors.red(c), gg = colors.green(c), bb = colors.blue(c);
      var lum = (rr + gg + bb) / 3;
      if (lum < 12) dark++;
    }
    return dark >= Math.floor(samples * 0.9);
  } catch (e) {
    return false;
  }
}
