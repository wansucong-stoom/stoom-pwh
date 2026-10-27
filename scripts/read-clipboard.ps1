param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
# Read only after the user initiates table paste. Never enumerate clipboard
# history, access the source application or modify the system clipboard.
$taskData = [Windows.Forms.Clipboard]::GetDataObject()
$taskHtml = ''
$taskText = ''
$taskFormats = @()
if ($null -ne $taskData) {
    $taskFormats = @($taskData.GetFormats($false) | Select-Object -First 32)
    if ($taskData.GetDataPresent('HTML Format', $false)) {
        $taskValue = $taskData.GetData('HTML Format', $false)
        if ($taskValue -is [string]) { $taskHtml = $taskValue }
        elseif ($taskValue -is [IO.MemoryStream]) { $taskHtml = [Text.Encoding]::UTF8.GetString($taskValue.ToArray()) }
        elseif ($taskValue -is [byte[]]) { $taskHtml = [Text.Encoding]::UTF8.GetString($taskValue) }
    }
    if ($taskData.GetDataPresent('UnicodeText', $false)) { $taskText = [string]$taskData.GetData('UnicodeText', $false) }
}
if ($taskHtml.Length -gt 8MB -or $taskText.Length -gt 24000) { throw 'Clipboard table exceeds the supported size' }
@{html=$taskHtml.TrimEnd([char]0);text=$taskText;formats=$taskFormats} | ConvertTo-Json -Compress -Depth 3
