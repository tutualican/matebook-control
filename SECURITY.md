# Safety & Disclaimer

> ⚠️ **Read this before using MateBook Kontrol.**

MateBook Kontrol writes directly to your laptop's firmware **through the ACPI-WMI
(BIOS/EC) interface**. These are low-level hardware controls. Use at your own risk.

## What the app does to your hardware

- Sends ACPI-WMI commands that change **BIOS/EC working mode, performance mode,
  turbo, thermal policy and battery charging thresholds**.
- Changes **Windows power plan** and **CPU min/max / EPP / boost** settings.
- Requires **administrator / root** privileges.

## Risks

- Wrong or unsupported commands may cause **instability, overheating, crashes,
  unexpected shutdowns or data loss**.
- Power/thermal settings can affect **battery life and hardware longevity**.
- Writing to firmware interfaces **may void your warranty**.
- The maintainer is **not responsible** for any damage to your device, data or
  warranty resulting from use of this software.

## Safety guidance

1. Only run this on **hardware you own and are willing to experiment on**.
2. Start with **read-only checks** (`scripts/verify.ps1` without `-Apply`).
3. Don't type random values into the **Raw command** / **thermal policy** fields.
4. Keep a **backup** of important data.
5. If something feels wrong, switch back to **Balanced** mode and reboot.

## Supported configuration

The protocol was verified only on:

- **HUAWEI MateBook D15 (BOD-WXX9 / "BohrD")**, Intel i5-1135G7, BIOS 2.31.

Other models may share the same interface, but command semantics can differ.
Test on your model before trusting the results.

## Reporting security issues

Open a private security advisory on GitHub, or contact the maintainer directly.
Please **do not** file public issues with hardware-damage claims before contacting
the maintainer.

## Legal note

This is an independent, unofficial project. It is **not affiliated with,
endorsed by, or supported by Huawei**. "Huawei" and "MateBook" are trademarks of
Huawei Technologies Co., Ltd. The ACPI-WMI protocol details were obtained by
reverse engineering for **interoperability and personal research** purposes.
