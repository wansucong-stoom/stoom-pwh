param([Parameter(Mandatory=$true)][string]$SourceRoot, [string]$NodePath = $env:PWH_NODE_PATH)
$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskNode = if ($NodePath) { $NodePath } else { (Get-Command node -ErrorAction Stop).Source }
$taskCommit = (git -C $SourceRoot rev-parse HEAD).Trim()
if ($taskCommit -ne '1a76570e833917d15817415a53c09ad61ab3203f') { throw 'This additive bridge targets rhwp v0.8.7 only.' }
$taskStudioRoot = Join-Path $SourceRoot 'rhwp-studio'
$taskMainPath = Join-Path $taskStudioRoot 'src\main.ts'
Copy-Item -LiteralPath (Join-Path $taskProjectRoot 'src\studio-selection.ts') -Destination (Join-Path $taskStudioRoot 'src\collaboration-selection.ts') -Force
$taskMainSource = Get-Content -Raw -LiteralPath $taskMainPath
if (-not $taskMainSource.Contains("from './collaboration-selection'")) {
  $taskAddition = @'

// pwh: read-only source coordinates for the user's actual editor selection.
import { installSelectionBridge } from './collaboration-selection';
installSelectionBridge({ getInputHandler: () => inputHandler, wasm,
  getDocumentAgent: () => documentAgent, getCanvasView: () => canvasView });
'@
  [IO.File]::WriteAllText($taskMainPath, $taskMainSource + $taskAddition, [Text.UTF8Encoding]::new($false))
}
$env:RHWP_DISABLE_EXTERNAL_WEBFONTS = '1'
Push-Location $taskStudioRoot
try { & $taskNode 'node_modules\vite\bin\vite.js' build --base=/studio/ --outDir dist-pwh; if ($LASTEXITCODE -ne 0) { throw 'Studio build failed' } }
finally { Pop-Location }
