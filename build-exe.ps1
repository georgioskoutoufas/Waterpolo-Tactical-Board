$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Water Polo Tactical Board - Windows EXE Builder" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$projectDir = $PSScriptRoot
$versionFile = Join-Path $projectDir "version.json"
$appVersion = "1.0-alpha"
if (Test-Path $versionFile) {
    try {
        $vJson = Get-Content $versionFile -Raw | ConvertFrom-Json
        if ($vJson.version) { $appVersion = $vJson.version }
    } catch {}
}
Write-Host "Target Version: v$appVersion" -ForegroundColor Magenta
$winProjDir = Join-Path $projectDir "windows\WaterPoloBoard"
$embeddedDir = Join-Path $winProjDir "EmbeddedAssets"

New-Item -ItemType Directory -Force -Path $embeddedDir | Out-Null

Write-Host "[1/4] Generating high-resolution application icon (.ico)..." -ForegroundColor Yellow
Add-Type -AssemblyName System.Drawing

function Convert-PngToIco($pngPath, $icoPath) {
    $sizes = @(16, 32, 48, 64, 128, 256)
    $srcBmp = [System.Drawing.Bitmap]::FromFile($pngPath)
    $images = @()

    foreach ($size in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap $size, $size
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($srcBmp, 0, 0, $size, $size)
        $g.Dispose()

        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $images += @{ Size = $size; Bytes = $ms.ToArray() }
        $bmp.Dispose()
    }
    $srcBmp.Dispose()

    $fs = [System.IO.File]::OpenWrite($icoPath)
    $bw = New-Object System.IO.BinaryWriter $fs

    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$images.Count)

    $offset = 6 + (16 * $images.Count)
    foreach ($img in $images) {
        $width = if ($img.Size -ge 256) { 0 } else { [byte]$img.Size }
        $height = if ($img.Size -ge 256) { 0 } else { [byte]$img.Size }
        $bw.Write([byte]$width)
        $bw.Write([byte]$height)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$img.Bytes.Length)
        $bw.Write([uint32]$offset)
        $offset += $img.Bytes.Length
    }

    foreach ($img in $images) {
        $bw.Write($img.Bytes)
    }

    $bw.Flush()
    $fs.Close()
}

$icoDest = Join-Path $winProjDir "app.ico"
Convert-PngToIco (Join-Path $projectDir "icon-512.png") $icoDest
Copy-Item -Path $icoDest -Destination (Join-Path $embeddedDir "icon.ico") -Force

Write-Host "[2/4] Syncing web assets to EmbeddedAssets..." -ForegroundColor Yellow
$webFiles = @("index.html", "style.css", "app.js", "translations.js", "firebase-sync.js", "firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "manifest.json", "sw.js", "icon-192.png", "icon-512.png")
foreach ($f in $webFiles) {
    $src = Join-Path $projectDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $embeddedDir $f) -Force
    }
}

Write-Host "[3/4] Publishing Self-Contained Standalone Single-File Windows .exe..." -ForegroundColor Yellow
$publishDir = Join-Path $winProjDir "bin\Release\publish-standalone"

Push-Location $winProjDir
try {
    & dotnet publish -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true `
        -p:EnableCompressionInSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -o $publishDir
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host "[4/4] Copying WaterPoloBoard-v$appVersion.exe to root folder & archiving old versions..." -ForegroundColor Yellow
$archiveDir = Join-Path $projectDir "archive"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

$builtExe = Join-Path $publishDir "WaterPoloBoard.exe"
$versionedExeName = "WaterPoloBoard-v$appVersion.exe"
$versionedExe = Join-Path $projectDir $versionedExeName

# Archive any previous EXE versions in root folder
Get-ChildItem -Path $projectDir -Filter "*.exe" -File | Where-Object { $_.Name -ne $versionedExeName } | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $archiveDir $_.Name) -Force
}

# If an existing instance is running, close it so we can update the executable
Get-Process -Name "WaterPoloBoard*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600

Copy-Item -Path $builtExe -Destination $versionedExe -Force

$sizeMB = [math]::Round((Get-Item $versionedExe).Length / 1MB, 1)

Write-Host ""
Write-Host "SUCCESS! Windows Standalone App (.exe) is ready:" -ForegroundColor Green
Write-Host " -> $versionedExe ($sizeMB MB)" -ForegroundColor Green
Write-Host " -> Older versions archived in: $archiveDir" -ForegroundColor Gray
Write-Host " (100% Standalone - Runs directly on any Windows 10/11 PC with a double-click!)" -ForegroundColor Green
