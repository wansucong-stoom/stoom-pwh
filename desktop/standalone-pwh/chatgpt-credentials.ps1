param(
  [Parameter(Mandatory=$true)][ValidateSet('protect','unprotect','lock')][string]$Action,
  [string]$LockFile
)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'lock') {
  if (-not [IO.Path]::IsPathRooted($LockFile)) { exit 2 }
  $stream = $null
  for ($i = 0; $i -lt 150; $i++) {
    try {
      $stream = [IO.FileStream]::new($LockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      break
    } catch [IO.IOException] { Start-Sleep -Milliseconds 100 }
  }
  if (-not $stream) { exit 3 }
  try {
    [Console]::Out.WriteLine('locked')
    [Console]::Out.Flush()
    [void][Console]::In.ReadToEnd()
  } finally { $stream.Dispose() }
  exit 0
}
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$entropy = [Text.Encoding]::UTF8.GetBytes('STOOM Pwh Desktop ChatGPT credential store v1')
if ($Action -eq 'protect') {
  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
}
[Console]::Out.Write([Convert]::ToBase64String($result))
