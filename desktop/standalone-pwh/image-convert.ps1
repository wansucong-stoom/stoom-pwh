param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [ValidateSet('jpeg','bmp','gif','tiff')][string]$Format
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (Test-Path -LiteralPath $OutputPath) { throw '이미지 변환 대상이 이미 있습니다.' }
$formats = @{
  jpeg = [System.Drawing.Imaging.ImageFormat]::Jpeg
  bmp = [System.Drawing.Imaging.ImageFormat]::Bmp
  gif = [System.Drawing.Imaging.ImageFormat]::Gif
  tiff = [System.Drawing.Imaging.ImageFormat]::Tiff
}
$stream = [System.IO.File]::OpenRead($InputPath)
try {
  $image = [System.Drawing.Image]::FromStream($stream, $true, $true)
  try { $image.Save($OutputPath, $formats[$Format]) } finally { $image.Dispose() }
} finally { $stream.Dispose() }
