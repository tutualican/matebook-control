# MateBook Control - kalici ACPI-WMI calisani (worker)
# Eser sahibi: Alican Tutu (mbk-alican-tutu) — bu proje Alican Tutu'ya aittir.
# Node bu sureci bir kez baslatir; sonra her satirda gelen hex komutu calistirir.
# Protokol: stdin'e "AA BB CC" seklinde hex gonder; stdout'a "OK <hex...>" veya "ERR <mesaj>".

$ErrorActionPreference = 'Stop'
# Node tarafi utf8 okur; Turkce hata mesajlari bozulmasin.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$obj = $null
try {
    # NOT: Get-WmiObject + GetMethodParameters + InvokeMethod, PowerShell 5.1'de
    # u8Input bayt dizisi atanirken "PSObject -> System.Array atanamadi" hatasi verir.
    # CIM cmdletleri (Get-CimInstance + Invoke-CimMethod) bu sorunu yasamaz.
    $obj = Get-CimInstance -Namespace 'root\WMI' -ClassName 'OemWMIMethod' -ErrorAction Stop | Select-Object -First 1
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
        $r = Invoke-CimMethod -InputObject $obj -MethodName 'OemWMIfun' -Arguments @{ u8Input = $full }
        $o = $r.u8Output
        $hex = ''
        if ($o -ne $null) { $hex = ($o | ForEach-Object { $_.ToString('X2') }) -join ' ' }
        [Console]::Out.WriteLine('OK ' + $hex)
    } catch {
        [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
    }
    [Console]::Out.Flush()
}
