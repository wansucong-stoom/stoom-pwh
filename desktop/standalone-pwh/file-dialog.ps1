param([ValidateSet('Open','Save')][string]$Mode,[string]$SuggestedName = '문서.hwpx')
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($Mode -eq 'Open') {
  $dialog = [System.Windows.Forms.OpenFileDialog]::new()
  $dialog.Filter = '한글 문서 (*.hwp;*.hwpx)|*.hwp;*.hwpx'
  $dialog.CheckFileExists = $true
} else {
  $dialog = [System.Windows.Forms.SaveFileDialog]::new()
  $dialog.Filter = '한글 문서 (*.hwpx)|*.hwpx'
  $dialog.DefaultExt = 'hwpx'
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
