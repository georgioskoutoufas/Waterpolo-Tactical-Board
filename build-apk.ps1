$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Water Polo Tactical Board - Android APK Builder" -ForegroundColor Cyan
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

# Locate JDK tools (jar.exe, keytool.exe)
$jdkBin = Get-ChildItem -Path "$env:ProgramFiles\Java" -Filter "jar.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DirectoryName
$jarExe = if ($jdkBin) { Join-Path $jdkBin "jar.exe" } else { "jar" }
$keytoolExe = if ($jdkBin) { Join-Path $jdkBin "keytool.exe" } else { "keytool" }

# Locate aapt2, zipalign, d8.jar, apksigner.jar, and android.jar
$aapt2 = Get-ChildItem -Path "$sdkDir\build-tools" -Filter "aapt2.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$zipalign = Get-ChildItem -Path "$sdkDir\build-tools" -Filter "zipalign.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$d8Jar = Get-ChildItem -Path "$sdkDir\build-tools" -Filter "d8.jar" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$apksignerJar = Get-ChildItem -Path "$sdkDir\build-tools" -Filter "apksigner.jar" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$androidJar = Get-ChildItem -Path "$sdkDir\platforms" -Filter "android.jar" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

if (-not $aapt2 -or -not $androidJar) {
    throw "Android SDK build-tools or android.jar not found in $sdkDir"
}

Write-Host "[1/6] Syncing web assets to android/app/src/main/assets..." -ForegroundColor Yellow
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

# Stage in ASCII-only temp folder so native C++ tools (aapt2, zipalign) have zero issues with Greek characters in path
$workDir = "$env:TEMP\wptb_apk_build"
if (Test-Path $workDir) {
    Remove-Item -Path $workDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path "$workDir\gen", "$workDir\obj", "$workDir\dex", "$workDir\src" | Out-Null

Copy-Item -Path (Join-Path $projectDir "android\app\src\main\*") -Destination "$workDir\src" -Recurse -Force

Write-Host "[2/6] Compiling Android resources with aapt2..." -ForegroundColor Yellow
& $aapt2 compile --dir "$workDir\src\res" -o "$workDir\compiled_res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& $aapt2 link -o "$workDir\unaligned.apk" `
    -I "$androidJar" `
    --manifest "$workDir\src\AndroidManifest.xml" `
    -A "$workDir\src\assets" `
    --java "$workDir\gen" `
    "$workDir\compiled_res.zip" `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

Write-Host "[3/6] Compiling Java sources (MainActivity.java)..." -ForegroundColor Yellow
$rJava = Get-ChildItem -Path "$workDir\gen" -Filter "R.java" -Recurse | Select-Object -First 1 -ExpandProperty FullName
$mainJava = "$workDir\src\java\com\waterpolo\tacticalboard\MainActivity.java"

& javac -encoding UTF-8 -Xlint:-options -source 8 -target 8 -bootclasspath "$androidJar" -d "$workDir\obj" "$rJava" "$mainJava"
if ($LASTEXITCODE -ne 0) { throw "javac compilation failed" }

Write-Host "[4/6] Converting bytecode to Android DEX (d8)..." -ForegroundColor Yellow
& $jarExe -cf "$workDir\classes.jar" -C "$workDir\obj" .
& java -cp "$d8Jar" com.android.tools.r8.D8 --lib "$androidJar" --min-api 24 --release --output "$workDir\dex" "$workDir\classes.jar"
if ($LASTEXITCODE -ne 0) { throw "d8 dexing failed" }

# Add classes.dex into the root of unaligned.apk (uncompressed STORED mode -u0f for Android runtime compatibility)
Push-Location "$workDir\dex"
& $jarExe -u0f "$workDir\unaligned.apk" "classes.dex"
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "Adding classes.dex to APK failed" }

Write-Host "[5/6] Aligning APK with zipalign..." -ForegroundColor Yellow
& $zipalign -f -p 4 "$workDir\unaligned.apk" "$workDir\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

Write-Host "[6/6] Signing APK with apksigner..." -ForegroundColor Yellow
$keystore = "$workDir\release-key.jks"
$savedKeystore = Join-Path $projectDir "android\release-key.jks"
if (Test-Path $savedKeystore) {
    Copy-Item -Path $savedKeystore -Destination $keystore -Force
} else {
    & $keytoolExe -genkeypair -v `
        -keystore "$keystore" `
        -alias "waterpolo" `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -storepass "waterpolo123" `
        -keypass "waterpolo123" `
        -dname "CN=Water Polo Tactical Board, OU=Coaching, O=WaterPolo, L=Athens, S=Attica, C=GR"
    Copy-Item -Path $keystore -Destination $savedKeystore -Force
}

& java -jar "$apksignerJar" sign `
    --ks "$keystore" `
    --ks-key-alias "waterpolo" `
    --ks-pass "pass:waterpolo123" `
    --key-pass "pass:waterpolo123" `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --v3-signing-enabled true `
    --out "$workDir\WaterPolo-Tactical-Board.apk" `
    "$workDir\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

& java -jar "$apksignerJar" verify "$workDir\WaterPolo-Tactical-Board.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner verification failed" }

$archiveDir = Join-Path $projectDir "archive"
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

$versionedApkName = "WaterPoloBoard-v$appVersion.apk"
$versionedApk = Join-Path $projectDir $versionedApkName

# Archive any previous APK versions in root folder
Get-ChildItem -Path $projectDir -Filter "*.apk" -File | Where-Object { $_.Name -ne $versionedApkName } | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $archiveDir $_.Name) -Force
}

Copy-Item -Path "$workDir\WaterPolo-Tactical-Board.apk" -Destination $versionedApk -Force

$apkSizeKB = [math]::Round((Get-Item $versionedApk).Length / 1KB, 1)
Write-Host ""
Write-Host "SUCCESS! Android APK built and signed:" -ForegroundColor Green
Write-Host " -> $versionedApk ($apkSizeKB KB)" -ForegroundColor Green
Write-Host " -> Older versions archived in: $archiveDir" -ForegroundColor Gray
