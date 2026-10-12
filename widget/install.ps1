# Builds the widget, copies it to %LOCALAPPDATA%\Claude Code Analytics Widget and starts it.
# "Start with Windows" in the widget's menu points at that copy.
$ErrorActionPreference = 'Stop'

if (Get-Process cca-widget -ErrorAction SilentlyContinue) {
  throw 'The widget is running: right-click it and choose Quit first, or the exe is locked.'
}

cargo build --release --manifest-path "$PSScriptRoot/Cargo.toml"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dir = Join-Path $env:LOCALAPPDATA 'Claude Code Analytics Widget'
New-Item -ItemType Directory -Force $dir | Out-Null
$exe = Join-Path $dir 'cca-widget.exe'
Copy-Item "$PSScriptRoot/target/release/cca-widget.exe" $exe -Force
Start-Process $exe
Write-Host "Installed and started $exe"
