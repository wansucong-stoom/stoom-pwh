param([ValidateSet('Open','Save','Image')][string]$Mode,[string]$SuggestedName = '문서.hwpx',[switch]$HancomOnly)
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($Mode -eq 'Open') {
  $dialog = [System.Windows.Forms.OpenFileDialog]::new()
  $dialog.Filter = if ($HancomOnly) { '한글 문서 (*.hwp;*.hwpx)|*.hwp;*.hwpx' } else { '한글·Word 문서 (*.hwp;*.hwpx;*.docx)|*.hwp;*.hwpx;*.docx' }
  $dialog.CheckFileExists = $true
} elseif ($Mode -eq 'Image') {
  $dialog = [System.Windows.Forms.SaveFileDialog]::new()
  $dialog.Title = '그림으로 저장하기'
  $dialog.Filter = 'PNG 그림 (*.png)|*.png|JPEG 그림 (*.jpg)|*.jpg|BMP 그림 (*.bmp)|*.bmp|TIFF 그림 (*.tif)|*.tif|GIF 그림 (*.gif)|*.gif'
  $dialog.DefaultExt = 'png'
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $false
  $dialog.FileName = $SuggestedName
} else {
  $dialog = [System.Windows.Forms.SaveFileDialog]::new()
  $dialog.Filter = '한글 문서 (*.hwpx)|*.hwpx|Word 문서 (*.docx)|*.docx'
  $dialog.FilterIndex = if ($SuggestedName -match '\.docx$') { 2 } else { 1 }
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $true
  $dialog.FileName = $SuggestedName
}
$owner = [System.Windows.Forms.Form]::new()
$owner.Text = 'Pwh Desktop'
$icon = [System.Drawing.Icon]::new((Join-Path $PSScriptRoot 'stoom.ico'))
$owner.Icon = $icon
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.Size = [System.Drawing.Size]::new(1, 1)
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.Opacity = 0
$owner.TopMost = $true
try {
  $owner.Show()
  $owner.Activate()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    @{ cancelled = $false; path = $dialog.FileName } | ConvertTo-Json -Compress
  } else { @{ cancelled = $true } | ConvertTo-Json -Compress }
} finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose(); $icon.Dispose() }
