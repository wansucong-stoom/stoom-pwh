param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PwhClipboardRaw {
 [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr owner);
 [DllImport("user32.dll")] public static extern bool CloseClipboard();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string format);
 [DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint format);
 [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr h);
 [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr h);
 [DllImport("kernel32.dll")] public static extern UIntPtr GlobalSize(IntPtr h);
}
"@
# Read only after the user initiates table paste. Never enumerate clipboard
# history, access the source application or modify the system clipboard.
$taskData = [Windows.Forms.Clipboard]::GetDataObject()
$taskHtml = ''
$taskText = ''
$taskPng = ''
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
    if ($taskData.GetDataPresent([Windows.Forms.DataFormats]::Bitmap, $true)) {
        $taskImage = [Windows.Forms.Clipboard]::GetImage()
        if ($null -ne $taskImage) {
            try {
                if (($taskImage.Width * [long]$taskImage.Height) -gt 16000000) { throw 'Clipboard image exceeds supported dimensions' }
                $taskStream = [IO.MemoryStream]::new()
                try {
                    $taskImage.Save($taskStream, [Drawing.Imaging.ImageFormat]::Png)
                    if ($taskStream.Length -gt 8MB) { throw 'Clipboard image exceeds supported size' }
                    $taskPng = [Convert]::ToBase64String($taskStream.ToArray())
                } finally { $taskStream.Dispose() }
            } finally { $taskImage.Dispose() }
        }
    }
}
# Windows Forms decodes CF_HTML as the active ANSI code page on some systems,
# corrupting UTF-8 and the embedded Hancom model. Read the original bytes.
if ($taskFormats -contains 'HTML Format') {
    if (-not [PwhClipboardRaw]::OpenClipboard([IntPtr]::Zero)) { throw 'Clipboard is unavailable' }
    try {
        $taskHandle = [PwhClipboardRaw]::GetClipboardData([PwhClipboardRaw]::RegisterClipboardFormat('HTML Format'))
        if ($taskHandle -eq [IntPtr]::Zero) { throw 'HTML clipboard data is unavailable' }
        $taskLength = [PwhClipboardRaw]::GlobalSize($taskHandle).ToUInt64()
        if ($taskLength -gt 8MB) { throw 'Clipboard HTML exceeds the supported size' }
        $taskPointer = [PwhClipboardRaw]::GlobalLock($taskHandle)
        if ($taskPointer -eq [IntPtr]::Zero) { throw 'Clipboard HTML cannot be read' }
        try {
            $taskBytes = [byte[]]::new([int]$taskLength)
            [Runtime.InteropServices.Marshal]::Copy($taskPointer, $taskBytes, 0, [int]$taskLength)
            $taskHtml = [Text.Encoding]::UTF8.GetString($taskBytes).TrimEnd([char]0)
        } finally { [void][PwhClipboardRaw]::GlobalUnlock($taskHandle) }
    } finally { [void][PwhClipboardRaw]::CloseClipboard() }
}
if ($taskHtml.Length -gt 8MB -or $taskText.Length -gt 24000) { throw 'Clipboard table exceeds the supported size' }
@{html=$taskHtml.TrimEnd([char]0);text=$taskText;formats=$taskFormats;png=$taskPng} | ConvertTo-Json -Compress -Depth 3
