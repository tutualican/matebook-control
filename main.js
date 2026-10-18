// ════════════════════════════════════════════════════════════
// MateBook Kontrol — eser sahibi: Alican Tutu  (mbk-alican-tutu)
// Bu proje Alican Tutu'ya aittir.
// ════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync, execSync } = require('child_process');

const hw = process.platform === 'win32'
  ? require('./hw_win')
  : require('./hw_linux');

// Tek örnek kilidi: ikinci kopya açılırsa tepsi ikonu ve global kısayol çakışır.
// İkinci kopya doğrudan çıkar; birincil pencereyi öne getirir.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

let win = null;
let tray = null;
let isQuitting = false;   // tepsi "Çıkış" gerçekten kapatana kadar pencere sadece gizlenir

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
  win.webContents.on('console-message', (event) => {
    const msg = (event && event.message !== undefined) ? event.message : '';
    console.log('RENDER LOG ' + msg);
  });
  // Kapatma → tepsiye küçül (uygulama + global kısayol arka planda çalışmaya devam eder).
  win.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); try { win.hide(); } catch {} }
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
// Tepsi (tray) + oturum açılışında başlatma
// ────────────────────────────────────────────────────────────
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  try { win.show(); win.focus(); } catch {}
}

function sendSetMode(name) {
  if (win && !win.isDestroyed()) win.webContents.send('tray:setMode', name);
}

// Otomatik başlatma hedefi: paketli (portable) sürümde asıl .exe yolu, değilse process.execPath.
function autostartTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}
const AUTOSTART_TASK = 'MateBookKontrol';
function autostartLinuxFile() {
  return path.join(process.env.HOME || '', '.config', 'autostart', 'matebook-control.desktop');
}
function isAutostartEnabled() {
  if (process.platform === 'win32') {
    try { execFileSync('schtasks', ['/Query', '/TN', AUTOSTART_TASK], { timeout: 6000, stdio: 'ignore' }); return true; }
    catch { return false; }
  }
  if (process.platform === 'linux') {
    try { return fs.existsSync(autostartLinuxFile()); } catch { return false; }
  }
  return false;
}
function toggleAutostart(on) {
  try {
    if (process.platform === 'win32') {
      if (on) {
        // Yönetici olarak, UAC'siz, oturum açılışında başlat.
        execFileSync('schtasks', ['/Create', '/TN', AUTOSTART_TASK, '/TR', '"' + autostartTarget() + '"', '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/F'], { timeout: 12000, stdio: 'ignore' });
      } else {
        execFileSync('schtasks', ['/Delete', '/TN', AUTOSTART_TASK, '/F'], { timeout: 12000, stdio: 'ignore' });
      }
    } else if (process.platform === 'linux') {
      const f = autostartLinuxFile();
      if (on) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '[Desktop Entry]\nType=Application\nName=MateBook Kontrol\nComment=Huawei MateBook control center\nExec="' + process.execPath + '"\nX-GNOME-Autostart-enabled=true\nTerminal=false\n');
      } else {
        try { fs.unlinkSync(f); } catch {}
      }
    } else {
      return { ok: false, error: 'Bu platformda desteklenmiyor', enabled: false };
    }
    return { ok: true, enabled: isAutostartEnabled() };
  } catch (e) {
    const raw = String((e && e.stderr && e.stderr.toString()) || (e && e.message) || e);
    const friendly = /erişim engellendi|access is denied|erisim engellendi/i.test(raw)
      ? 'Yönetici izni gerekli. Uygulamayı yönetici olarak çalıştırın ("Yönetici olarak yeniden başlat").'
      : raw;
    return { ok: false, error: friendly, enabled: isAutostartEnabled() };
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const items = [
    { label: 'Pencereyi Aç', click: showWindow },
    { type: 'separator' },
    { label: 'Çalışma Modu', enabled: false },
    { label: 'Dengeli', click: () => sendSetMode('balanced') },
    { label: 'Performans', click: () => sendSetMode('perf') },
    { label: 'Enerji Tasarrufu', click: () => sendSetMode('eco') },
    { type: 'separator' },
  ];
  if (process.platform === 'win32' || process.platform === 'linux') {
    items.push({
      label: 'Oturum açılışında başlat (yönetici)',
      type: 'checkbox',
      checked: isAutostartEnabled(),
      click: (mi) => {
        const r = toggleAutostart(mi.checked);
        if (!r.ok) console.log('AUTOSTART ERR ' + r.error);
        rebuildTrayMenu();
      },
    });
  }
  items.push({ label: 'Kısayol: Ctrl+Alt+Q', enabled: false });
  items.push({ type: 'separator' });
  items.push({ label: 'Çıkış', click: () => { isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  if (tray) return;
  let img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray@2x.png'));
  try {
    tray = new Tray(img);
  } catch (e) { console.log('TRAY ERR ' + e.message); return; }
  tray.setToolTip('MateBook Kontrol — Ctrl+Alt+Q ile mod değiştir');
  rebuildTrayMenu();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// ────────────────────────────────────────────────────────────
// Global kisayol: Ctrl+Alt+Q ile mod dongusu (Dengeli -> Performans -> Enerji)
// ────────────────────────────────────────────────────────────
// OS kabuk eylemi olmayan, olcumde bos cikan bir kombinasyon secildi (bkz. CHANGELOG).
const HOTKEY = 'Control+Alt+Q';

app.whenReady().then(() => {
  if (!gotTheLock) return;
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
  // Renderer'a haber ver; mod degisimini + OSD kartini renderer'daki applyFull yonetir.
  const ok = globalShortcut.register(HOTKEY, () => {
    if (win && !win.isDestroyed()) win.webContents.send('hotkey:cycle');
  });
  if (!ok) console.log('HOTKEY: ' + HOTKEY + ' kaydedilemedi (baska uygulama tutuyor olabilir)');
});

app.on('before-quit', () => { isQuitting = true; });

// İkinci kopya açılmaya çalışılırsa mevcut pencereyi öne getir.
app.on('second-instance', () => { showWindow(); });

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});

app.on('window-all-closed', () => {
  // Tepsi modu: pencere kapansa da uygulama arka planda (kisayol icin) calismaya devam eder.
  if (process.platform === 'darwin') return;
  // Gercek cikis tepsideki "Cikis" veya before-quit ile yapilir.
});

// ---- pencere kontrolleri ----
ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('win:close', () => win && win.close());

// ---- tepsi / uygulama kontrolü ----
ipcMain.handle('app:show', () => { showWindow(); return { ok: true }; });
ipcMain.handle('app:quit', () => { isQuitting = true; app.quit(); return { ok: true }; });
ipcMain.handle('autostart:get', () => ({
  supported: process.platform === 'win32' || process.platform === 'linux',
  enabled: isAutostartEnabled(),
}));
ipcMain.handle('autostart:set', (_, on) => { const r = toggleAutostart(!!on); rebuildTrayMenu(); return r; });

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
