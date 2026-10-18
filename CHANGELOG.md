# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [2.1.1] — 2026

### Changed
- **The app's own info card is now always shown**, even when the Huawei HW OSD is installed and running.
  So on machines **with** HW OSD both cards appear together — Huawei's (bottom-centre) and ours
  (**top-right**) — while machines **without** HW OSD still get our card. A new setting
  *“Kendi bilgi kartımı göster (HW OSD olsa bile)”* (on by default) lets you turn ours off.
- Our card is now **semi-transparent** and slides in from the top.
- The window keeps running normally while hidden in the tray (`backgroundThrottling: false`), so the
  info card and mode changes still work in **tray mode**.
- **Turbo / performance honesty:** the app now reads turbo back after setting it. On battery the EC
  keeps turbo **off** (some Huawei models only allow turbo on AC), so the app says so instead of
  claiming success. It also reports when the EC does not support the BIOS working-mode / performance-mode
  commands (a status byte of `01` = unsupported) instead of pretending they applied.

### Fixed
- **Battery charge limit (65–70%) now actually works.** The *Akıllı Şarj* button used the “smart” opcode
  (`03 15 04`), which on this EC leaves the battery **charging** up to full. Verified: only the fixed
  threshold opcode (`03 15 01 …`, i.e. `mode=1`, lo=65/hi=70) really stops charging
  (`Charging=False`). The button now applies the fixed 65–70 threshold (and re-enables resume charging),
  so the battery holds between 65% and 70%.

## [2.1.0] — 2026

### Added
- **Tray mode.** Closing the window now minimises it to the system tray instead of quitting, so the global
  shortcut keeps working in the background. The tray menu has: *Open window*, the three work modes
  (Balanced / Performance / Eco — each shows the same info card), the auto-start toggle and *Quit*.
  Left-click the tray icon to reopen the window.
- **Start at logon (Windows via Task Scheduler, Linux via XDG autostart).** On Windows the task is created
  with **highest privileges**, so the app starts **elevated without a UAC prompt** and the shortcut works
  immediately. Toggle from the tray menu or the app's UI (the toggle needs the app to run as administrator).

### Fixed
- Silenced the Electron 44 `console-message` deprecation warning.

## [2.0.6] — 2026

### Added
- **Global shortcut `Ctrl+Alt+Q`** — cycles the working mode (Dengeli → Performans → Enerji) and shows the
  same info card as Huawei's Fn+P, without opening the window. The card is driven by the mode change
  itself: verified that Huawei's HW OSD reacts to the WMI/EC change, not only to the key.

### Changed
- **Works independently of Huawei HW OSD.** Previously the app hid its own info card whenever HW OSD was
  merely *installed*, so if that component was stopped or broken **no card appeared at all**. Detection now
  checks whether HW OSD is actually **running** (process/service), so the app's own card takes over when it
  isn't — and no Huawei software is required. `MB_NO_HWOSD=1` forces the app's own card even when HW OSD
  is active.

### Fixed
- **Linux mode switching.** The `hw:applyFull` channel was blocked on non-Windows, so the mode buttons (and
  the new shortcut) did nothing on Linux even though `hw_linux.applyFull` exists. It now runs on both.

## [2.0.5] — 2026

### Changed
- **Audio-driver step is now portable and model-agnostic.** The “Ses Sürücüsü” action used to rely
  on a script hard-coded to the original author's home folder (`~/huawei-re/AudioDriverStage.ps1`).
  It now ships **inside the app** and runs from the bundled `scripts/AudioDriverStage.ps1` (resolved
  through the same asar → `app.asar.unpacked` logic as the WMI worker), so it works on any machine.
  The script detects the installed audio driver, checks Huawei's **official** driver channel
  (support-site offering API + PC Manager HOTA data), creates a **System Restore point only if an
  update is actually available**, then opens Huawei's official updater (or the support page).

### Fixed
- **`scripts/verify.ps1`** (the manual ACPI-WMI check tool) used the same broken
  `Get-WmiObject` + `InvokeMethod` path that v2.0.3 replaced in the app worker, so it errored out on
  PowerShell 5.1. It now uses `Get-CimInstance` + `Invoke-CimMethod` too.

### Added
- **Linux audio note.** The “Ses Sürücüsü” section now shows a Linux counterpart explaining that
  MateBook audio runs through standard kernel drivers (Intel SOF/SST, ALSA/PipeWire) and that updates
  come via `linux-firmware`/kernel packages and `fwupd` — no Huawei OTA needed. Documented in
  `docs/LINUX.md`.

## [2.0.4] — 2026

### Added
- **Own on-screen info card (OSD).** The “Switched to Performance/Balanced mode” card in Huawei
  PC Manager comes from Huawei's separate **HW OSD** component, which many machines don't have.
  MateBook Kontrol now draws its own frameless, click-through card in the bottom-right corner on
  every mode change — but **only when Huawei's HW OSD is not installed**, so there are no double
  cards. This makes the feedback identical on any machine, with no Huawei software required.

### Fixed
- **Balanced and Eco now update the Turbo state too** (`SET_TURBO 0`). Previously only Performance
  sent a Turbo command, so the Huawei OSD (when present) only showed the card for Performance.
  Now the proper “Switched to Balanced mode” card appears as well — matching Huawei PC Manager.

## [2.0.3] — 2026

### Fixed
- **ACPI-WMI now really works in the packaged app.** The persistent PowerShell worker used
  `Get-WmiObject` + `GetMethodParameters` + `InvokeMethod`. On PowerShell 5.1 that path fails
  while assigning the 64-byte `u8Input` array with
  `'System.Management.Automation.PSObject' cannot be converted to 'System.Array'`, so every
  command (mode, fan, temperature, smart charge) errored out even as administrator.
  The worker now uses `Get-CimInstance` + `Invoke-CimMethod` — verified end-to-end as admin:
  working mode, fan RPM, sensor temperature and smart-charge status all read back correctly.
- **Turkish characters in the active power-plan name** (e.g. “Güç tasarrufu”) no longer show up
  as `(G? tasarrufu)`. `powercfg` output is now decoded with the machine's OEM code page and
  re-emitted to the app as UTF-8.

## [2.0.2] — 2026

### Fixed
- **Packaged app still could not reach ACPI-WMI** (the v2.0.1 fix was incomplete).
  Electron's asar-aware `fs` reports files **inside `app.asar` as existing**, so the
  "if the worker is missing, switch to the unpacked path" check never triggered and
  PowerShell kept being pointed at a file inside `app.asar` that it cannot execute.
  The worker path is now switched to `app.asar.unpacked` **whenever** it is inside
  `app.asar`. Verified with a real Electron test that the unpacked path is chosen.

## [2.0.1] — 2026

### Fixed
- **Packaged app could not reach ACPI-WMI.** In the built (asar) app the PowerShell
  worker was referenced from inside `app.asar`, which PowerShell cannot execute.
  So every WMI command failed with *"no ACPI-WMI connection (administrator
  required?)"* **even when running as administrator**. Scripts are now shipped
  unpacked (`asarUnpack`) and resolved from `app.asar.unpacked` at runtime.
- `init()` no longer hangs forever if the worker exits before signalling ready.

## [2.0.0] — 2026

### Fixed
- **Critical:** the persistent ACPI-WMI worker sent short command buffers to
  `u8Input`. `OemWMIMethod.OemWMIfun` requires **exactly 64 bytes**, so *every*
  command silently failed. Commands are now zero-padded to 64 bytes.
- Temperature was read from the wrong byte (sign flag). Now reads sign (byte1)
  and value (byte2) correctly.

### Added
- **Real, stateful apply:** BIOS working mode + Performance-Mode (`04 13`) +
  Turbo (`04 0f`) + Windows power plan / CPU min-max / EPP / boost, each step
  independent and verified by before/after read-back.
- **Performance on battery:** a "force on battery" toggle that bypasses Huawei's
  AC-only gate and applies full-power values on DC as well.
- **Verification panel** showing before/after (mode, turbo, fan, CPU MHz, plan).
- **AC/DC monitoring:** re-applies the last profile automatically when the power
  source changes (matching PC Manager behaviour).
- **Linux backend** (`hw_linux.js`): `platform_profile` + `cpufreq` governor/EPP,
  `huawei-wmi` charge limits, `hwmon` fan/temperature, coordination with
  `power-profiles-daemon`. See `docs/LINUX.md`.
- Modern UI with Durum / Performans / Fan-Isı / Şarj / Gelişmiş / Ses panes.
- `scripts/verify.ps1` — read-only hardware verification (optional `-Apply`).

### Known limitations
- No **direct** fan-speed write command exists (fan rises as a side effect of the
  performance/thermal profile).
- Some EC firmware still enforces its own DC limits; the app reports the real
  state honestly in that case.
