$ErrorActionPreference = "Stop"

$projectDir = $PSScriptRoot
$versionFile = Join-Path $projectDir "version.json"
$appVersion = "2.0-alpha"
if (Test-Path $versionFile) {
    try {
        $vJson = Get-Content $versionFile -Raw | ConvertFrom-Json
        if ($vJson.version) { $appVersion = $vJson.version }
    } catch {}
}

$webFiles = @(
    "index.html",
    "style.css",
    "app.js",
    "translations.js",
    "manifest.json",
    "sw.js",
    "icon-192.png",
    "icon-512.png",
    "screenshot.png",
    "version.json"
)

$fullPaths = $webFiles | ForEach-Object { Join-Path $projectDir $_ }
$zipName = "WaterPoloBoard-v$appVersion-Web.zip"
$zipPath = Join-Path $projectDir $zipName

$archiveDir = Join-Path $projectDir "archive"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

# Archive older web zip packages
Get-ChildItem -Path $projectDir -Filter "*Web.zip" -File | Where-Object { $_.Name -ne $zipName } | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $archiveDir $_.Name) -Force
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path $fullPaths -DestinationPath $zipPath -Force
$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)

Write-Host "SUCCESS! Web / iOS Package created:" -ForegroundColor Green
Write-Host " -> $zipPath ($sizeKB KB)" -ForegroundColor Green
