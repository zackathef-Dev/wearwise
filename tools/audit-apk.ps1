param([Parameter(Mandatory=$true)][string]$Apk, [Parameter(Mandatory=$true)][string]$Report)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk))
$findings = [Collections.Generic.List[object]]::new()
$patterns = @{
  'private-key' = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  'privileged-key' = 'sb_secret_[A-Za-z0-9_-]{15,}|sbp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}'
  'developer-path' = '(?i)[CD]:[\\/]+Users[\\/]+|/Users/'
  'development-network' = '(?i)(https?://|wss?://)(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.[0-9]+\.[0-9]+)'
}
# The account name of whoever builds and audits the APK, so a leaked build path is caught on any machine.
$user = if ($env:USERNAME) { $env:USERNAME } elseif ($env:USER) { $env:USER } else { $null }
if ($user) { $patterns['developer-username'] = '(?i)' + [regex]::Escape($user) }
try {
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -match '(?i)(^|/)(\.env[^/]*|key.properties|.*\.(jks|keystore|map|pem|key)|.*service.account.*\.json)$') {
      $findings.Add(@{entry=$entry.FullName; category='sensitive-filename'})
    }
    if ($entry.Length -eq 0) { continue }
    $stream = $entry.Open()
    $memory = [IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); $bytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
    foreach ($encoding in @([Text.Encoding]::UTF8, [Text.Encoding]::Unicode)) {
      $content = $encoding.GetString($bytes)
      foreach ($name in $patterns.Keys) {
        if ([regex]::IsMatch($content, $patterns[$name])) { $findings.Add(@{entry=$entry.FullName; category=$name}) }
      }
    }
  }
  $result = @{apk=(Resolve-Path -LiteralPath $Apk).Path; sha256=(Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash; entries=$archive.Entries.Count; findings=@($findings.ToArray())}
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report
  Write-Output ('Scanned {0} archive entries; {1} findings. Values are not printed.' -f $archive.Entries.Count, $findings.Count)
} finally { $archive.Dispose() }
