@echo off
REM MateBook Kontrol - Windows baslatici (kaynaktan calistirir)
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Elektron bulunamadi, kuruluyor...
  call npm.cmd install
)
start "" "node_modules\electron\dist\electron.exe" .
