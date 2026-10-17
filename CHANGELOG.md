# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

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
