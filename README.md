# MateBook Kontrol

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)](#)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)

An open-source control center for **Huawei MateBook** laptops that works **without
Huawei PC Manager**. It talks directly to the firmware's **ACPI-WMI** interface to
switch performance modes, toggle turbo, monitor fan & temperature, and manage
battery charging — with a small, modern UI.

<!-- Add a screenshot: ![Screenshot](docs/screenshot.png) -->

> **Tested on:** HUAWEI MateBook D15 (BOD-WXX9 / "BohrD"), Intel i5-1135G7
> (Tiger Lake), BIOS 2.31.
> Protocol reverse-engineered from Huawei PC Manager 14.0.7.310
> (`WmiUtil.dll` → `HwSDK::BiosWmi::*`). See [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).

---

## Why this exists

Huawei PC Manager is a heavy, Windows-only bundle. The hardware controls it
exposes are actually provided by the **BIOS/EC firmware** over ACPI-WMI — so they
can be driven directly. MateBook Kontrol is a lightweight alternative that opens
the same controls to *any* machine where the interface exists (and to Linux,
where PC Manager doesn't run at all).

---

## Does it really work without PC Manager?

**Yes — for performance/thermal/charge control.** The `root\WMI :
OemWMIMethod.OemWMIfun` interface is provided by the firmware, not by Huawei PC
Manager. The app calls it directly (with **administrator rights**), so PC Manager
does not need to be installed.

### About the fan (be honest)

There is **no direct "set fan speed" command** exposed by this firmware. The app
can **read** fan RPM, and the fan speeds up as a **side effect** of switching to
the Performance profile (the EC changes its thermal curve). See the capability
flag `fanSet: false` in `hw_win.js` / `hw_linux.js`.

| User expectation | Reality in this project |
|---|---|
| Enter performance mode without PC Manager | ✅ Works (WMI `04 11` + `04 13` + `04 0f`) |
| Fan spins up / "turbo" | 🟡 Indirect — the performance/thermal profile raises fan RPM; no direct fan write |
| Ignore the "AC-only" gate PC Manager applies | ✅ The app applies full power on battery too (EC may still limit on DC) |
| Run without administrator rights | ❌ Not possible — ACPI-WMI writes require elevation |

---

## Features

- **One-click modes:** Balanced / Performance / Eco, each applying the BIOS
  working mode + Performance-Mode + Turbo + Windows power plan together.
- **Verified apply:** every action does a **before/after read-back** so you can
  see that something actually changed (mode, turbo, fan, CPU MHz, plan).
- **Performance on battery:** "force on battery" bypasses Huawei's AC-only gate.
- **Live telemetry:** CPU MHz / load, fan RPM, all temperature sensors, battery %,
  AC/battery status.
- **Battery care:** smart charging and a custom charge limit (50–100%).
- **AC/DC watcher:** re-applies your last profile when the power source changes.
- **Advanced (Windows):** raw WMI command, Performance-Mode, Start-Boost, thermal
  policy, SoC condition — for tinkerers.
- **Cross-platform backend:** Windows uses ACPI-WMI; Linux uses standard kernel
  interfaces (`platform_profile`, `cpufreq`, `huawei-wmi`, `hwmon`).
  See [`docs/LINUX.md`](docs/LINUX.md).

---

## How it works

The app spawns a **persistent PowerShell worker** that calls the ACPI-WMI method
`OemWMIMethod.OemWMIfun`. The method expects a **fixed 64-byte input buffer**;
commands occupy only the first few bytes, and the rest are zero-padded.

Output layout: **byte 0 = status** (`0` = success); values are read from the
following bytes.

| Function | Command | Output |
|---|---|---|
| GetWorkingMode | `04 10` | mode = byte1 |
| SetWorkingMode | `04 11 <m>` | — |
| GetPerformanceMode | `04 12` | byte1 must be 0, mode = byte2 (0–2) |
| SetPerformanceMode | `04 13 <m>` | — |
| GetTurboMode | `04 0e` | turbo = byte1 |
| SetTurboMode | `04 0f <0/1>` | — |
| SetStartBoost | `04 16 <v>` | — |
| GetFanSpeed | `02 08 <i>` | RPM = byte1 \| byte2<<8 |
| GetSensorTemperature | `02 02 <i>` | sign = byte1, value = byte2 |
| GetSmartChargeMode | `03 16` | mode = byte1, lower = byte3, upper = byte4 |
| SetBatteryChargeThreshold | `03 10 <lo> <hi>` | — |
| SetThermalControlPolicy | `03 18 <p>` | — |

> Huawei's PC Manager only *gates* Turbo on AC via application logic
> (`TurboModeConfig.xml`); the raw WMI command itself has no such gate.

---

## Requirements

**Windows**
- Windows 10/11 (64-bit)
- **Administrator rights** (mandatory for ACPI-WMI writes)
- Supported firmware interface (`OemWMIMethod` present)

**Linux** — see [`docs/LINUX.md`](docs/LINUX.md)
- Kernel 5.12+ (platform_profile), 5.11+ (`huawei-wmi`)
- `pkexec` (polkit) or `sudo`

**Development**
- [Node.js](https://nodejs.org/) 18+ and npm

---

## Getting started

```bash
git clone https://github.com/tutualican/matebook-control.git
cd matebook-control
npm install
npm start
```

On Windows, run the app **as administrator** (or use the in-app
"Restart as Administrator" button). The window shows a warning if elevation is
missing.

### Verify your hardware (read-only, recommended first)

In an **administrator** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1        # read-only
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1 -Apply # apply perf mode + read back
```

---

## Building

```bash
# Windows portable executable
npm run dist:win

# Linux packages (run on Linux, or via Docker — see docs/LINUX.md)
npm run dist:linux     # -> .deb, .rpm, AppImage
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Administrator required" | ACPI-WMI writes need elevation. Use the in-app relaunch button. |
| `OemWMIMethod not found` | Firmware interface missing, or not running as admin. |
| Nothing changes after a click | Check the **verification panel**; make sure the app is elevated. |
| Turbo reverts on battery | EC firmware enforces its own DC limit; the app reports the real state. |
| Fan shows 0 / — | The EC doesn't expose a fan sensor on this model. |

---

## Contributing

Issues and pull requests are welcome. If you test on a different MateBook model,
please share your `scripts/verify.ps1` output (read-only) so support can be
expanded.

---

## Safety

⚠️ This software writes to firmware. Read [`SECURITY.md`](SECURITY.md) before use.
Use it only on hardware you own, start with read-only checks, and keep backups.

---

## License

[Apache License 2.0](LICENSE) © Alican Tutu.

Anyone is free to **use, modify, sell and even embed** this project in a closed
product — but the [`NOTICE`](NOTICE) file, the copyright notice and the license
must be kept, and any changes must be stated. So the original work stays
credited and cannot be passed off as someone else's.

This is an unofficial project and is **not affiliated with Huawei**. "Huawei" and
"MateBook" are trademarks of Huawei Technologies Co., Ltd. Reverse engineering was
done for interoperability and personal research.

---

## Türkçe özet

Huawei **PC Manager olmadan** çalışan, MateBook için açık kaynak kontrol merkezi.
Windows'ta doğrudan **ACPI-WMI** (BIOS/EC) üzerinden performans/termal mod, turbo,
fan ve sıcaklık **okuma**, şarj sınırı; Linux'ta `platform_profile` + `cpufreq` +
`huawei-wmi`. Mod değişimi önce/sonra geri-okuma ile doğrulanır, "pilde de zorla"
seçeneği Huawei'nin priz kapısını atlar. **Yönetici izni zorunludur.**
Not: Fan hızını **doğrudan** yazan bir komut yoktur; fan, performans profili
değişince dolaylı olarak hızlanır. Ayrıntı: [`docs/LINUX.md`](docs/LINUX.md),
[`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).
