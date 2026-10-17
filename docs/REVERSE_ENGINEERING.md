# MateBook Kontrol — Analiz ve Yapılacaklar

Cihaz: **HUAWEI MateBook D15 (BOD-WXX9 / "BohrD" PCB-B4)**, i5-1135G7 (Tiger Lake), BIOS 2.31.
Amaç: Huawei PC Manager **olmadan**, doğrudan BIOS/EC (ACPI-WMI) üzerinden çalışan, mod değişimini
**gözle görülür** biçimde uygulayan ve **pilde de** performans modunu destekleyen modern bir kontrol merkezi.

Tersine mühendislik kaynağı: Huawei PC Manager 14.0.7.310 bileşenleri + Ghidra ile `WmiUtil.dll`
(`HwSDK::BiosWmi::*` API'si). Tüm protokol kodları sürücü/binary'den **doğrulandı**.

---

## ⛔ EN ÜST ÖNCELİK: Bulunan Problemler (önce bunlar çözülecek)

| # | Önem | Problem | Kanıt / Kök neden |
|---|------|---------|-------------------|
| P0 | 🔴🔴 Kritik | **Electron uygulamasında HİÇBİR WMI komutu çalışmıyordu** | `scripts/wmi_worker.ps1` komutu `u8Input`'a olduğu gibi (örn. 2–3 bayt) veriyordu. WMI metodu **tam 64 bayt** ister: `probe2.txt` → len=64 OK, len=8 → "Invalid parameter". Sonuç: mod/turbo/şarj komutları sessizce başarısız oluyordu. **Düzeltildi:** worker artık 64 bayta dolduruyor. |
| P1 | 🔴 Kritik | **Mod butonlarına basınca gözle görülür / Görev Yöneticisi'nde bir etki yok** | Eski `HuaweiControl` yalnızca `SetWorkingMode (04 11)` gönderiyor; Performance-Mode (04 13), Turbo (04 0f) ve Windows güç planı/işlemci ayarları hiç uygulanmıyor. Electron `applyFull` ise WMI çağrısı hata verirse **tüm adımları atlıyor** (tek `try`). |
| P2 | 🔴 Kritik | **Performans modu sadece prizde çalışıyor** | `config/system/TurboModeConfig.xml`: DC'de izin verilen makineler yalnızca `Dirac/DiracR`; `VanGoghH` limitsiz. `BohrD` listede yok → PC Manager `TurboMode::OnReceiveACDCChange` + `IsSupportTurboInRegistry` ile DC'de kapatıyor. Firmware ayrıca AC/DC için ayrı MSR PL1 kullanıyor (`ACEpoOffMsrPL1` vs `DCEpoOffMsrPL1`). |
| P3 | 🟠 Bug | **Sıcaklık yanlış bayttan okunuyor** | `BiosWmi::GetSensorTemperature`: byte0=status, byte1=işaret bayrağı, byte2=sıcaklık. Mevcut kod `r[1]` (işaret bayrağı) okuyor → hep 0/1. |
| P4 | 🟠 Bug | **Performans-modu WMI komutu tanımlı ama hiç kullanılmıyor** | `hw_win.js` içinde `GET_PERF/SET_PERF` var ama `status()/applyFull` çağırmıyor. |
| P5 | 🟠 Bug | **`preload.js` Ses Sürücüsü API'lerini açmıyor** | Renderer `window.mb.audioRun()`/`audioReveal()` çağırıyor ama preload'da yok → sekme tıklanınca sessiz JS hatası. |
| P6 | 🟠 Bug | **Durum verisi eksik** | `status()` batarya yüzdesi, mod adı ve **AC/priz durumu** döndürmüyor → üstteki "Şarj" göstergesi ve AC bilgisi hep `—`. |
| P7 | 🟡 Eksik | **AC↔DC geçişinde yeniden uygulama yok** | PC Manager `OnReceiveACDCChange` ile yeniden uyguluyor; bizde yok. |
| P8 | 🟡 Eksik | **"Pilde de zorla" seçeneği yok** | Kullanıcı isteği: prizde değilken performans. |
| P9 | 🟡 Eksik | **Doğrulama/geri-okuma yok** | Kullanıcı "bir şey oldu mu?" anlayamıyor. Önce/sonra (CPU MHz, fan, mod) gösterilmeli. |
| P10 | 🟡 Eksik | **Kalıcılık yok** | Seçilen mod hatırlanmıyor, açılışta uygulanmıyor. |
| P11 | 🎨 UI | **Arayüz modernleştirilmeli** | Mevcut koyu tema iyi ama sadeleştirme, canlı grafik, AC göstergesi ve doğrulama panelleri isteniyor. |
| P12 | 🔧 Teknik | **İki ayrı uygulama (C# + Electron) birbirinden kopmuş** | `HuaweiControl` (WinForms, eski) ile `MateBookControl` (Electron, modern) farklı yeteneklerde. |

---

## ✅ Çözüm Plânı (bu sırayla)

1. **P3, P4, P5, P6 — Protokol & bug düzeltmeleri** (`hw_win.js`, `preload.js`, `main.js`)
   - Sıcaklık byte2 + işaret byte1 doğru okunacak.
   - Performance-Mode (04 12/04 13) ve Turbo (04 0e/04 0f) uygulanacak + geri-okunacak.
   - `status()`: `modeName, perf, turbo, temps[], charge{}, acOnline, onBattery, batteryPct` dönecek.
   - preload'e eksik (`audioRun/audioReveal`, yeni alanlar) eklenecek.
2. **P1 — Gerçek/durumlu uygulama**: `applyFull` artık tek `try` değil; her adım bağımsız,
   WMI + Performance + Turbo + Windows güç planı + işlemci min/max + EPP + boost birlikte uygulanır,
   önce/sonra geri-okuma ile doğrulanır.
3. **P2, P8 — Pilde performans**: PC Manager'ın makine-tipi kapısını **atlayarak** WMI komutlarını
   AC'den bağımsız gönderir; DC için "Ultimate Performance" planı + DC işlemci min/max %100 + EPP düşürme
   + `PERFBOOSTMODE=2` uygular. (EC donanımsal olarak DC'de hâlâ sınırlayabilir; bu durumda bile Windows
   tarafı ölçülebilir şekilde hızlanır ve uygulama gerçek durumu dürüstçe raporlar.)
4. **P9 — Doğrulama**: Uygula sonrası CPU MHz / yük / fan / mod öncesi-sonrası gösterilir.
5. **P7, P10 — Kalıcılık & AC/DC izleme**: seçim kaydedilir, açılışta ve AC/DC değişiminde yeniden uygulanır.
6. **P11 — Modern UI**: yenilenen Durum/Performans/Fan/Şarj/Gelişmiş sekmeleri.
7. **P12 — Belgeler**: eski `HuaweiControl` için geçici not; modern yol Electron.

---

## 🔑 Doğrulanmış ACPI-WMI Protokolü (`root\WMI : OemWMIMethod.OemWMIfun`, 64-bayt `u8Input`)

Çıktı düzeni genel: **byte0 = durum** (0 = başarılı). Değerler aşağıdaki baytlardan okunur.

| İşlev | Komut | Çıktı |
|-------|-------|-------|
| GetWorkingMode | `04 10` | mod = **byte1** |
| SetWorkingMode | `04 11 <m>` | — |
| GetPerformanceMode | `04 12` | byte1=0 olmalı, mod = **byte2** (0–2) |
| SetPerformanceMode | `04 13 <m>` | — |
| GetTurboMode | `04 0e` | turbo = **byte1** (1/0) |
| SetTurboMode | `04 0f <0/1>` | — |
| SetStartBoost | `04 16 <v>` | — |
| GetFanSpeed | `02 08 <idx>` | RPM = **byte1 | byte2<<8** |
| GetSensorTemperature | `02 02 <idx>` | işaret=byte1, sıcaklık=**byte2** |
| GetSmartChargeMode | `03 16` | mode=byte1, lower=byte3, upper=byte4 |
| SetSmartChargeMode | `03 15 <....>` | akıllı: `03 15 04 48 41 46` |
| SetBatteryChargeThreshlod | `03 10 <lo> <hi>` | — |
| GetResumeChargingFlag | `03 13` | byte1 |
| SetResumeChargingFlag | `03 12 <0/1>` | — |
| GetAcDurationTime | `03 14` | byte1 | byte2<<8 |
| GetProchotReason | `03 17` | byte1 | byte2<<8 |
| SetTemperControlPolicy | `03 18 <p>` | — |
| GetSocPowerCtrlCondition | `03 0e [idx]` | string (AC/DC koşulu; salt-okunur tanı) |

Notlar:
- `PerformanceModeValue` aralığı **0–2**; firmware byte2 ≥ 3 ise geçersiz sayar.
- `TurboModeConfig.xml` gating'i yalnızca **uygulama** katmanındadır; ham WMI bu kapıyı atlar.

---

## 🖥️ Çalıştırma

```
cd C:\Users\Alican\huawei-re\MateBookControl
npm start            # geliştirme (Electron)
```
veya yönetici olarak `dist\MateBookKontrol-win32-x64\MateBookKontrol.exe`.
ACPI-WMI için **yönetici izni zorunludur**.

---

## 🐧 Linux Desteği (Ubuntu · Fedora · Debian)

Arayüz ve kontrol mantığı platformdan bağımsızdır; arka uç otomatik seçilir (`hw_win.js` / `hw_linux.js`).
Ayrıntı: [`docs/LINUX.md`](LINUX.md).

| Katman | Windows | Linux karşılığı |
|---|---|---|
| Çalışma modu | ACPI-WMI `04 11` | `platform_profile` (+ PPD) |
| Hız/enerji | güç planı + EPP | `cpufreq` governor + EPP |
| Şarj sınırı | ACPI-WMI `03 10` | `huawei-wmi` `charge_control_end_threshold` |
| Fan/sıcaklık | ACPI-WMI `02 08/02 02` | `hwmon` |
| Turbo / yüksek-enerji | ACPI-WMI `04 0f` | ❌ doğrudan yok |
| Ham komut / ısı politikası | ACPI-WMI | ❌ (arayüzde gizlenir) |

- **Paketler:** `electron-builder` ile `.deb`, `.rpm`, `AppImage` (`npm run dist:linux`). Simge `build/icon.png`.
- **Yetki:** yazma işlemleri `pkexec`/`sudo` ile yükseltilir (satır içi yardımcı; `scripts/linux/priv-helper.sh`).
- **Çakışma:** `power-profiles-daemon` algılanırsa onunla koordine edilir; TLP notu `LINUX.md`'de.
- **Not:** Linux'ta "performans yalnızca prizde" kısıtı yoktur.

> `.deb/.rpm/AppImage` bu Windows makinede derlenemez (WSL/Docker yok); Linux'ta veya Docker ile üretilir.

