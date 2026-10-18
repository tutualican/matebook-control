// ════════════════════════════════════════════════════════════
// MateBook Kontrol — eser sahibi: Alican Tutu  (mbk-alican-tutu)
// Bu proje Alican Tutu'ya aittir.
// ════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, execSync } = require('child_process');

const hw = process.platform === 'win32'
  ? require('./hw_win')
  : require('./hw_linux');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    backgroundColor: '#0b0b0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (process.env.MB_SMOKE === '1') {
      setTimeout(async () => {
        try {
          const info = await win.webContents.executeJavaScript(
            "document.getElementById('platform-pill').textContent + ' || hwOsd=' + document.body.dataset.hwosd + ' || LOG: ' + document.getElementById('log').textContent + ' || nav=' + document.querySelectorAll('.nav-item').length");
          console.log('SMOKE OK ' + info);
        } catch (e) { console.log('SMOKE ERR ' + e.message); }
        app.quit();
      }, 2500);
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => console.log('RENDER GONE ' + JSON.stringify(d)));
  win.webContents.on('console-message', (e, _level, message) => {
    console.log('RENDER LOG ' + (e && e.message !== undefined ? e.message : message));
  });
  win.on('closed', () => {
    if (osdWin && !osdWin.isDestroyed()) { try { osdWin.destroy(); } catch {} }
    win = null;
  });
}

// ────────────────────────────────────────────────────────────
// Kendi bilgi kartı (OSD) — Huawei HW OSD yoksa devreye girer
// ────────────────────────────────────────────────────────────
// Huawei PC Manager'ın "Performans/Dengeli moda geçildi" kartı HW OSD bileşeninden gelir.
// HW OSD kurulu OLMAYAN cihazlarda aynı hissi vermek için kendi şeffaf, tıklama-geçirgen
// üst penceremizi gösteriyoruz. (HW OSD varsa onunki kullanılır; çift kart olmaz.)
const HWOSD_PATHS = [
  'C:\\Program Files\\Huawei\\Huawei OSD\\OSD_Daemon.exe',
  'C:\\Program Files (x86)\\Huawei\\Huawei OSD\\OSD_Daemon.exe',
];
function hwOsdInstalled() {
  if (process.platform !== 'win32') return false;
  return HWOSD_PATHS.some((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
// HW OSD sürecinin/servisinin GERÇEKTEN çalışıp çalışmadığı. Kurulu ama durdurulmuşsa bizim kartımız devreye girer.
function hwOsdRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq OSD_Daemon.exe" /NH', { encoding: 'latin1', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (/osd_daemon\.exe/i.test(out)) return true;
  } catch {}
  try {
    const out2 = execSync('sc query HW_OSDServer', { encoding: 'latin1', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (/RUNNING/i.test(out2)) return true;
  } catch {}
  return false;
}
// Kartı biz mi göstereceğiz? Yalnızca HW OSD yoksa VEYA kullanıcı zorladıysa (MB_NO_HWOSD=1).
// Böylece uygulama HW OSD'den tamamen bağımsız çalışır: HW OSD yok/durmuşsa kendi kartımız çıkar.
function hasHuaweiOsd() {
  if (process.platform !== 'win32') return false;
  if (process.env.MB_NO_HWOSD === '1') return false;
  if (!hwOsdInstalled()) return false;
  return hwOsdRunning();
}

// Packaged uygulamada scripts/ app.asar ICINDE olamaz (PowerShell calistiramaz).
// asar yolu gorulunce her zaman app.asar.unpacked surumunu tercih et.
function scriptsDir() {
  let base = path.join(__dirname, 'scripts');
  if (base.includes('app.asar')) {
    const unpacked = base.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    if (fs.existsSync(unpacked)) base = unpacked;
  }
  return base;
}

let osdWin = null;
let osdTimer = null;

function ensureOsd() {
  if (osdWin && !osdWin.isDestroyed()) return osdWin;
  osdWin = new BrowserWindow({
    width: 372, height: 104, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  try { osdWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  osdWin.loadFile(path.join(__dirname, 'renderer', 'osd.html'));
  return osdWin;
}

function showOsd(payload = {}) {
  if (process.platform !== 'win32') return;
  const w = ensureOsd();
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const W = 372, H = 104, M = 24;
    w.setBounds({ x: wa.width - W - M, y: wa.height - H - M, width: W, height: H });
  } catch {}
  const data = {
    title: payload.title || '',
    subtitle: payload.subtitle || '',
    accent: payload.accent || '#f5a623',
    icon: payload.icon || '',
  };
  const js = `window.__osd && window.__osd(${JSON.stringify(data)})`;
  const paint = () => { try { w.webContents.executeJavaScript(js).catch(() => {}); } catch {} };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', paint);
  else paint();
  try { w.showInactive(); } catch {}
  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = setTimeout(() => { if (osdWin && !osdWin.isDestroyed()) { try { osdWin.hide(); } catch {} } }, 2800);
}

// ────────────────────────────────────────────────────────────
// Global kisayol: Ctrl+Alt+Q ile mod dongusu (Dengeli -> Performans -> Enerji)
// ────────────────────────────────────────────────────────────
// OS kabuk eylemi olmayan, olcumde bos cikan bir kombinasyon secildi (bkz. CHANGELOG).
const HOTKEY = 'Control+Alt+Q';

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Renderer'a haber ver; mod degisimini + OSD kartini renderer'daki applyFull yonetir.
  const ok = globalShortcut.register(HOTKEY, () => {
    if (win && !win.isDestroyed()) win.webContents.send('hotkey:cycle');
  });
  if (!ok) console.log('HOTKEY: ' + HOTKEY + ' kaydedilemedi (baska uygulama tutuyor olabilir)');
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- pencere kontrolleri ----
ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('win:close', () => win && win.close());

// ---- ortam bilgisi ----
ipcMain.handle('env', () => ({
  platform: process.platform,
  arch: process.arch,
  fancy: hw.caps(),
  isWindows: process.platform === 'win32',
  hwOsd: hasHuaweiOsd(),
}));

// ---- kendi bilgi kartı (OSD) ----
ipcMain.handle('osd:show', (_, p) => { showOsd(p || {}); return { ok: true }; });

// ---- baslatma ----
ipcMain.handle('hw:init', async () => {
  try {
    return await hw.init({ appPath: __dirname });
  } catch (e) {
    return { ok: false, needAdmin: false, msg: String(e.message || e) };
  }
});

ipcMain.handle('hw:status', async () => {
  try { return { ok: true, data: await hw.status() }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:systemInfo', async () => {
  try { return { ok: true, data: await hw.systemInfo() }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:socCondition', async () => {
  try { return { ok: true, data: await hw.socCondition() }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setMode', async (_, m) => {
  try { return { ok: true, data: await hw.setMode(m) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setPerf', async (_, m) => {
  try { return { ok: true, data: await hw.setPerf(m) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setBoost', async (_, v) => {
  try { return { ok: true, data: await hw.setBoost(v) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setTurbo', async (_, b) => {
  try { return { ok: true, data: await hw.setTurbo(b) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setThermal', async (_, p) => {
  try { return { ok: true, data: await hw.setThermal(p) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setSmartChargeOn', async () => {
  try { return { ok: true, data: await hw.setSmartChargeOn() }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setChargeLimit', async (_, c) => {
  try { return { ok: true, data: await hw.setChargeLimit(c) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setChargeThreshold', async (_, lo, hi) => {
  try { return { ok: true, data: await hw.setChargeThreshold(lo, hi) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:setResumeCharging', async (_, b) => {
  try { return { ok: true, data: await hw.setResumeCharging(b) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:raw', async (_, hex) => {
  try { return { ok: true, data: await hw.raw(hex) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('hw:profile', async (_, name) => {
  try { return { ok: true, data: await hw.applyProfile(name) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// Tam profil: WMI mod + performance-mode + turbo + Windows güç planı + doğrulama
// (Linux'ta hw_linux.applyFull: platform_profile + CPU governor/EPP + doğrulama)
ipcMain.handle('hw:applyFull', async (_, name, opts) => {
  try {
    return await hw.applyFull(name, opts || {});
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// ---- ses surucusu asamasi (yalnizca Windows) ----
ipcMain.handle('audio:run', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Ses surucusu asamasi yalnizca Windows icin gecerlidir.' };
  const script = path.join(scriptsDir(), 'AudioDriverStage.ps1');
  if (!fs.existsSync(script)) {
    return { ok: false, error: 'AudioDriverStage.ps1 bulunamadi: ' + script };
  }
  return new Promise((resolve) => {
    const ps = `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script.replace(/'/g, "''")}'`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], (err) => {
      if (err) resolve({ ok: false, error: String(err.message) });
      else resolve({ ok: true, message: 'Ses surucusu asamasi yonetici olarak baslatildi. Once geri yukleme noktasi olusturulur, sonra Huawei resmi kanali acilir.' });
    });
  });
});

ipcMain.handle('audio:reveal', async () => {
  const script = path.join(scriptsDir(), 'AudioDriverStage.ps1');
  if (fs.existsSync(script)) shell.showItemInFolder(script);
  else shell.openPath(scriptsDir());
  return { ok: true };
});

// ---- yönetici olarak yeniden başlat (Windows: UAC, Linux: pkexec) ----
ipcMain.handle('app:relaunchAdmin', async () => {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const exe = process.execPath;
      const args = process.argv.slice(1).filter((a) => !a.startsWith('--') && !a.startsWith('MB_'));
      const argPart = args.length
        ? ' -ArgumentList ' + args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
        : '';
      const ps = `Start-Process -FilePath '${exe.replace(/'/g, "''")}'${argPart} -Verb RunAs`;
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], (err) => {
        if (!err) { app.quit(); resolve({ ok: true }); }
        else resolve({ ok: false, error: String(err.message) });
      });
    });
  }

  // Linux: pkexec ile root olarak yeniden başlat (sandbox kapatılır)
  const fs = require('fs');
  const pkexec = ['/usr/bin/pkexec', '/usr/local/bin/pkexec'].find((p) => fs.existsSync(p));
  if (!pkexec) return { ok: false, error: 'pkexec bulunamadı (polkit kurun)' };
  return new Promise((resolve) => {
    const args = process.argv.slice(1).filter((a) => !a.startsWith('--')).concat(['--no-sandbox']);
    execFile(pkexec, [process.execPath, ...args], (err) => {
      if (!err) { app.quit(); resolve({ ok: true }); }
      else resolve({ ok: false, error: String(err.message) });
    });
  });
});
