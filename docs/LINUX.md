# Linux Desteği (Ubuntu · Fedora · Debian)

`MateBook Kontrol` Windows'ta Huawei'nin **ACPI-WMI** arayüzünü kullanır. Linux'ta bu arayüz yoktur;
onun yerine **standart çekirdek arayüzleri** kullanılır. Sonuç: arayüz ve kontrol mantığı birebir aynı,
arka uç platforma göre otomatik seçilir (`hw_win.js` / `hw_linux.js`).

## Ne çalışır, ne çalışmaz

| Özellik | Linux yolu | Durum |
|---|---|---|
| Arayüz, sekmeler, doğrulama, AC/DC izleme | Electron | ✅ Tam |
| Performans / Dengeli / Enerji modları | `platform_profile` + `cpufreq` governor + EPP | ✅ |
| Gözle görülür etki (CPU MHz / yük) | `cpufreq` | ✅ |
| Priz/pil göstergesi, pil yüzdesi | `/sys/class/power_supply` | ✅ |
| Fan devri + sıcaklık (okuma) | `hwmon` | ✅ (sensör varsa) |
| Şarj sınırı (%50–100) ve akıllı şarj | `huawei-wmi` → `charge_control_end_threshold` | ✅ (modül varsa) |
| Turbo / yüksek-enerji (Huawei EC) | — | ❌ Linux'ta doğrudan yok |
| Ham ACPI-WMI komutu, ısı politikası, Performance-Mode | — | ❌ Windows'a özel (arayüzde gizlenir) |
| Fan hızı **yazma** | — | ❌ (Windows'ta da yok) |

> Not: Linux'ta "performans modu yalnızca prizde" kısıtı **yoktur**; `platform_profile`/`cpufreq` pilde de uygulanır.

## Gereksinimler

- **Çekirdek:** 5.12+ (platform_profile), 5.11+ (`huawei-wmi` şarj sınırı). Ubuntu 22.04+/24.04, Fedora 38+, Debian 12+ yeterli.
- **Modüller:** `huawei_wmi` (şarj sınırı / Fn), `acpi_platform_profile` (BIOS modu), `cpufreq` (hız).
  Kontrol: `lsmod | grep -E 'huawei_wmi|platform_profile'`
- **Yetki:** Yazma işlemleri (`/sys` yazımı) root ister → `pkexec` (polkit) veya `sudo`.

## Kurulum (paketlerden)

`dist/` altında üretilen dosyalar:

- **Debian/Ubuntu:** `MateBook Kontrol-2.0.0.deb` → `sudo apt install ./MateBook*deb`
- **Fedora/RHEL:** `MateBook Kontrol-2.0.0.rpm` → `sudo dnf install ./MateBook*rpm`
- **Her dağıtım (taşınabilir):** `MateBook Kontrol-2.0.0.AppImage` → `chmod +x ... && ./...`

Kategoriler: Ayarlar/Sistem. İlk yazma işleminde polkit sifre sorabilir.

## Derleme (paket üretme)

### Linux makinede (önerilen)
```bash
cd matebook-control
npm install                 # electron-builder dahil
npm run dist:linux          # -> dist/ : .deb, .rpm, AppImage
# tek tek:
npm run dist:deb
npm run dist:rpm
npm run dist:appimage
```
Simge: `build/icon.png` (512×512). Yeniden üretmek için: `node scripts/make-icon.js`

### Windows/macOS'tan çapraz derleme (Docker gerekir)
```bash
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:latest \
  bash -c "npm install && npm run dist:linux"
```

> Bu depo Windows'ta hazırlandı; `.deb/.rpm/AppImage` **Linux'ta** (veya Docker'da) derlenir.

## İzinler (polkit)

Uygulama önce doğrudan yazmayı dener; olmazsa sırayla **pkexec → sudo -n → root** kullanır.
Sifre sormadan çalıştırmak istersen bir polkit kuralı ekleyebilirsin (isteğe bağlı):

`/etc/polkit-1/rules.d/49-matebook-control.rules`
```javascript
polkit.addRule(function(action, subject) {
  if (action.id == "org.freedesktop.policykit.exec" &&
      subject.isInGroup("wheel") || subject.isInGroup("sudo")) {
    return polkit.Result.AUTH_ADMIN_KEEP; // sifreyi oturum boyunca bir kez sor
  }
});
```

## Çakışmalar

- **power-profiles-daemon (PPD):** GNOME'un güç profili servisi `platform_profile`'i sahiplenir.
  Uygulama PPD'yi algılarsa doğrudan sysfs yerine **`powerprofilesctl set ...`** ile yazar (çakışma olmaz).
- **TLP:** Kuruluysa CPU governor'ı kendisi yönetir. Uygulama çalışırken TLP'nin CPU ayarlarını
  geçici olarak durdurmayı düşün: `sudo systemctl stop tlp` veya TLP'de `CPU_SCALING_GOVERNOR_ON_*` ayarlarını bırak.
- **Undervolt/`intel-undervolt`** gibi araçlar EPP'yi değiştirirse son yazan kazanır.

## huawei-wmi ve şarj sınırı

Şarj sınırı `huawei-wmi` sürücüsüyle gelir:
```bash
ls /sys/class/power_supply/BAT*/charge_control_end_threshold
echo 80 | sudo tee /sys/class/power_supply/BAT*/charge_control_end_threshold
```
Cihaz (BOD-WXX9) için modül quirk tablosunda yoksa Fn/şarj özellikleri görünmeyebilir;
bu durumda arayüz bunları otomatik gizler. Çekirdek modülü `huawei-wmi` için güncel çekirdek kullanın.

## Ses sürücüsü (Linux)

Windows'taki "Ses Sürücüsü" aşaması Huawei'nin PC Manager OTA kanalına dayanır ve **yalnızca Windows**
içindir (arayüzde Windows'ta görünür, Linux'ta yerine bu not gösterilir). Linux'ta Huawei güncelleyicisi
**gerekmez**:

- Ses donanımı (ES8336 codec) çekirdek sürücüleriyle çalışır: **Intel SOF/SST** (`snd_sof_pci_intel_tgl`)
  veya `snd_hda_intel`, üzerinde **ALSA / PipeWire**.
- Kontrol:
  ```bash
  aplay -l                 # kartlar
  pactl info               # PipeWire/PulseAudio
  dmesg | grep -i -E 'sof|sst'   # kodek yüklenmesi
  ```
- Sürücü/firmware güncellemesi dağıtımın **`linux-firmware`** + **çekirdek** paketleriyle gelir:
  ```bash
  sudo apt update && sudo apt install --reinstall linux-firmware   # Debian/Ubuntu
  sudo dnf update linux-firmware                                   # Fedora
  fwupdmgr get-updates && fwupdmgr update                          # BIOS/aygıt yazılımı
  ```
- Sessiz hoparlör/mikrofon sorunları genelde çekirdek sürümüyle çözülür; gerekirse
  `snd_sof_pci_intel_tgl` parametreleri veya ALSA ince ayarı kullanılır.

## Elle doğrulama

```bash
# platform profili
cat /sys/firmware/acpi/platform_profile /sys/firmware/acpi/platform_profile_choices

# CPU
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
grep MHz /proc/cpuinfo | head

# Fan & sıcaklık
for h in /sys/class/hwmon/hwmon*; do echo "$h: $(cat $h/name)"; ls $h | grep -E 'fan|temp'; done

# Yetki yardımcısını elle dene
sudo bash scripts/linux/priv-helper.sh --profile performance
```

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "platform_profile yok" | Çekirdek 5.12+ ve `acpi_platform_profile` gerekli; bazı firmware'ler sunmaz (o zaman yalnızca cpufreq çalışır). |
| Mod değişince geri dönüyor | PPD/TLP yönetiyor olabilir; `powerprofilesctl get` ile kontrol et. |
| "Yetki yükseltme aracı yok" | `polkit` (pkexec) veya `sudo` kurun; ya da uygulamayı root çalıştırın. |
| Şarj sınırı görünmüyor | `huawei_wmi` modülü yüklü değil. `modprobe huawei_wmi`; gerekirse çekirdek güncelleyin. |
| Fan 0/— görünüyor | EC fan sensörü `hwmon`'a açılmıyor (model desteklemiyor). |
| AppImage açılmıyor (sandbox) | `./MateBook*.AppImage --no-sandbox` deneyin. |
