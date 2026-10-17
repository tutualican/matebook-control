#requires -Version 5.1
<#
  MateBook Kontrol - SES SURUCUSU ASAMASI
  --------------------------------------
  Eser sahibi: Alican Tutu (mbk-alican-tutu)

  Ne yapar (modelden bagimsiz):
   1) Makinedeki ses donanimini ve kurulu surucu surumunu tespit eder.
   2) Bilinen MateBook modelleri icin Huawei'nin RESMI destek sitesi surucu API'sini kontrol eder.
   3) Huawei PC Manager kuruluysa, resmi HOTA/surucu verisini okur.
   4) Resmi olarak daha yeni bir ses surucusu varsa, KURMADAN ONCE Sistem Geri Yukleme Noktasi olusturur.
   5) Guncellemeyi Huawei'nin resmi kanaliyla (PC Manager OTA) sunar; PC Manager yoksa destek sitesini acar.

  Not: Huawei ses suruculerini genelde tek basina .exe olarak degil, PC Manager uzerinden dagitir.
  Yonetici (elevation) gerekir.
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Say($m) { Write-Host $m }

# ---- 0) Yonetici mi? ----
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Say "Yonetici izni gerekiyor. Yeniden baslatiliyor..."
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

Say "================ MATEBOOK KONTROL - SES SURUCUSU ASAMASI ================"

# ---- 1) Makine ----
$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$mfg = if ($cs) { $cs.Manufacturer } else { '' }
$model = if ($cs) { $cs.Model } else { '' }
Say ("`n[1] Makine: {0} {1}" -f $mfg, $model)
if ($mfg -notmatch 'HUAWEI') {
  Say "  UYARI: Bu arac Huawei MateBook icin tasarlandi; ses bilgileri yine de gosterilecek."
}

# ---- 2) Ses donanimi + kurulu surucu ----
Say "`n[2] Ses donanimi ve kurulu surucu:"
$audio = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue |
  Where-Object { $_.DeviceName -match 'ESAuDriver|SST|Smart Sound|Huawei Audio|HWVE|Nahimic|A-Volute|Realtek.*Audio|Intel.*Audio|High Definition Audio' }
$audio | Select-Object DeviceName, DriverVersion, DriverDate, DriverProviderName | Format-Table -AutoSize
$primary = $audio |
  Where-Object { $_.DeviceName -match 'ESAuDriver|Realtek.*Audio|Intel.*Audio|SST|Smart Sound' } |
  Sort-Object { try { [version]$_.DriverVersion } catch { [version]'0.0.0.0' } } -Descending |
  Select-Object -First 1
$installed = if ($primary) { $primary.DriverVersion } else { $null }
if ($installed) {
  Say ("Kurulu birincil ses surucusu: v{0}  ({1})" -f $installed, $primary.DeviceName)
} else {
  Say "Kurulu birincil ses surucusu: bulunamadi"
}

# ---- 3) Resmi urun kodu esleme (model -> offeringCode) ----
$productMap = @{
  'BOD-WXX9' = 'OFFE00109128'   # MateBook D 14/15 2020 Intel
  'BoD-WXX9' = 'OFFE00109128'
  'BoB-WAH9' = 'OFFE00109128'
  'BOD-WXX9P' = 'OFFE00109128'
}
$offeringCode = $null
foreach ($k in $productMap.Keys) {
  if ($model -match [regex]::Escape($k)) { $offeringCode = $productMap[$k]; break }
}

$officialAudioVer = $null
if ($offeringCode) {
  Say "`n[3] Huawei RESMI destek sitesi kontrol ediliyor (offeringCode=$offeringCode)..."
  $appId = "96E6614BD648F3582A2D6D657C5CC768"   # resmi sitenin kamuya acik istemci kimligi
  $apiBase = "https://ccpce-de.consumer.huawei.com/ccpcmd/services/dispatch/secured/CCPC/EN"
  $hdr = @{ "Accept" = "application/json"; "SGW-APP-ID" = $appId; "Origin" = "https://consumer.huawei.com"; "Referer" = "https://consumer.huawei.com/tr/support/driver-list/"; "User-Agent" = "Mozilla/5.0" }
  try {
    $u = "$apiBase/knowledgeBase/getServicePolicy/1000?knowTypeId=63&orderType=1&page=1&pageSize=1000&offeringCode=$offeringCode&cflag=1&countryCode=TR&langCode=tr&siteCode=tr_TR&areaCode=tr"
    $t = (Invoke-WebRequest -Uri $u -Method GET -Headers $hdr -UseBasicParsing -TimeoutSec 45).Content
    if ($t.StartsWith("(")) { $t = $t.Substring(1) }
    if ($t.EndsWith(")")) { $t = $t.Substring(0, $t.Length - 1) }
    $official = $t | ConvertFrom-Json
    if ($official -and $official.responseData.detailList) {
      Say "  Resmi sitedeki indirilebilir paketler:"
      foreach ($d in $official.responseData.detailList) {
        Say ("   - {0}  (surum {1}, {2}) [{3}]" -f $d.resourceTitle, $d.versionNumber, $d.fileSize, $d.knowTypeId)
      }
      Say "  > Huawei suruculeri genelde PC Manager uzerinden dagitir; tek basina ses .exe paketi olmayabilir."
    } else {
      Say "  Sitede listelenen paket bulunamadi."
    }
  } catch {
    Say ("  Resmi siteye ulasilamadi: " + $_.Exception.Message)
  }
} else {
  Say "`n[3] Bu model icin resmi urun eslemesi yok; site kontrolu atlandi."
}

# ---- 4) PC Manager resmi HOTA verisi (varsa) ----
Say "`n[4] Huawei PC Manager resmi surucu verisi (varsa) kontrol ediliyor..."
$dls = "C:\ProgramData\Comms\BasicService\DriverUpgrade\DriverListServer.xml"
$hasPcmData = Test-Path $dls
if ($hasPcmData) {
  try {
    $xml = [xml](Get-Content $dls -Raw)
    $dev = $xml.driverlist.device
    Say ("  Cihaz kodu: {0}  (liste surumu {1})" -f $dev, $xml.driverlist.version)
    $node = $xml.driverlist.$dev.driver | Where-Object { $_.appname -eq 'AudioSX' }
    if ($node) { Say ("  Resmi ses paketi: {0}  hwid={1}" -f $node.packagename, $node.hwid) }
  } catch { Say "  PC Manager surucu verisi okunamadi." }
  $bslog = "C:\ProgramData\Comms\BasicService\log\admin\BasicService.log"
  if (Test-Path $bslog) {
    $hit = Select-String -Path $bslog -Pattern 'Find package OTA-.*-AudioSX-([0-9\.]+)' -AllMatches |
      ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Select-Object -Last 1
    if ($hit) { $officialAudioVer = $hit; Say ("  Resmi kanalda bulunan guncel ses surucusu: {0}" -f $hit) }
  }
} else {
  Say "  PC Manager kurulu degil gibi (DriverListServer.xml yok)."
}

# ---- 5) Karsilastir ----
Say "`n[5] Karsilastirma:"
$updateAvailable = $false
if ($installed -and $officialAudioVer) {
  Say ("  Kurulu: {0}    Resmi guncel: {1}" -f $installed, $officialAudioVer)
  try {
    if ([version]$officialAudioVer -gt [version]$installed) { $updateAvailable = $true; Say "  => DAHA YENI bir ses surucusu MEVCUT." }
    else { Say "  => Kurulu surucu guncel gorunuyor." }
  } catch { }
} elseif ($officialAudioVer) {
  Say ("  Resmi guncel surum: {0} (kurulu surum okunamadi)" -f $officialAudioVer); $updateAvailable = $true
} else {
  Say "  Resmi guncel surum bilgisi alinamadi."
}

# ---- 6) Geri yukleme noktasi (yalnizca guncelleme varsa) ----
if ($updateAvailable) {
  Say "`n[6] Kurulumdan once Sistem Geri Yukleme Noktasi olusturuluyor..."
  try {
    Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
    try { Checkpoint-Computer -Description "MateBook Kontrol ses surucusu oncesi" -RestorePointCreationFrequency 0 -ErrorAction Stop }
    catch { Checkpoint-Computer -Description "MateBook Kontrol ses surucusu oncesi" }
    Say "  Geri yukleme noktasi olusturuldu."
  } catch {
    Say ("  UYARI: Geri yukleme noktasi olusturulamadi: " + $_.Exception.Message)
    Say "  Devam ediliyor (Huawei surucu paketleri imzalidir)."
  }
} else {
  Say "`n[6] Guncelleme bulunmadigi icin geri yukleme noktasi olusturulmadi."
}

# ---- 7) Resmi kanali tetikle ----
Say "`n[7] Huawei'nin resmi guncelleme kanali tetikleniyor..."
$ota = "C:\Program Files\Huawei\PCManager\OTAWndShow.exe"
$pcm = "C:\Program Files\Huawei\PCManager\PCManager.exe"
$started = $false
if (Test-Path $ota) { Start-Process $ota; $started = $true; Say "  Resmi OTA penceresi acildi (OTAWndShow.exe)." }
if (Test-Path $pcm) { Start-Process $pcm; $started = $true; Say "  PC Manager acildi." }
if (-not $started) {
  Say "  PC Manager kurulu degil. Huawei destek sitesi aciliyor..."
  Start-Process "https://consumer.huawei.com/tr/support/driver-list/"
}

Say "`n================ BITTI ================"
Say "Ozet:"
Say ("  - Kurulu ses surucusu : {0}" -f ($(if ($installed) { $installed } else { 'bilinmiyor' })))
Say ("  - Resmi guncel surum  : {0}" -f ($(if ($officialAudioVer) { $officialAudioVer } else { 'bilinmiyor' })))
Say ("  - PC Manager          : " + ($(if ((Test-Path $pcm) -or (Test-Path $ota)) { 'kurulu' } else { 'yok' })))
Say ("  - Geri yukleme noktasi: " + ($(if ($updateAvailable) { 'olusturuldu (basariysa)' } else { 'gerekmedi' })))
