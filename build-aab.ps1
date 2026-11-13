$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Water Polo Tactical Board - Android App Bundle (AAB)" -ForegroundColor Cyan
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
$sdkDir = "$env:LOCALAPPDATA\Android\Sdk"

# Locate JDK tools (jar.exe, keytool.exe, jarsigner.exe)
$jdkBin = Get-ChildItem -Path "$env:ProgramFiles\Java" -Filter "jarsigner.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DirectoryName
$jarExe = if ($jdkBin) { Join-Path $jdkBin "jar.exe" } else { "jar" }
$keytoolExe = if ($jdkBin) { Join-Path $jdkBin "keytool.exe" } else { "keytool" }
$jarsignerExe = if ($jdkBin) { Join-Path $jdkBin "jarsigner.exe" } else { "jarsigner" }

# Locate aapt2, d8.jar, android.jar, bundletool
$aapt2 = Get-ChildItem -Path "$sdkDir\build-tools" -Filter "aapt2.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$d8Jar = Get-ChildItem -Path "$sdkDir\build-tools" -Filter "d8.jar" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$androidJar = Get-ChildItem -Path "$sdkDir\platforms" -Filter "android.jar" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$bundletoolJar = Join-Path $sdkDir "bundletool-all.jar"

if (-not (Test-Path $bundletoolJar)) {
    Write-Host "Downloading bundletool..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar" -OutFile $bundletoolJar -UseBasicParsing
}

Write-Host "[1/7] Syncing web assets to android/app/src/main/assets..." -ForegroundColor Yellow
$assetsDir = Join-Path $projectDir "android\app\src\main\assets"
$resMipmapHdpi = Join-Path $projectDir "android\app\src\main\res\mipmap-hdpi"
$resMipmapXxhdpi = Join-Path $projectDir "android\app\src\main\res\mipmap-xxhdpi"

New-Item -ItemType Directory -Force -Path $assetsDir, $resMipmapHdpi, $resMipmapXxhdpi | Out-Null
$webFiles = @("index.html", "style.css", "app.js", "translations.js", "firebase-sync.js", "firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "manifest.json", "sw.js", "icon-192.png", "icon-512.png")
foreach ($f in $webFiles) {
    $srcFile = Join-Path $projectDir $f
    if (Test-Path $srcFile) {
        Copy-Item -Path $srcFile -Destination (Join-Path $assetsDir $f) -Force
    }
}
Copy-Item -Path (Join-Path $projectDir "icon-192.png") -Destination (Join-Path $resMipmapHdpi "ic_launcher.png") -Force
Copy-Item -Path (Join-Path $projectDir "icon-512.png") -Destination (Join-Path $resMipmapXxhdpi "ic_launcher.png") -Force

$workDir = "$env:TEMP\wptb_aab_build"
if (Test-Path $workDir) {
    Remove-Item -Path $workDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path "$workDir\gen", "$workDir\obj", "$workDir\dex", "$workDir\src", "$workDir\base_module\manifest", "$workDir\base_module\dex" | Out-Null
Copy-Item -Path (Join-Path $projectDir "android\app\src\main\*") -Destination "$workDir\src" -Recurse -Force

Write-Host "[2/7] Compiling Android resources with aapt2..." -ForegroundColor Yellow
& $aapt2 compile --dir "$workDir\src\res" -o "$workDir\compiled_res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

Write-Host "[3/7] Linking resources in Proto format (for App Bundle)..." -ForegroundColor Yellow
& $aapt2 link --proto-format -o "$workDir\base.apk" `
    -I "$androidJar" `
    --manifest "$workDir\src\AndroidManifest.xml" `
    -A "$workDir\src\assets" `
    --java "$workDir\gen" `
    "$workDir\compiled_res.zip" `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link proto-format failed" }

Write-Host "[4/7] Compiling Java sources & converting to DEX..." -ForegroundColor Yellow
$rJava = Get-ChildItem -Path "$workDir\gen" -Filter "R.java" -Recurse | Select-Object -First 1 -ExpandProperty FullName
$mainJava = "$workDir\src\java\com\waterpolo\tacticalboard\MainActivity.java"

& javac -encoding UTF-8 -Xlint:-options -source 8 -target 8 -bootclasspath "$androidJar" -d "$workDir\obj" "$rJava" "$mainJava"
if ($LASTEXITCODE -ne 0) { throw "javac compilation failed" }

& $jarExe -cf "$workDir\classes.jar" -C "$workDir\obj" .
& java -cp "$d8Jar" com.android.tools.r8.D8 --lib "$androidJar" --min-api 24 --release --output "$workDir\dex" "$workDir\classes.jar"
if ($LASTEXITCODE -ne 0) { throw "d8 dexing failed" }

Write-Host "[5/7] Assembling base module for App Bundle..." -ForegroundColor Yellow
$unpackedDir = "$workDir\unpacked_base"
New-Item -ItemType Directory -Force -Path $unpackedDir | Out-Null
Push-Location $unpackedDir
& $jarExe -xf "$workDir\base.apk"
Pop-Location

Copy-Item -Path "$unpackedDir\AndroidManifest.xml" -Destination "$workDir\base_module\manifest\AndroidManifest.xml" -Force
if (Test-Path "$unpackedDir\resources.pb") {
    Copy-Item -Path "$unpackedDir\resources.pb" -Destination "$workDir\base_module\resources.pb" -Force
}
if (Test-Path "$unpackedDir\res") {
    Copy-Item -Path "$unpackedDir\res" -Destination "$workDir\base_module\res" -Recurse -Force
}
if (Test-Path "$unpackedDir\assets") {
    Copy-Item -Path "$unpackedDir\assets" -Destination "$workDir\base_module\assets" -Recurse -Force
}
Copy-Item -Path "$workDir\dex\classes.dex" -Destination "$workDir\base_module\dex\classes.dex" -Force

Push-Location "$workDir\base_module"
& $jarExe -cMf "$workDir\base.zip" *
Pop-Location

Write-Host "[6/7] Building Android App Bundle with bundletool..." -ForegroundColor Yellow
$unsignedAab = "$workDir\unsigned.aab"
& java -jar "$bundletoolJar" build-bundle --modules="$workDir\base.zip" --output="$unsignedAab"
if ($LASTEXITCODE -ne 0) { throw "bundletool build-bundle failed" }

Write-Host "[7/7] Signing Android App Bundle with Release Key..." -ForegroundColor Yellow
$keystore = Join-Path $projectDir "android\release-key.jks"
& $jarsignerExe -keystore "$keystore" `
    -storepass "waterpolo123" `
    -keypass "waterpolo123" `
    -sigalg SHA256withRSA `
    -digestalg SHA-256 `
    "$unsignedAab" `
    "waterpolo"
if ($LASTEXITCODE -ne 0) { throw "jarsigner failed" }

Write-Host "Validating App Bundle integrity..." -ForegroundColor Yellow
& java -jar "$bundletoolJar" validate --bundle="$unsignedAab"
if ($LASTEXITCODE -ne 0) { throw "AAB validation failed" }

$archiveDir = Join-Path $projectDir "archive"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

$versionedAabName = "WaterPoloBoard-v$appVersion.aab"
$versionedAab = Join-Path $projectDir $versionedAabName

# Archive any previous AAB versions in root folder
Get-ChildItem -Path $projectDir -Filter "*.aab" -File | Where-Object { $_.Name -ne $versionedAabName } | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $archiveDir $_.Name) -Force
}

Copy-Item -Path "$unsignedAab" -Destination $versionedAab -Force

$aabSizeKB = [math]::Round((Get-Item $versionedAab).Length / 1KB, 1)
Write-Host ""
Write-Host "SUCCESS! Android App Bundle (.aab) created, signed and validated:" -ForegroundColor Green
Write-Host " -> $versionedAab ($aabSizeKB KB)" -ForegroundColor Green
Write-Host " Ready to upload directly to Google Play Console!" -ForegroundColor Cyan
