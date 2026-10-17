#!/usr/bin/env bash
# MateBook Kontrol — Linux baslatici (kaynaktan calistirmak icin)
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules/electron ]; then
  echo "Bagimliliklar kuruluyor (electron)..."
  npm install
fi

# Yazma islemleri (/sys) root ister. Uygulama pkexec/sudo ile tek tek yukseltir.
# Istersen tum uygulamayi root calistirabilirsin (o zaman hic sifre sorulmaz):
#   sudo ./run-linux.sh --no-sandbox
if [ "$(id -u)" = "0" ]; then
  echo "Root olarak calisiyor: tum sysfs yazmalari dogrudan yapilir."
  exec ./node_modules/.bin/electron . --no-sandbox "$@"
fi

if command -v pkexec >/dev/null 2>&1; then
  echo "Not: mod/şarj degisikliklerinde polkit sifresi istenebilir (pkexec)."
else
  echo "Not: pkexec yok. Yazma islemleri icin 'sudo' veya root gerekebilir."
fi

exec ./node_modules/.bin/electron . "$@"
