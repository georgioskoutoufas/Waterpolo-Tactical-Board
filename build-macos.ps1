$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Water Polo Tactical Board - macOS .app Builder" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$projectDir = $PSScriptRoot
$versionFile = Join-Path $projectDir "version.json"
$appVersion = "1.5-alpha"
if (Test-Path $versionFile) {
    try {
        $vJson = Get-Content $versionFile -Raw | ConvertFrom-Json
        if ($vJson.version) { $appVersion = $vJson.version }
    } catch {}
}
Write-Host "Target Version: v$appVersion" -ForegroundColor Magenta

$macProjDir = Join-Path $projectDir "macos\WaterPoloBoardMac"
$workDir = "$env:TEMP\wptb_macos_build"
if (Test-Path $workDir) {
    Remove-Item -Path $workDir -Recurse -Force
}

$appBundleDir = Join-Path $workDir "WaterPoloBoard.app"
$contentsDir = Join-Path $appBundleDir "Contents"
$macOsBinDir = Join-Path $contentsDir "MacOS"
$resourcesDir = Join-Path $contentsDir "Resources"
$assetsDir = Join-Path $resourcesDir "assets"

New-Item -ItemType Directory -Force -Path $macOsBinDir, $assetsDir | Out-Null

Write-Host "[1/4] Compiling native macOS Mach-O executable (osx-arm64)..." -ForegroundColor Yellow
Push-Location $macProjDir
try {
    & dotnet publish -c Release -r osx-arm64 --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -o $macOsBinDir
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish osx-arm64 failed" }
} finally {
    Pop-Location
}

Write-Host "[2/4] Bundling web assets & application icon into WaterPoloBoard.app/Contents/Resources..." -ForegroundColor Yellow
$webFiles = @("index.html", "style.css", "app.js", "translations.js", "manifest.json", "sw.js", "icon-192.png", "icon-512.png")
foreach ($f in $webFiles) {
    $src = Join-Path $projectDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $assetsDir $f) -Force
    }
}
Copy-Item -Path (Join-Path $projectDir "icon-512.png") -Destination (Join-Path $resourcesDir "AppIcon.png") -Force

Write-Host "[3/4] Writing macOS Info.plist..." -ForegroundColor Yellow
$infoPlist = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>el</string>
    <key>CFBundleDisplayName</key>
    <string>Πινακάκι Πόλο</string>
    <key>CFBundleExecutable</key>
    <string>WaterPoloBoard</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon.png</string>
    <key>CFBundleIdentifier</key>
    <string>com.waterpolo.tacticalboard</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>WaterPoloBoard</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$appVersion</string>
    <key>CFBundleVersion</key>
    <string>15</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Δημιουργός: Γεώργιος Κουτουφάς (Georgios Koutoufas)</string>
</dict>
</plist>
"@
Set-Content -Path (Join-Path $contentsDir "Info.plist") -Value $infoPlist -Encoding UTF8

Write-Host "[4/4] Packaging WaterPoloBoard.app into WaterPoloBoard-v$appVersion-macOS.zip..." -ForegroundColor Yellow
$archiveDir = Join-Path $projectDir "archive"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

$zipName = "WaterPoloBoard-v$appVersion-macOS.zip"
$destZip = Join-Path $projectDir $zipName

Get-ChildItem -Path $projectDir -Filter "*-macOS.zip" -File | Where-Object { $_.Name -ne $zipName } | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $archiveDir $_.Name) -Force
}

if (Test-Path $destZip) { Remove-Item -Path $destZip -Force }
$packScript = Join-Path $projectDir "package_macos.py"
& python "$packScript" "$appBundleDir" "$destZip"

$sizeMB = [math]::Round((Get-Item $destZip).Length / 1MB, 1)
Write-Host ""
Write-Host "SUCCESS! macOS Native App Bundle (.app) is ready:" -ForegroundColor Green
Write-Host " -> $destZip ($sizeMB MB)" -ForegroundColor Green
