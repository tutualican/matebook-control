@echo off
REM ============================================================
REM  MateBook Kontrol - tek tikla baslatici (kaynaktan)
REM  - Yonetici izni yoksa otomatik olarak UAC ile yeniden baslar
REM  - Elektron kurulu degilse otomatik npm install yapar
REM  - Alican Tutu (Apache-2.0)
REM ============================================================
setlocal
cd /d "%~dp0"

REM --- Yonetici miyiz? Degilsek kendini yonetici olarak yeniden baslat ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  [i] ACPI-WMI icin yonetici izni gerekiyor. UAC penceresi aciliyor...
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo  ============================================
echo    MateBook Kontrol baslatiliyor...
echo  ============================================
echo.

REM --- Node.js kurulu mu? ---
where npm.cmd >nul 2>&1
if %errorlevel% neq 0 (
  echo  [X] Node.js bulunamadi.
  echo      Lutfen https://nodejs.org adresinden Node.js LTS kurup tekrar deneyin.
  echo.
  pause
  exit /b 1
)

REM --- Bagimliliklar yoksa kur (ilk calistirmada birkac dakika surer) ---
if not exist "node_modules\electron\dist\electron.exe" (
  echo  [i] Bagimliliklar kuruluyor... (ilk seferde birkac dakika surebilir)
  echo.
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [X] Kurulum basarisiz oldu. Internet baglantinizi kontrol edin.
    echo.
    pause
    exit /b 1
  )
)

echo  [i] Uygulama aciliyor...
start "" "node_modules\electron\dist\electron.exe" .
endlocal
