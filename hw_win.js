// Windows backend: ACPI-WMI (OemWMIfun) + Windows güç planları + sistem telemetrisi.
// Protokol, Huawei PC Manager 14.0.7.310 icindeki WmiUtil.dll (HwSDK::BiosWmi::*) ile dogrulandi.
// Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
const { spawn, execFile } = require('child_process');
const path = require('path');

// ---------------------------------------------------------------------------
// ACPI-WMI komut tablosu (64 baytlik u8Input). Cikti: byte0 = durum (0 = OK).
// ---------------------------------------------------------------------------
const CMD = {
  GET_MODE:   () => [0x04, 0x10],                       // mod = out[1]
  SET_MODE:   (m) => [0x04, 0x11, m & 0xff],
  GET_PERF:   () => [0x04, 0x12],                       // perf = out[2] (out[1]==0 olmali)
  SET_PERF:   (m) => [0x04, 0x13, m & 0xff],
  GET_TURBO:  () => [0x04, 0x0e],                       // turbo = out[1]
  SET_TURBO:  (b) => [0x04, 0x0f, b ? 1 : 0],
  SET_BOOST:  (v) => [0x04, 0x16, v & 0xff],            // SetStartBoost
  GET_FAN:    (i) => [0x02, 0x08, i & 0xff],            // rpm = out[1] | out[2]<<8
  GET_TEMP:   (i) => [0x02, 0x02, i & 0xff],            // isaret=out[1], deger=out[2]
  GET_CHARGE: () => [0x03, 0x16],                       // mode=out[1], lower=out[3], upper=out[4]
  SMART_ON:   () => [0x03, 0x15, 0x04, 0x48, 0x41, 0x46],
  SET_LIMIT:  (c) => [0x03, 0x15, 0x01, 0x48, (c - 5) & 0xff, c & 0xff],
  SET_THRESH: (lo, hi) => [0x03, 0x10, lo & 0xff, hi & 0xff],
  GET_RESUME: () => [0x03, 0x13],
  SET_RESUME: (b) => [0x03, 0x12, b ? 1 : 0],
  SET_THERM:  (p) => [0x03, 0x18, p & 0xff],
  GET_ACDUR:  () => [0x03, 0x14],                       // out[1] | out[2]<<8
  GET_PROCHOT:() => [0x03, 0x17],
  GET_SOCCOND:(i) => [0x03, 0x0e, i & 0xff],
};

const MODE_NAME = { 0: 'Dengeli', 1: 'Performans', 2: 'Enerji Tasarrufu' };
const PERF_NAME = { 0: 'Varsayılan/0', 1: 'Performans/1', 2: 'Yüksek/2' };

// name -> WMI working mode (BIOS fan/termal profili)
const MODE_MAP = { balanced: 0, perf: 1, eco: 2 };
// name -> Performance-Mode değeri (PC Manager PerfCommonPlugin da bunu uygular)
const PERF_MAP = { balanced: 0, perf: 1, eco: 2 };

// ---------------------------------------------------------------------------
// Kalıcı PowerShell ACPI-WMI çalışanı (worker) — stdin'e hex satırı, stdout'a "OK/ERR"
// ---------------------------------------------------------------------------
let proc = null, buf = '', queue = [], readyResolve = null;

function onData(d) {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r$/, '').trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    if (line.startsWith('READY')) {
      const ok = line.includes('OK');
      const msg = line.slice(5).trim();
      if (readyResolve) { readyResolve({ ok, msg }); readyResolve = null; }
      continue;
    }
    const cb = queue.shift();
    if (cb) cb(line);
  }
}

function startWorker(workerPath) {
  return new Promise((resolve) => {
    readyResolve = resolve;
    proc = spawn('powershell.exe',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', workerPath],
      { windowsHide: true });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', onData);
    proc.stderr.on('data', () => {});
    proc.on('exit', () => {
      proc = null;
      // READY gelmeden kapanirsa init() sonsuza kadar beklemesin.
      if (readyResolve) { readyResolve({ ok: false, msg: 'ACPI-WMI çalışanı başlatılamadı (script yolu/izin?)' }); readyResolve = null; }
      const q = queue; queue = [];
      q.forEach((cb) => cb('ERR ACPI-WMI çalışanı kapandı'));
    });
  });
}

function send(line) {
  return new Promise((resolve, reject) => {
    if (!proc) return reject(new Error('ACPI-WMI bağlantısı yok (yönetici izni?)'));
    queue.push((resp) => resolve(resp));
    proc.stdin.write(line + '\n');
  });
}

function hexLine(bytes) {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');
}

async function invoke(bytes) {
  const resp = await send(hexLine(bytes));
  if (resp.startsWith('ERR')) throw new Error(resp.slice(4));
  const hex = resp.slice(3).trim();
  return hex.length ? hex.split(' ').map((h) => parseInt(h, 16)) : [];
}

// ---------------------------------------------------------------------------
// Yardımcı: powershell / powercfg çalıştırma
// ---------------------------------------------------------------------------
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '') + (stderr || '') }));
  });
}

function psCommand(script) {
  return run('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

async function psJson(script) {
  const r = await psCommand(script);
  const m = r.out.match(/@@JSON@@([\s\S]*?)@@END@@/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Sistem telemetrisi: AC/priz, pil, CPU saat hızı/yükü, aktif güç planı
// ---------------------------------------------------------------------------
async function systemInfo() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
# Node cikisi utf8 okur; JSON'u her zaman utf8 yaz.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
# powercfg ciktisini DOGRU cozmek icin gecici olarak OEM kod sayfasini kullan (ör. 857),
# sonra utf8'e geri don ki Turkce karakterler ("Güç tasarrufu") bozulmasin.
$oemCp = [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding($oemCp)
$plan = (powercfg /getactivescheme) 2>$null
[Console]::OutputEncoding = $utf8
$batt = Get-CimInstance Win32_Battery | Select-Object -First 1
$bs = Get-CimInstance -Namespace root/WMI -ClassName BatteryStatus | Select-Object -First 1
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$obj = [ordered]@{
  batteryStatus = if($batt){[int]$batt.BatteryStatus}else{$null}
  batteryPct    = if($batt){[int]$batt.EstimatedChargeRemaining}else{$null}
  powerOnline   = if($bs){[bool]$bs.PowerOnline}else{$null}
  cpuName       = if($cpu){$cpu.Name}else{$null}
  cpuCurMhz     = if($cpu){[int]$cpu.CurrentClockSpeed}else{$null}
  cpuMaxMhz     = if($cpu){[int]$cpu.MaxClockSpeed}else{$null}
  cpuLoad       = if($cpu){[int]$cpu.LoadPercentage}else{$null}
  powerPlan     = if($plan){("$plan").Trim()}else{$null}
}
"@@JSON@@" + ($obj | ConvertTo-Json -Compress) + "@@END@@"
`;
  const j = await psJson(script) || {};
  // BatteryStatus: 2 = AC'e bağlı, 1 = deşarj (pil)
  const onBattery = j.powerOnline === false || j.batteryStatus === 1;
  const onAc = j.powerOnline === true || j.batteryStatus === 2;
  return { ...j, onAc, onBattery };
}

// ---------------------------------------------------------------------------
// Güç planları
// ---------------------------------------------------------------------------
const SCHEMES = {
  perf: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',     // Yüksek performans
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e', // Dengeli
  eco: 'a1841308-3541-4fab-bc81-f71556f20b4a',      // Güç tasarrufu
};
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61'; // Ultimate Performance şablonu

async function ensureUltimate() {
  // Zaten var mı?
  const list = await run('powercfg', ['/list']);
  const idx = list.out.indexOf(ULTIMATE);
  if (idx >= 0) return ULTIMATE;
  const dup = await run('powercfg', ['-duplicatescheme', ULTIMATE]);
  const m = dup.out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

async function setSchemeIndex(alias, value) {
  await run('powercfg', ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', alias, String(value)]);
  await run('powercfg', ['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', alias, String(value)]);
}

// name: perf|balanced|eco ; opts.forceDc: pildeyken de agresif değerler
async function applyProfile(name, opts = {}) {
  const log = [];
  let scheme = SCHEMES[name] || SCHEMES.balanced;

  if (name === 'perf') {
    const ult = await ensureUltimate();
    if (ult) { scheme = ult; log.push('Ultimate Performance planı hazır'); }
  }
  const set = await run('powercfg', ['/setactive', scheme]);
  log.push(set.ok ? ('Güç planı seçildi (' + name + ')') : 'Güç planı seçilemedi');

  // Değerler (0-100 yüzde). PERFEPP düşük = performans, yüksek = enerji tasarrufu.
  let min = 5, max = 100, boost = 1, eppAc = 33, eppDc = 50;
  if (name === 'perf') { min = 100; max = 100; boost = 2; eppAc = 0; eppDc = opts.forceDc ? 0 : 50; }
  else if (name === 'eco') { min = 5; max = 50; boost = 0; eppAc = 100; eppDc = 100; }

  await setSchemeIndex('PROCTHROTTLEMIN', min);
  await setSchemeIndex('PROCTHROTTLEMAX', max);
  await setSchemeIndex('PERFBOOSTMODE', boost);
  // EPP'yi AC/DC ayrı ayarla
  await run('powercfg', ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', 'PERFEPP', String(eppAc)]);
  await run('powercfg', ['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_PROCESSOR', 'PERFEPP', String(eppDc)]);
  await run('powercfg', ['/setactive', 'SCHEME_CURRENT']);

  log.push(`İşlemci: min %${min}, max %${max}, boost ${boost}, EPP AC ${eppAc} / DC ${eppDc}`);
  if (name === 'perf' && opts.forceDc) log.push('⚡ Pil (DC) modunda da tam güç zorlandı');
  return log;
}

async function isAdmin() {
  const r = await psCommand('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
  return /true/i.test(r.out);
}

// ---------------------------------------------------------------------------
// ACPI-WMI okuma/yazma sarmalayıcıları
// ---------------------------------------------------------------------------
async function readStatus() {
  const out = {};
  try { const r = await invoke(CMD.GET_MODE()); out.mode = r[1]; out.modeName = MODE_NAME[r[1]] || ('Mod ' + r[1]); } catch (e) { out.modeErr = String(e.message || e); }
  try { const r = await invoke(CMD.GET_PERF()); if (r[1] === 0 && r[2] < 3) { out.perf = r[2]; out.perfName = PERF_NAME[r[2]] || String(r[2]); } } catch {}
  try { const r = await invoke(CMD.GET_TURBO()); out.turbo = r[1] === 1; } catch {}
  try { const r = await invoke(CMD.GET_FAN(0)); out.fan0 = r[1] | (r[2] << 8); } catch {}
  try { const r = await invoke(CMD.GET_FAN(1)); out.fan1 = r[1] | (r[2] << 8); } catch {}

  // Sıcaklık sensörleri (0..5): işaret=byte1, değer=byte2
  const temps = [];
  for (let i = 0; i < 6; i++) {
    try {
      const r = await invoke(CMD.GET_TEMP(i));
      if (r[0] === 0) {
        let v = r[2];
        if (r[1] === 1) v = -v;
        if (v > -40 && v < 130) temps.push({ i, c: v });
      }
    } catch {}
  }
  out.temps = temps;
  if (temps.length) out.temp = temps[0].c;

  try {
    const r = await invoke(CMD.GET_CHARGE());
    out.charge = { mode: r[1], lower: r[3], upper: r[4] };
  } catch {}
  try { const r = await invoke(CMD.GET_PROCHOT()); out.prochot = r[1] | (r[2] << 8); } catch {}
  return out;
}

// AC/DC koşulunu (string) oku — teşhis amaçlı
async function socCondition() {
  const bytes = [];
  for (let i = 0; i < 11; i++) {
    try {
      const r = await invoke(CMD.GET_SOCCOND(i));
      if (r[0] !== 0) break;
      if (r[1] === 0) break;
      bytes.push(r[1]);
    } catch { break; }
  }
  // byte1 = okunacak uzunluk; kalan baytlar ASCII olabilir
  return bytes;
}

// ---------------------------------------------------------------------------
// Ortak arayüz
// ---------------------------------------------------------------------------
module.exports = {
  platform: 'win32',
  MODE_NAME, PERF_NAME,

  async init(ctx) {
    const admin = await isAdmin();
    if (!admin) return { ok: false, needAdmin: true, msg: 'Yönetici izni yok — ACPI-WMI için gerekli.' };
    const fs = require('fs');
    let worker = path.join(ctx.appPath, 'scripts', 'wmi_worker.ps1');
    // Electron, app.asar icindeki dosyalari VARMIS gibi gosterir (existsSync true doner),
    // ama PowerShell asar icindeki dosyayi CALISTIRAMAZ. Bu yuzden asar yolu gorulunce
    // her zaman app.asar.unpacked surumunu tercih et.
    if (worker.includes('app.asar')) {
      const unpacked = worker.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      if (fs.existsSync(unpacked)) worker = unpacked;
    }
    if (!fs.existsSync(worker)) {
      return { ok: false, needAdmin: false, msg: 'wmi_worker.ps1 bulunamadı: ' + worker };
    }
    const r = await startWorker(worker);
    return { ok: r.ok, needAdmin: false, msg: r.msg || (r.ok ? 'ACPI-WMI bağlantısı kuruldu' : 'Bağlantı kurulamadı') };
  },

  status() { return readStatus(); },
  systemInfo,
  socCondition,

  async setMode(m) { return invoke(CMD.SET_MODE(m)); },
  async setPerf(m) { return invoke(CMD.SET_PERF(m)); },
  async setTurbo(b) { return invoke(CMD.SET_TURBO(b)); },
  async setBoost(v) { return invoke(CMD.SET_BOOST(v)); },
  async setThermal(p) { return invoke(CMD.SET_THERM(p)); },
  async setSmartChargeOn() { return invoke(CMD.SMART_ON()); },
  async setChargeLimit(c) { return invoke(CMD.SET_LIMIT(c)); },
  async setChargeThreshold(lo, hi) { return invoke(CMD.SET_THRESH(lo, hi)); },
  async setResumeCharging(b) { return invoke(CMD.SET_RESUME(b)); },
  async raw(hex) {
    const bytes = hex.trim().split(/[\s,]+/).filter(Boolean).map((h) => parseInt(h, 16));
    return invoke(bytes);
  },

  applyProfile,

  // Tam profil: WMI mod + performance-mode + turbo + Windows güç planı; her adım bağımsız,
  // önce/sonra geri-okuma ile doğrulanır.
  async applyFull(name, opts = {}) {
    const steps = [];
    const errors = [];
    const forceDc = !!opts.forceDc;

    let before = null, sysBefore = null;
    try { before = await readStatus(); } catch {}
    try { sysBefore = await systemInfo(); } catch {}

    // 1) BIOS çalışma modu
    try {
      await invoke(CMD.SET_MODE(MODE_MAP[name]));
      steps.push('BIOS çalışma modu → ' + (MODE_NAME[MODE_MAP[name]] || name));
    } catch (e) { errors.push('Çalışma modu: ' + (e.message || e)); }

    // 2) Performance-Mode
    try {
      await invoke(CMD.SET_PERF(PERF_MAP[name]));
      steps.push('Performance-Mode → ' + PERF_MAP[name]);
    } catch (e) { errors.push('Performance-Mode: ' + (e.message || e)); }

    // 3) Turbo — performans için AC'den bağımsız aç; dengeli/eko'da kapat.
    //    NOT: Huawei HW OSD servisi turbo değişimini dinlediği için, dengeli/eko'da da
    //    SET_TURBO gönderiyoruz; böylece "Dengeli moda geçildi" kartı da çıkar (PC Manager gibi).
    try {
      if (name === 'perf') { await invoke(CMD.SET_TURBO(true)); steps.push('Turbo (yüksek güç) → açık' + (forceDc ? ' [pil dahil]' : '')); }
      else { await invoke(CMD.SET_TURBO(false)); steps.push('Turbo → kapalı'); }
    } catch (e) { errors.push('Turbo: ' + (e.message || e)); }

    // 4) Windows güç planı + işlemci ayarları
    try {
      const pf = await applyProfile(name, { forceDc });
      steps.push(...pf);
    } catch (e) { errors.push('Güç planı: ' + (e.message || e)); }

    // Kısa bekleme + geri-okuma (doğrulama)
    await new Promise((r) => setTimeout(r, 900));
    let after = null, sysAfter = null;
    try { after = await readStatus(); } catch {}
    try { sysAfter = await systemInfo(); } catch {}

    return {
      ok: errors.length === 0 || steps.length > 1,
      steps, errors,
      before, after,
      sysBefore, sysAfter,
      verified: {
        modeChanged: before && after ? before.mode !== after.mode || after.mode === MODE_MAP[name] : null,
        turbo: after ? after.turbo : null,
      },
    };
  },

  isAdmin,
  caps() {
    return { fanSet: false, thermalPolicy: true, powerPlans: true, charge: true, platformProfile: false, acDcForce: true };
  },
};
