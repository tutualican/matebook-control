#!/usr/bin/env bash
# MateBook Kontrol — Linux yetki yardımcısı (root olarak çalıştırılır: sudo/pkexec).
# Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
# Uygulama bunun aynısını bash'e satır içi geçirir; bu dosya elle kullanım içindir.
#
# Kullanım:
#   sudo bash priv-helper.sh --profile perf|balanced|eco [--no-pp]
#   sudo bash priv-helper.sh --charge <alt> <üst>
#   sudo bash priv-helper.sh --resume
#
set -u
PP=/sys/firmware/acpi/platform_profile
PPC=/sys/firmware/acpi/platform_profile_choices
profile=""; charge_lo=""; charge_hi=""; resume=0; nopp=0
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --charge)  charge_lo="${2:-}"; charge_hi="${3:-}"; shift 3 ;;
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
