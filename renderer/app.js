// MateBook Kontrol — arayüz mantığı (v2.1)
// ────────────────────────────────────────────────────────────
// Eser sahibi : Alican Tutu
// İmza        : mbk-alican-tutu
// Bu proje Alican Tutu'ya aittir. (© Alican Tutu)
// ────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// Sahiplik bilgisi — DOM'a gizli olarak işlenir
const OWNER = 'Alican Tutu';
const OWNER_SIG = 'mbk-alican-tutu';
document.documentElement.setAttribute('data-owner', OWNER);
document.documentElement.setAttribute('data-signature', OWNER_SIG);
console.log('%cMateBook Kontrol', 'color:#f5a623;font-weight:700', '· eser sahibi: ' + OWNER);

const MODE_NAMES = { 0: 'Dengeli', 1: 'Performans', 2: 'Enerji Tasarrufu' };
const LIMITS = [50, 60, 70, 80, 90, 100];

let booted = false;
let currentMode = null;     // son uygulanan çalışma modu (0/1/2)
let lastAc = null;          // son bilinen AC durumu
let applying = false;
let ENV = null;             // ortam bilgisi (hwOsd var mı vb.)

// Kendi bilgi kartımız (OSD). Huawei HW OSD kuruluysa onunki kullanılır, çift kart olmaz.
function showCard(title, subtitle, accent, icon) {
  if (!ENV || !ENV.isWindows || ENV.hwOsd) return;
  try { window.mb.osd({ title, subtitle, accent, icon }); } catch {}
}
const CARD_BY_MODE = {
  perf:     { title: 'Performans moduna geçildi', subtitle: 'İşlemci yüksek güce alındı', accent: '#ff6b3d', icon: '⚡' },
  balanced: { title: 'Dengeli moda geçildi',       subtitle: 'Normal güç profili',          accent: '#4da3ff', icon: '⚖' },
  eco:      { title: 'Enerji tasarrufu moduna geçildi', subtitle: 'Pil ömrü öncelikli',    accent: '#37c977', icon: '🍃' },
};

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

function log(msg) {
  const el = $('#log');
  const t = new Date().toLocaleTimeString('tr-TR');
  el.textContent = `[${t}] ${msg}`;
}

function fmt(v, suffix) {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v + (suffix || '');
}

// ---------------- Sekmeler ----------------
$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
  });
});

// ---------------- Pencere ----------------
$('#btn-min').onclick = () => window.mb.win.minimize();
$('#btn-max').onclick = () => window.mb.win.maximize();
$('#btn-close').onclick = () => window.mb.win.close();

// ---------------- "Pilde de zorla" senkronu ----------------
function forceDc() {
  return $('#force-dc').checked || ($('#force-dc-2') && $('#force-dc-2').checked);
}
function setForceDc(v) {
  $('#force-dc').checked = v;
  if ($('#force-dc-2')) $('#force-dc-2').checked = v;
  store.set('mb.forceDc', v ? '1' : '0');
}
$('#force-dc').addEventListener('change', (e) => setForceDc(e.target.checked));
if ($('#force-dc-2')) $('#force-dc-2').addEventListener('change', (e) => setForceDc(e.target.checked));

// ---------------- Durum güncellemesi ----------------
function setLed(state) { $('#conn-led').className = 'status-led ' + (state || ''); }

function updateAll(d, sys) {
  const modeName = (d && d.modeName) ? d.modeName
    : (currentMode !== null ? MODE_NAMES[currentMode] : '—');

  // Üst çipler
  $('#chip-mode b').textContent = modeName;
  $('#chip-fan b').textContent = (d && d.fan0 !== undefined) ? d.fan0 + ' rpm' : '—';
  const temp = d && d.temp !== undefined ? d.temp : null;
  $('#chip-temp b').textContent = temp !== null ? temp + '°' : '—';
  if (sys && sys.cpuLoad !== undefined) {
    $('#chip-cpu b').textContent = sys.cpuLoad + '%';
  }
  $('#chip-batt b').textContent = (sys && sys.batteryPct !== undefined && sys.batteryPct !== null)
    ? sys.batteryPct + '%' : '—';

  const onAc = sys ? sys.onAc : null;
  const pdot = $('#power-dot');
  pdot.className = 'dot ' + (onAc === true ? 'ac' : (onAc === false ? 'batt' : ''));
  $('#chip-power b').textContent = onAc === true ? 'Prizde' : (onAc === false ? 'Pil' : '—');

  // Durum panosu
  $('#s-mode').textContent = modeName;
  $('#s-fan').innerHTML = fmt(d && d.fan0, '') + '<span class="unit">rpm</span>';
  $('#s-temp').innerHTML = fmt(temp, '') + '<span class="unit">°C</span>';
  $('#s-batt').innerHTML = fmt(sys && sys.batteryPct, '') + '<span class="unit">%</span>';
  if (d && d.fan1 !== undefined) $('#s-fan-hint').textContent = 'Fan2 ' + d.fan1 + ' rpm';
  if (sys && sys.cpuCurMhz) {
    $('#s-cpu').innerHTML = sys.cpuCurMhz + '<span class="unit">MHz</span>';
    $('#s-cpu-hint').textContent = 'yük %' + (sys.cpuLoad ?? '—') +
      (sys.cpuMaxMhz ? ' • max ' + sys.cpuMaxMhz : '');
  }
  $('#s-ac').textContent = onAc === true ? 'Prize takılı' : (onAc === false ? 'Pil' : '—');
  if (sys && sys.powerPlan) $('#s-plan').textContent = 'plan: ' + sys.powerPlan.replace(/^.*\(/,'(').replace(/\)$/,')');
  const badge = $('#ac-badge');
  badge.textContent = onAc === true ? '● PRIZDE' : (onAc === false ? '● PİL' : '—');
  badge.className = 'hero-badge ' + (onAc === true ? 'ac' : (onAc === false ? 'batt' : ''));

  // Şarj
  if (d && d.charge) {
    const c = d.charge;
    let txt;
    if (c.mode === 4) txt = 'Akıllı Şarj: AÇIK (' + c.lower + '% – ' + c.upper + '%)';
    else txt = 'Mod: ' + c.mode + ' • Alt: ' + c.lower + '% • Üst: ' + c.upper + '%';
    if (sys && sys.batteryPct !== undefined) txt += '\nPil: ' + sys.batteryPct + '%' + (onAc === true ? ' (şarj oluyor)' : '');
    $('#chg-status').textContent = txt;
    $('#s-charge').textContent = (c.mode === 4 ? 'Akıllı şarj' : 'Sınır ' + c.upper + '%');
  }

  // Fan sekmesi
  if (d) {
    $('#f-fan0').innerHTML = fmt(d.fan0, '') + '<span class="unit">rpm</span>';
    $('#f-fan1').innerHTML = fmt(d.fan1, '') + '<span class="unit">rpm</span>';
    const row = $('#sensor-row');
    if (d.temps && d.temps.length) {
      row.innerHTML = d.temps.map((t) => `<div class="sensor"><span>S${t.i}</span><b>${t.c}°</b></div>`).join('');
    } else {
      row.textContent = 'Sensör verisi yok';
    }
  }

  // Aktif hızlı mod vurgusu
  if (currentMode !== null) {
    $$('.mode-btn').forEach((b) => b.classList.toggle('active',
      b.dataset.quick === ({ 0: 'balanced', 1: 'perf', 2: 'eco' })[currentMode]));
  }
}

let lastStatus = null, lastSys = null;

async function refresh() {
  const [rs, ri] = await Promise.all([window.mb.status(), window.mb.systemInfo()]);
  if (rs.ok) { lastStatus = rs.data; setLed('on'); }
  else { setLed('err'); log('Okuma hatası: ' + rs.error); }
  if (ri.ok) lastSys = ri.data;
  updateAll(lastStatus, lastSys);
  maybeReapply();
}

// ---------------- AC/DC izleme ----------------
async function maybeReapply() {
  if (!lastSys) return;
  const ac = lastSys.onAc;
  if (lastAc === null) { lastAc = ac; return; }
  if (ac === lastAc) return;
  const was = lastAc; lastAc = ac;
  log('Güç kaynağı değişti: ' + (was ? 'priz' : 'pil') + ' → ' + (ac ? 'priz' : 'pil'));
  const watch = $('#acdc-watch');
  const last = store.get('mb.lastProfile', '');
  if (watch && watch.checked && last && !applying) {
    log('Otomatik yeniden uygulanıyor: ' + last);
    await applyFull(last, null);
  }
}

// ---------------- Doğrulama paneli ----------------
function buildVerify(res) {
  const L = [];
  if (res.steps && res.steps.length) { L.push('UYGULANAN ADIMLAR:'); res.steps.forEach((s) => L.push('  • ' + s)); }
  if (res.errors && res.errors.length) { L.push('HATALAR:'); res.errors.forEach((s) => L.push('  ✗ ' + s)); }
  const b = res.before, a = res.after, sb = res.sysBefore, sa = res.sysAfter;
  if (b || a) {
    L.push('');
    L.push('DOĞRULAMA (önce → sonra):');
    if (b && a) {
      L.push(`  Çalışma modu : ${b.modeName || b.mode} -> ${a.modeName || a.mode}`);
      L.push(`  Performance  : ${b.perf ?? '—'} -> ${a.perf ?? '—'}`);
      L.push(`  Turbo        : ${b.turbo ? 'açık' : 'kapalı'} -> ${a.turbo ? 'açık' : 'kapalı'}`);
      if (b.temp !== undefined || a.temp !== undefined)
        L.push(`  Sıcaklık     : ${b.temp ?? '—'}° -> ${a.temp ?? '—'}°`);
      L.push(`  Fan          : ${b.fan0 ?? '—'} -> ${a.fan0 ?? '—'} rpm`);
    }
    if (sb && sa) {
      L.push(`  CPU saat     : ${sb.cpuCurMhz ?? '—'} -> ${sa.cpuCurMhz ?? '—'} MHz (yük %${sa.cpuLoad ?? '—'})`);
      L.push(`  Güç planı    : ${sb.powerPlan ?? '—'} -> ${sa.powerPlan ?? '—'}`);
      L.push(`  Güç kaynağı  : ${sb.onAc ? 'priz' : 'pil'} -> ${sa.onAc ? 'priz' : 'pil'}`);
    }
  }
  return L.join('\n');
}

function renderVerify(res) {
  const txt = buildVerify(res);
  const ok = res.ok && (!res.errors || res.errors.length === 0);
  const tagTxt = ok ? 'uygulandı' : 'kısmi / hata';
  ['#verify-out', '#verify-out-2'].forEach((sel) => { const el = $(sel); if (el) el.textContent = txt; });
  ['#verify-tag', '#verify-tag-2'].forEach((sel) => { const el = $(sel); if (el) el.className = 'tag ' + (ok ? 'ok' : 'warn'); if (el) el.textContent = tagTxt; });
}

// ---------------- Mod uygulama ----------------
async function applyFull(name, btn) {
  if (applying) return;
  applying = true;
  const b0 = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Uygulanıyor…'; }
  log('Uygulanıyor: ' + name + (forceDc() ? ' (pil dahil)' : ''));
  let r;
  try {
    r = await window.mb.applyFull(name, { forceDc: forceDc() });
  } catch (e) {
    r = { ok: false, error: String(e.message || e) };
  }
  applying = false;

  if (r.ok) {
    currentMode = { balanced: 0, perf: 1, eco: 2 }[name];
    store.set('mb.lastProfile', name);
    log('Tamam: ' + (r.steps || []).join(' • '));
    const c = CARD_BY_MODE[name];
    if (c) showCard(c.title, c.subtitle, c.accent, c.icon);
    if (btn) { btn.classList.add('done'); btn.textContent = '✓ Uygulandı'; setTimeout(() => { btn.classList.remove('done'); btn.disabled = false; btn.textContent = b0; }, 1500); }
  } else {
    log('Hata: ' + (r.error || (r.errors && r.errors.join('; ')) || 'bilinmiyor'));
    if (btn) { btn.disabled = false; btn.textContent = b0; }
  }
  renderVerify(r);
  await refresh();
}

$$('.big-apply').forEach((b) => b.addEventListener('click', () => applyFull(b.dataset.apply, b)));
$$('.mode-btn').forEach((b) => b.addEventListener('click', () => applyFull(b.dataset.quick, null)));

// ---------------- Turbo ----------------
$('#perf-turbo').addEventListener('change', async (e) => {
  const on = e.target.checked;
  const r = await window.mb.setTurbo(on);
  log(r.ok ? ('Turbo: ' + (on ? 'açık' : 'kapalı')) : ('Turbo hatası: ' + r.error));
  if (r.ok) {
    if (on) showCard('Turbo açık', 'Yüksek güç etkin', '#ff6b3d', '⚡');
    else showCard('Turbo kapalı', 'Normal güç', '#4da3ff', '🌙');
  }
  refresh();
});

// ---------------- Fan ----------------
$('#fan-force-on').onclick = () => applyFull('perf', null).then(() => log('Fan yükseltme: performans profili uygulandı'));
$('#fan-force-off').onclick = () => applyFull('balanced', null).then(() => log('Normal soğutmaya dönüldü'));

$('#therm-apply').onclick = async () => {
  const v = parseInt($('#therm-val').value, 10);
  if (Number.isNaN(v) || v < 0 || v > 255) { log('Geçersiz değer (0–255)'); return; }
  const r = await window.mb.setThermal(v);
  log(r.ok ? ('Isı politikası = ' + v + ' gönderildi') : ('Hata: ' + r.error));
};

// ---------------- Gelişmiş ----------------
$('#perf-apply').onclick = async () => {
  const v = parseInt($('#perfval').value, 10);
  const r = await window.mb.setPerf(v);
  log(r.ok ? ('Performance-Mode = ' + v + ' gönderildi') : ('Hata: ' + r.error));
  refresh();
};

$('#boost-apply').onclick = async () => {
  const v = parseInt($('#boost-val').value, 10);
  const r = await window.mb.setBoost(v);
  log(r.ok ? ('Start Boost = ' + v + ' gönderildi') : ('Hata: ' + r.error));
};

$('#soc-read').onclick = async () => {
  const r = await window.mb.socCondition();
  if (r.ok) log('SoC koşul baytları: [' + (r.data || []).join(' ') + ']');
  else log('SoC okuma hatası: ' + r.error);
};

$('#raw-send').onclick = async () => {
  const hex = $('#raw-hex').value.trim();
  if (!hex) return;
  const r = await window.mb.raw(hex);
  $('#raw-out').textContent = r.ok ? ('→ ' + (r.data || []).join(' ')) : ('Hata: ' + r.error);
  log('Ham komut: ' + hex + (r.ok ? ' → yanıt alındı' : ' → hata'));
};

$('#acdc-watch').checked = store.get('mb.acdcWatch', '1') === '1';
$('#acdc-watch').addEventListener('change', (e) => store.set('mb.acdcWatch', e.target.checked ? '1' : '0'));

// ---------------- Şarj ----------------
$('#chg-smart').onclick = async () => {
  const r = await window.mb.setSmartChargeOn();
  log(r.ok ? 'Akıllı Şarj açıldı (65–70%)' : ('Hata: ' + r.error));
  refresh();
};

(function buildLimits() {
  const grid = $('#limit-grid');
  grid.innerHTML = '';
  LIMITS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'limit-btn';
    b.innerHTML = c + '%<small>burada dur</small>';
    b.onclick = async () => {
      const r = await window.mb.setChargeLimit(c);
      log(r.ok ? ('Şarj sınırı: ' + (c - 5) + '–' + c + '%') : ('Hata: ' + r.error));
      refresh();
    };
    grid.appendChild(b);
  });
})();

// ---------------- Ses ----------------
$('#audio-run').onclick = async () => {
  log('Ses sürücüsü aşaması başlatılıyor…');
  $('#audio-out').textContent = 'Çalışıyor…';
  const r = await window.mb.audioRun();
  $('#audio-out').textContent = r.ok ? (r.message || 'Başlatıldı.') : ('Hata: ' + r.error);
  log(r.ok ? 'Ses aşaması başlatıldı' : ('Hata: ' + r.error));
};
$('#audio-script').onclick = () => window.mb.audioReveal();

// ---------------- Yönetici ----------------
$('#admin-relaunch').onclick = async () => {
  const r = await window.mb.relaunchAdmin();
  if (!r.ok) log('Yeniden başlatma başarısız: ' + (r.error || ''));
};
$('#admin-skip').onclick = () => $('#admin-overlay').classList.add('hidden');

// ---------------- Açılış ----------------
async function boot() {
  setForceDc(store.get('mb.forceDc', '0') === '1');
  const env = await window.mb.env();
  ENV = env;
  document.body.classList.toggle('is-linux', !env.isWindows);
  $('#platform-pill').textContent = env.isWindows ? 'WINDOWS' : 'LINUX';
  log('Platform: ' + env.platform + ' • ' + env.arch);

  const init = await window.mb.init();
  if (init && init.msg) log(init.msg);

  if (init && init.needAdmin && env.isWindows) $('#admin-overlay').classList.remove('hidden');
  setLed(init && init.ok ? 'on' : 'err');

  // Son profili geri yükle
  const last = store.get('mb.lastProfile', '');
  if (last) currentMode = { balanced: 0, perf: 1, eco: 2 }[last] ?? null;

  await refresh();
  booted = true;
  setInterval(refresh, 2500);
}

boot();
