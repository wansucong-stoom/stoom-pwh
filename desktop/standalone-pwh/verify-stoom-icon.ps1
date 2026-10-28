param(
  [string]$Icon = (Join-Path $PSScriptRoot 'stoom.ico'),
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not ('PwhStaticIconImage' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PwhStaticIconImage {
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int cx, int cy, uint flags);
 [DllImport("user32.dll", SetLastError=true)] public static extern bool DestroyIcon(IntPtr icon);
}
'@
}
$iconPath = (Resolve-Path -LiteralPath $Icon).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$frames = foreach ($size in @(16,24,32,48,64,128,256)) {
  # Load image resources only; this does not enumerate or control any window.
  $handle = [PwhStaticIconImage]::LoadImageW([IntPtr]::Zero,$iconPath,1,$size,$size,16)
  if ($handle -eq [IntPtr]::Zero) { throw "Native icon decoder failed for $size" }
  try {
    $decodedIcon = [System.Drawing.Icon]::FromHandle($handle)
    try {
      $bitmap = $decodedIcon.ToBitmap()
      try {
        if ($bitmap.Width -ne $size -or $bitmap.Height -ne $size) { throw "Native icon size mismatch for $size" }
        $minX=$size; $minY=$size; $maxX=-1; $maxY=-1
        for ($y=0; $y -lt $size; $y++) { for ($x=0; $x -lt $size; $x++) {
          if ($bitmap.GetPixel($x,$y).A -gt 0) { $minX=[Math]::Min($minX,$x); $minY=[Math]::Min($minY,$y); $maxX=[Math]::Max($maxX,$x); $maxY=[Math]::Max($maxY,$y) }
        }}
        if ($minX -lt 1 -or $minY -lt 1 -or $maxX -ge $size-1 -or $maxY -ge $size-1) { throw "Native icon touches the edge for $size" }
        $bitmap.Save((Join-Path $outputPath "win32-$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
        [PSCustomObject]@{size=$size; width=$bitmap.Width; height=$bitmap.Height; minX=$minX; minY=$minY; maxX=$maxX; maxY=$maxY}
      } finally { $bitmap.Dispose() }
    } finally { $decodedIcon.Dispose() }
  } finally { [PwhStaticIconImage]::DestroyIcon($handle) | Out-Null }
}
$report = [PSCustomObject]@{sha256=(Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash.ToLowerInvariant(); frames=@($frames)}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputPath 'native-icon-report.json') -Encoding utf8
$report | ConvertTo-Json -Depth 4 -Compress
