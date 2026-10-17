// Linux backend (Ubuntu / Fedora / Debian):
//   - ACPI platform_profile  -> BIOS çalışma modunun Linux karşılığı (varsa)
//   - cpufreq governor + EPP -> gözle görülür performans/enerji etkisi
//   - power-profiles-daemon  -> varsa onunla koordine (çakışmayı önler)
//   - hwmon                  -> fan devri + sıcaklık (okuma)
//   - huawei-wmi             -> batarya şarj sınırı
// Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
// Yazma işlemleri root ister; pkexec/sudo ile yetki yükseltilir (scripts/linux/priv-helper.sh).
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const PP = '/sys/firmware/acpi/platform_profile';
const PP_CHOICES = '/sys/firmware/acpi/platform_profile_choices';
// Yetki yardımcısı: satır-sonu/exec-bit sorunlarını önlemek için bash'e satır içi geçirilir.
// (Aynı içerik scripts/linux/priv-helper.sh olarak da bulunur.)
const HELPER_SH = String.raw`
PP=/sys/firmware/acpi/platform_profile
PPC=/sys/firmware/acpi/platform_profile_choices
profile=""; charge_lo=""; charge_hi=""; resume=0; nopp=0
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile="$2"; shift 2 ;;
    --charge)  charge_lo="$2"; charge_hi="$3"; shift 3 ;;
    --resume)  resume=1; shift ;;
    --no-pp)   nopp=1; shift ;;
    *) shift ;;
  esac
done
gov_for(){ case "$1" in perf) echo performance;; eco) echo powersave;; *) echo schedutil;; esac; }
epp_for(){ case "$1" in perf) echo performance;; eco) echo power;; *) echo balance_performance;; esac; }
pp_for(){ case "$1" in perf) echo performance;; eco) echo low-power;; *) echo balanced;; esac; }
if [ -n "$profile" ]; then
  if [ "$nopp" = 0 ] && [ -w "$PP" ]; then
    want="$(pp_for "$profile")"
    if [ -r "$PPC" ] && ! grep -qw "$want" "$PPC"; then
      if grep -qw quiet "$PPC"; then want=quiet; fi
    fi
    echo "$want" > "$PP" 2>/dev/null || true
    echo "platform_profile=$want"
  fi
  gov="$(gov_for "$profile")"; epp="$(epp_for "$profile")"; n=0; t=0
  for c in /sys/devices/system/cpu/cpu[0-9]*; do
    t=$((t+1))
    if [ -w "$c/cpufreq/scaling_governor" ]; then echo "$gov" > "$c/cpufreq/scaling_governor" 2>/dev/null && n=$((n+1)) || true; fi
    if [ -w "$c/cpufreq/energy_performance_preference" ]; then echo "$epp" > "$c/cpufreq/energy_performance_preference" 2>/dev/null || true; fi
  done
  echo "governor=$gov epp=$epp ($n/$t cpu)"
fi
if [ -n "$charge_lo" ] && [ -n "$charge_hi" ]; then
  for b in /sys/class/power_supply/BAT*; do
    [ -w "$b/charge_control_start_threshold" ] && echo "$charge_lo" > "$b/charge_control_start_threshold" 2>/dev/null || true
    [ -w "$b/charge_control_end_threshold" ] && echo "$charge_hi" > "$b/charge_control_end_threshold" 2>/dev/null || true
  done
  echo "charge=$charge_lo-$charge_hi"
fi
if [ "$resume" = 1 ]; then
  for b in /sys/class/power_supply/BAT*; do
    [ -w "$b/charge_control_start_threshold" ] && echo 0 > "$b/charge_control_start_threshold" 2>/dev/null || true
    [ -w "$b/charge_control_end_threshold" ] && echo 100 > "$b/charge_control_end_threshold" 2>/dev/null || true
  done
  echo "charge=resume"
fi
exit 0
`;

const PROFILES = {
  perf:     { pp: 'performance', gov: 'performance', epp: 'performance' },
  balanced: { pp: 'balanced',    gov: 'schedutil',   epp: 'balance_performance' },
  eco:      { pp: 'low-power',   gov: 'powersave',   epp: 'power' },
};
// platform_profile -> power-profiles-daemon profil adı
const PPD_MAP = { performance: 'performance', balanced: 'balanced', 'low-power': 'power-saver', quiet: 'power-saver' };

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function readFile(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } }

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout || '') + (stderr || ''), err }));
  });
}

function findBin(names) {
  for (const n of names) if (exists(n)) return n;
  return null;
}
const PPD_BIN = findBin(['/usr/bin/powerprofilesctl', '/usr/local/bin/powerprofilesctl']);

function isRoot() { return typeof process.getuid === 'function' && process.getuid() === 0; }

// Yazma işlemlerini root olarak çalıştır (yardımcı bash'e satır içi geçirilir -> +x/CRLF gerekmez)
async function runPriv(args) {
  const argv = ['-c', HELPER_SH, 'mbhelper', ...args];
  if (isRoot()) return run('bash', argv);
  const pkexec = findBin(['/usr/bin/pkexec', '/usr/local/bin/pkexec']);
  if (pkexec) return run(pkexec, ['bash', ...argv]);
  const sudo = findBin(['/usr/bin/sudo', '/bin/sudo']);
  if (sudo) return run(sudo, ['-n', 'bash', ...argv]);
  return { ok: false, out: 'Yetki yükseltme aracı yok (pkexec/sudo). Uygulamayı root olarak çalıştırın.' };
}

// ---- CPU ----
function listCpus() {
  const base = '/sys/devices/system/cpu';
  try { return fs.readdirSync(base).filter((d) => /^cpu\d+$/.test(d)).map((d) => `${base}/${d}`); }
  catch { return []; }
}
function cpuMhz() {
  let mx = 0;
  for (const c of listCpus()) {
    const v = parseInt(readFile(`${c}/cpufreq/scaling_cur_freq`) || '0', 10);
    if (v > mx) mx = v;
  }
  return mx ? Math.round(mx / 1000) : null;
}
function cpuMaxMhz() {
  for (const c of listCpus()) {
    const v = parseInt(readFile(`${c}/cpufreq/cpuinfo_max_freq`) || '0', 10);
    if (v) return Math.round(v / 1000);
  }
  return null;
}
function cpuName() {
  const t = readFile('/proc/cpuinfo') || '';
  const m = t.match(/model name\s*:\s*(.+)/);
  return m ? m[1].trim() : null;
}
let prevStat = null;
function cpuLoad() {
  const t = readFile('/proc/stat');
  if (!t) return null;
  const m = t.split('\n')[0].match(/^cpu\s+(.+)/);
  if (!m) return null;
  const p = m[1].trim().split(/\s+/).map(Number);
  const idle = (p[3] || 0) + (p[4] || 0);
  const total = p.reduce((a, b) => a + b, 0);
  let load = null;
  if (prevStat) {
    const dt = total - prevStat.total, di = idle - prevStat.idle;
    if (dt > 0) load = Math.max(0, Math.min(100, Math.round(100 * (dt - di) / dt)));
  }
  prevStat = { total, idle };
  return load;
}
function governor() {
  for (const c of listCpus()) { const g = readFile(`${c}/cpufreq/scaling_governor`); if (g) return g; }
  return null;
}

// ---- hwmon ----
function hwmonFans() {
  const fans = [];
  try {
    for (const h of fs.readdirSync('/sys/class/hwmon')) {
      const dir = `/sys/class/hwmon/${h}`;
      const name = readFile(`${dir}/name`) || h;
      for (const f of fs.readdirSync(dir)) {
        const m = f.match(/^fan(\d+)_input$/);
        if (m) { const v = readFile(`${dir}/${f}`); if (v !== null) fans.push({ name: `${name} fan${m[1]}`, rpm: parseInt(v, 10) }); }
      }
    }
  } catch {}
  return fans;
}
function hwmonTemps() {
  const temps = [];
  try {
    for (const h of fs.readdirSync('/sys/class/hwmon')) {
      const dir = `/sys/class/hwmon/${h}`;
      const name = readFile(`${dir}/name`) || h;
      for (const f of fs.readdirSync(dir)) {
        const m = f.match(/^temp(\d+)_input$/);
        if (m) {
          const v = readFile(`${dir}/${f}`);
          if (v !== null) {
            const c = parseInt(v, 10) / 1000;
            if (c > 0 && c < 130) {
              const label = readFile(`${dir}/temp${m[1]}_label`) || `temp${m[1]}`;
              temps.push({ i: parseInt(m[1], 10), name: `${name} ${label}`, c: Math.round(c) });
            }
          }
        }
      }
    }
  } catch {}
  return temps;
}

// ---- batarya / güç ----
function batteryDir() {
  const base = '/sys/class/power_supply';
  try {
    const list = fs.readdirSync(base);
    for (const d of list) if (/^BAT/.test(d) && exists(`${base}/${d}/charge_control_end_threshold`)) return `${base}/${d}`;
    for (const d of list) if (/^BAT/.test(d)) return `${base}/${d}`;
  } catch {}
  return null;
}
function acOnline() {
  const base = '/sys/class/power_supply';
  try {
    for (const d of fs.readdirSync(base)) {
      if (/^(AC|ACAD|ADP|AC0)/i.test(d)) {
        const on = readFile(`${base}/${d}/online`);
        if (on !== null) return on === '1';
      }
    }
  } catch {}
  return null;
}

function platformProfile() { return exists(PP) ? readFile(PP) : null; }

async function readStatus() {
  const out = { platform: 'linux' };
  const pp = platformProfile();
  if (pp) { out.modeName = pp; out.pp = pp; }
  out.gov = governor();
  const fans = hwmonFans();
  out.fans = fans;
  out.fan0 = fans.length ? fans[0].rpm : undefined;
  out.fan1 = fans.length > 1 ? fans[1].rpm : undefined;
  out.temps = hwmonTemps();
  if (out.temps.length) out.temp = out.temps[0].c;

  const bat = batteryDir();
  if (bat) {
    out.charge = {
      mode: null,
      lower: parseInt(readFile(`${bat}/charge_control_start_threshold`) || '0', 10) || 0,
      upper: parseInt(readFile(`${bat}/charge_control_end_threshold`) || '100', 10) || 100,
      capacity: readFile(`${bat}/capacity`),
      status: readFile(`${bat}/status`),
      batPath: bat,
    };
  }
  return out;
}

async function systemInfo() {
  const onAcVal = acOnline();
  const bat = batteryDir();
  const status = bat ? readFile(`${bat}/status`) : null;
  const pct = bat ? parseInt(readFile(`${bat}/capacity`) || 'NaN', 10) : null;
  const onBattery = onAcVal === false || status === 'Discharging';
  const onAc = onAcVal === true || status === 'Charging' || status === 'Full';
  const pp = platformProfile();
  return {
    onAc, onBattery,
    batteryPct: Number.isNaN(pct) ? null : pct,
    batteryStatus: status,
    cpuName: cpuName(),
    cpuCurMhz: cpuMhz(),
    cpuMaxMhz: cpuMaxMhz(),
    cpuLoad: cpuLoad(),
    powerPlan: [pp, governor()].filter(Boolean).join(' / ') || null,
    kernel: os.release(),
  };
}

// platform_profile yazımı: PPD varsa onunla, yoksa sysfs (root) ile
async function setPlatformProfile(ppValue) {
  if (PPD_BIN) {
    const name = PPD_MAP[ppValue] || 'balanced';
    const r = await run(PPD_BIN, ['set', name]);
    if (r.ok) return { handled: true, how: 'power-profiles-daemon', name };
  }
  return { handled: false };
}

async function applyProfile(name) {
  const p = PROFILES[name] || PROFILES.balanced;
  const log = [];
  const ppd = await setPlatformProfile(p.pp);
  if (ppd.handled) log.push(`Güç profili (PPD) = ${ppd.name}`);
  else if (!exists(PP)) log.push('platform_profile yok — yalnızca CPU governor/EPP uygulanır');

  const args = ['--profile', name];
  if (ppd.handled) args.push('--no-pp');
  const r = await runPriv(args);
  if (r.out) log.push(...r.out.split('\n').map((s) => s.trim()).filter(Boolean));
  if (!r.ok) log.push('UYARI: CPU ayarları uygulanamadı (root/pkexec gerekli)');
  return log;
}

module.exports = {
  platform: 'linux',

  async init() {
    const admin = isRoot();
    const hasPP = exists(PP);
    const bat = batteryDir();
    const fans = hwmonFans().length;
    const parts = [];
    parts.push(hasPP ? 'platform_profile var' : 'platform_profile yok');
    parts.push(bat ? 'batarya kontrolü var' : 'batarya sınırı yok');
    parts.push(fans ? `${fans} fan sensörü` : 'fan sensörü yok');
    if (PPD_BIN) parts.push('power-profiles-daemon ile koordine');
    if (admin) parts.push('root');
    return {
      ok: true,
      needAdmin: !admin,
      msg: 'Linux modu hazır. (' + parts.join(', ') + ')',
      hasPP, hasBattery: !!bat, root: admin,
    };
  },

  status() { return readStatus(); },
  systemInfo,
  async socCondition() { return []; },

  async setMode(m) { return applyProfile(m === 1 ? 'perf' : (m === 2 ? 'eco' : 'balanced')); },
  async setPerf() { throw new Error("Performance-Mode Linux'ta yok (Windows ACPI-WMI). platform_profile kullanın."); },
  async setBoost() { throw new Error("Start Boost Linux'ta yok (Windows ACPI-WMI)."); },
  async setThermal() { throw new Error("Isı politikası Linux'ta yok (Windows ACPI-WMI)."); },

  async setTurbo(b) {
    const name = b ? 'perf' : 'balanced';
    const log = [];
    const r = await runPriv(['--profile', name, '--no-pp']);
    if (r.out) log.push(...r.out.split('\n').map((s) => s.trim()).filter(Boolean));
    return { turbo: !!b, steps: log };
  },

  async setSmartChargeOn() { const r = await runPriv(['--charge', '65', '70']); return r.ok; },
  async setChargeLimit(c) { const r = await runPriv(['--charge', String(Math.max(0, c - 5)), String(c)]); return r.ok; },
  async setChargeThreshold(lo, hi) { const r = await runPriv(['--charge', String(lo), String(hi)]); return r.ok; },
  async setResumeCharging(b) { const r = await runPriv(b ? ['--resume'] : ['--charge', '0', '100']); return r.ok; },

  async raw() { throw new Error("Ham ACPI-WMI komutu Linux'ta desteklenmiyor. Gelismis sekmesi Windows icindir."); },

  applyProfile,

  // Tam profil: platform_profile (PPD varsa onunla) + CPU governor/EPP + doğrulama
  async applyFull(name) {
    const steps = [], errors = [];
    let before = null, sysBefore = null, after = null, sysAfter = null;
    try { before = await readStatus(); } catch {}
    try { sysBefore = await systemInfo(); } catch {}

    try { steps.push(...(await applyProfile(name))); }
    catch (e) { errors.push(String(e.message || e)); }

    await new Promise((r) => setTimeout(r, 700));
    try { after = await readStatus(); } catch {}
    try { sysAfter = await systemInfo(); } catch {}

    return {
      ok: errors.length === 0,
      steps, errors, before, after, sysBefore, sysAfter,
      verified: { modeChanged: before && after ? before.modeName !== after.modeName || after.gov === PROFILES[name].gov : null },
    };
  },

  isAdmin() { return Promise.resolve(isRoot()); },
  caps() {
    return {
      fanSet: false,
      thermalPolicy: false,
      powerPlans: true,
      charge: !!batteryDir(),
      platformProfile: exists(PP),
      ppd: !!PPD_BIN,
    };
  },
};
