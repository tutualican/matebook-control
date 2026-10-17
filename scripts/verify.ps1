# MateBook Kontrol — ACPI-WMI dogrulama betigi
# Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
# YONETICI olarak calistirin. Tum komutlar 64 bayta doldurulur (OemWMIfun zorunlulugu).
# Kullanim:  powershell -ExecutionPolicy Bypass -File verify.ps1
# Secenek :  -Apply  (okumanin yani sira Performans modunu da uygular ve geri okur)

param([switch]$Apply)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host 'HATA: Bu betik YONETICI izni ister. PowerShell'i "Yonetici olarak calistir" ile acin.' -ForegroundColor Red
    exit 1
}

$obj = Get-WmiObject -Namespace 'root\WMI' -Class 'OemWMIMethod' | Select-Object -First 1
if ($null -eq $obj) { Write-Host 'HATA: OemWMIMethod bulunamadi.' -ForegroundColor Red; exit 1 }
Write-Host "OemWMIMethod: $($obj.InstanceName)" -ForegroundColor Green

function Wmi([byte[]]$cmd) {
    $full = New-Object 'byte[]' 64
    $n = [Math]::Min($cmd.Length, 64)
    for ($i = 0; $i -lt $n; $i++) { $full[$i] = $cmd[$i] }
    $p = $obj.GetMethodParameters('OemWMIfun')
    $p['u8Input'] = $full
    return $obj.InvokeMethod('OemWMIfun', $p, $null)['u8Output']
}
function Hx([byte[]]$o, $n = 8) { (($o[0..([Math]::Min($n, $o.Length - 1))] | ForEach-Object { $_.ToString('X2') }) -join ' ') }

$modeNames = @{ 0 = 'Dengeli'; 1 = 'Performans'; 2 = 'Enerji Tasarrufu' }

Write-Host "`n--- OKUMA TESTLERI ---" -ForegroundColor Cyan
$o = Wmi @(0x04, 0x10); Write-Host ("GetWorkingMode  04 10      => {0}  (mod={1} {2})" -f (Hx $o), $o[1], $modeNames[$o[1]])

$o = Wmi @(0x04, 0x12)
$perf = if ($o[1] -eq 0) { "mod=$($o[2])" } else { "gecersiz (bayrak=$($o[1]))" }
Write-Host ("GetPerformanceMode 04 12   => {0}  ({1})" -f (Hx $o), $perf)

$o = Wmi @(0x04, 0x0e); Write-Host ("GetTurboMode    04 0e      => {0}  (turbo={1})" -f (Hx $o), ($o[1] -eq 1))
$o = Wmi @(0x02, 0x08, 0x00); Write-Host ("GetFanSpeed     02 08 00  => {0}  (fan={1} RPM)" -f (Hx $o), ($o[1] -bor ($o[2] -shl 8)))
$o = Wmi @(0x02, 0x08, 0x01); Write-Host ("GetFanSpeed     02 08 01  => {0}  (fan={1} RPM)" -f (Hx $o), ($o[1] -bor ($o[2] -shl 8)))

$o = Wmi @(0x02, 0x02, 0x00)
$temp = if ($o[1] -eq 1) { -[int]$o[2] } else { [int]$o[2] }
Write-Host ("GetSensorTemp   02 02 00  => {0}  (sicaklik={1}C)" -f (Hx $o), $temp)

$o = Wmi @(0x03, 0x16); Write-Host ("GetSmartCharge  03 16      => {0}  (mode={1} alt={2} ust={3})" -f (Hx $o), $o[1], $o[3], $o[4])
$o = Wmi @(0x03, 0x14); Write-Host ("GetAcDuration   03 14      => {0}  (dakika={1})" -f (Hx $o), ($o[1] -bor ($o[2] -shl 8)))
$o = Wmi @(0x03, 0x17); Write-Host ("GetProchotReason 03 17     => {0}" -f (Hx $o))

if ($Apply) {
    Write-Host "`n--- UYGULAMA TESTI (Performans) ---" -ForegroundColor Yellow
    Wmi @(0x04, 0x11, 0x01) | Out-Null; Write-Host 'SetWorkingMode  04 11 01 gonderildi'
    Wmi @(0x04, 0x13, 0x01) | Out-Null; Write-Host 'SetPerformanceMode 04 13 01 gonderildi'
    Wmi @(0x04, 0x0f, 0x01) | Out-Null; Write-Host 'SetTurboMode    04 0f 01 gonderildi (pil dahil)'
    Start-Sleep -Milliseconds 800
    $o = Wmi @(0x04, 0x10); Write-Host ("Geri okuma: mod={0} {1}" -f $o[1], $modeNames[$o[1]]) -ForegroundColor Green
    $o = Wmi @(0x04, 0x12); Write-Host ("Geri okuma: performance-mode={0}" -f $o[2]) -ForegroundColor Green
    $o = Wmi @(0x04, 0x0e); Write-Host ("Geri okuma: turbo={0}" -f ($o[1] -eq 1)) -ForegroundColor Green
}

Write-Host "`nBitti. (Tum komutlar 64 bayta dolduruldu.)" -ForegroundColor Cyan
