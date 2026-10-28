param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\PwhDesktop'),
  [string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'PwhDesktop'),
  [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$') { throw '설치 패키지 버전이 올바르지 않습니다.' }
$appTarget = [IO.Path]::GetFullPath((Join-Path $InstallRoot $manifest.version))
if (Test-Path -LiteralPath $appTarget) { throw '이 버전의 설치 폴더가 이미 있습니다. 기존 앱을 변경하지 않았습니다.' }
foreach ($required in @('PwhDesktop.exe','engine/core/rhwp_bg.wasm','standalone-pwh/stoom.ico')) {
  if ($required -notin $manifest.files.path) { throw '독립 앱 실행 파일 또는 조판 엔진을 확인하지 못했습니다.' }
}
foreach ($entry in $manifest.files) {
  if ($entry.path -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($entry.path)) { throw '설치 파일 경로가 올바르지 않습니다.' }
  $item = Join-Path $packageRoot $entry.path
  if (-not (Test-Path -LiteralPath $item -PathType Leaf) -or (Get-Item -LiteralPath $item).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '설치 파일을 확인하지 못했습니다.' }
  if ((Get-FileHash -LiteralPath $item -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw '설치 파일의 무결성을 확인하지 못했습니다.' }
}
New-Item -ItemType Directory -Path $appTarget -Force | Out-Null
foreach ($entry in $manifest.files) {
  $destination = Join-Path $appTarget $entry.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $packageRoot $entry.path) -Destination $destination
}
# The package already contains the verified engine next to the executable,
# exactly as the native launcher and MSI installation expect.
if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('DesktopDirectory')
  $shortcutPath = Join-Path $desktop 'Pwh Desktop.lnk'
  if (Test-Path -LiteralPath $shortcutPath) { $shortcutPath = Join-Path $desktop ('Pwh Desktop ' + $manifest.version + '.lnk') }
  if (Test-Path -LiteralPath $shortcutPath) { throw '바로가기 이름이 이미 있습니다. 설치된 PwhDesktop.exe를 직접 실행하세요.' }
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcutPath)
  $link.TargetPath = Join-Path $appTarget 'PwhDesktop.exe'
  $link.IconLocation = (Join-Path $appTarget 'PwhDesktop.exe') + ',0'
  $link.WorkingDirectory = $appTarget
  $link.Description = 'Pwh Desktop 독립 조판기'
  $link.Save()
}
Write-Output "Pwh Desktop 설치 완료: $appTarget"
Write-Output 'Codex AI는 별도로 설치된 Codex의 로그인 상태를 사용합니다.'
Write-Output 'Windows 앱 목록에서 설치·제거하려면 MSI 설치판을 사용하세요.'
