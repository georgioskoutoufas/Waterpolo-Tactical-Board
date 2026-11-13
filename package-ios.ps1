$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Water Polo Tactical Board - iOS Xcode Package Builder" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$projectDir = $PSScriptRoot
$versionFile = Join-Path $projectDir "version.json"
$appVersion = "1.0.2"
if (Test-Path $versionFile) {
    try {
        $vJson = Get-Content $versionFile -Raw | ConvertFrom-Json
        if ($vJson.version) { $appVersion = $vJson.version }
    } catch {}
}
Write-Host "Target Version: v$appVersion" -ForegroundColor Magenta

$iosDir = Join-Path $projectDir "ios"
$webAssetsDir = Join-Path $iosDir "WebAssets"
New-Item -ItemType Directory -Force -Path $webAssetsDir | Out-Null

Write-Host "[1/3] Syncing latest web assets to ios/WebAssets..." -ForegroundColor Yellow
$webFiles = @(
    "index.html",
    "style.css",
    "app.js",
    "translations.js",
    "firebase-sync.js",
    "firebase-app.js",
    "firebase-auth.js",
    "firebase-firestore.js",
    "manifest.json",
    "sw.js",
    "icon-192.png",
    "icon-512.png",
    "version.json"
)

foreach ($f in $webFiles) {
    $src = Join-Path $projectDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $webAssetsDir $f) -Force
    }
}

Write-Host "[2/3] Archiving older iOS zip packages..." -ForegroundColor Yellow
$archiveDir = Join-Path $projectDir "archive"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

$zipName = "WaterPoloBoard-v$appVersion-iOS-Xcode-Project.zip"
$zipPath = Join-Path $projectDir $zipName

Get-ChildItem -Path $projectDir -Filter "*iOS*.zip" -File | Where-Object { $_.Name -ne $zipName } | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $archiveDir $_.Name) -Force
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "[3/3] Packaging full native iOS Xcode project into $zipName..." -ForegroundColor Yellow
Compress-Archive -Path "$iosDir\*" -DestinationPath $zipPath -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "SUCCESS! Complete iOS Xcode Project Package created:" -ForegroundColor Green
Write-Host " -> $zipPath ($sizeMB MB)" -ForegroundColor Green
Write-Host " Unzip on Mac, double-click WaterPoloBoard.xcodeproj, and click Product -> Archive to upload to Apple App Store!" -ForegroundColor Cyan
