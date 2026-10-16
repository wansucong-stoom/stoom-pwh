param([string]$InitialDirectory,[string]$SuggestedName)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$dialog = New-Object System.Windows.Forms.SaveFileDialog
try {
  $dialog.Title = 'pwh - Save new HWPX revision'
  $dialog.Filter = 'HWPX (*.hwpx)|*.hwpx'
  $dialog.DefaultExt = 'hwpx'
  $dialog.AddExtension = $true
  $dialog.CheckPathExists = $true
  $dialog.InitialDirectory = $InitialDirectory
  $dialog.FileName = $SuggestedName
  $dialog.add_FileOk({param($sender,$eventArgs)
    if(Test-Path -LiteralPath $sender.FileName){
      $eventArgs.Cancel = $true
      [System.Windows.Forms.MessageBox]::Show('Please choose a new filename. Existing files are preserved.','pwh') | Out-Null
    }
  })
  if($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){
    @{cancelled=$false;path=$dialog.FileName} | ConvertTo-Json -Compress
  }else{ @{cancelled=$true} | ConvertTo-Json -Compress }
}finally{ $dialog.Dispose(); $owner.Dispose() }
