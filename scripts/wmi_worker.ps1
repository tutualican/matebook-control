# MateBook Control - kalici ACPI-WMI calisani (worker)
# Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
# Node bu sureci bir kez baslatir; sonra her satirda gelen hex komutu calistirir.
# Protokol: stdin'e "AA BB CC" seklinde hex gonder; stdout'a "OK <hex...>" veya "ERR <mesaj>".

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding

$obj = $null
try {
    $obj = Get-WmiObject -Namespace 'root\WMI' -Class 'OemWMIMethod' -ErrorAction Stop | Select-Object -First 1
} catch {
    $obj = $null
}

if ($obj -eq $null) {
    [Console]::Out.WriteLine('READY FAIL OemWMIMethod bulunamadi (yonetici izni gerekli olabilir)')
    [Console]::Out.Flush()
    exit 1
}
[Console]::Out.WriteLine('READY OK')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    if ($line -eq 'QUIT') { break }
    try {
        $parts = $line.Split(' ')
        # OemWMIfun, u8Input icin TAM 64 bayt ister; kisa komutlar 64'e doldurulmalidir.
        $full = New-Object 'byte[]' 64
        $n = [Math]::Min($parts.Length, 64)
        for ($i = 0; $i -lt $n; $i++) {
            $full[$i] = [byte]([Convert]::ToInt32($parts[$i], 16))
        }
        $p = $obj.GetMethodParameters('OemWMIfun')
        $p['u8Input'] = $full
        $r = $obj.InvokeMethod('OemWMIfun', $p, $null)
        $hex = ($r['u8Output'] | ForEach-Object { $_.ToString('X2') }) -join ' '
        [Console]::Out.WriteLine('OK ' + $hex)
    } catch {
        [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
    }
    [Console]::Out.Flush()
}
