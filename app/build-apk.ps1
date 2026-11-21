<#
.SYNOPSIS
    Construit l'APK Android signe de l'application Coran 365 Qaloon (Capacitor).
#>
[CmdletBinding()]
param(
    [switch]$SkipWebSync,
    [string]$KeystoreDir = "C:\Users\dell\.adhkar-keys"
)

$ErrorActionPreference = 'Stop'
$AppDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidDir = Join-Path $AppDir 'android'
$Version   = '1.0.0'
$Alias     = 'adhkar'
$Keystore  = Join-Path $KeystoreDir 'adhkar-release.p12'
$PassFile  = Join-Path $KeystoreDir 'adhkar-keystore-password.txt'

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "   ERR $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. toolchain
Step 'Toolchain'
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
       elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
       else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) { Fail "SDK Android introuvable: $sdk" }
Ok "SDK Android : $sdk"

$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { 'java' }
$javaVer = cmd /c "`"$java`" -version 2>&1" | Select-Object -First 1
if (-not $javaVer) { Fail 'JDK introuvable (JAVA_HOME ?)' }
Ok "JDK : $javaVer"

$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt2     = Join-Path $buildTools.FullName 'aapt2.exe'
Ok "build-tools : $($buildTools.Name)"

# local.properties
"sdk.dir=$($sdk -replace '\\','\\')" | Set-Content (Join-Path $AndroidDir 'local.properties') -Encoding ASCII
Ok 'android/local.properties ecrit'

# ---------------------------------------------------------------- 2. keystore
Step 'Keystore de release'
if (-not (Test-Path $Keystore)) {
    New-Item -ItemType Directory -Force -Path $KeystoreDir | Out-Null
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $pw = -join (1..28 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    $pw | Set-Content $PassFile -Encoding ASCII -NoNewline
    $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    cmd /c "`"$keytool`" -genkeypair -v -keystore `"$Keystore`" -storetype PKCS12 -alias $Alias -keyalg RSA -keysize 4096 -validity 10950 -storepass $pw -keypass $pw -dname `"CN=Apex Global Solutions, OU=Quran365, O=Apex Global Solutions, L=Tunis, ST=Tunis, C=TN`" 2>&1" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Generation du keystore echouee' }
    Ok "keystore cree : $Keystore"
} else {
    Ok "keystore existant : $Keystore"
}
if (-not (Test-Path $PassFile)) { Fail "Mot de passe du keystore introuvable: $PassFile" }
$storePass = (Get-Content $PassFile -Raw).Trim()

@(
    "storeFile=$($Keystore -replace '\\','/')"
    "storePassword=$storePass"
    "keyAlias=$Alias"
    "keyPassword=$storePass"
) | Set-Content (Join-Path $AndroidDir 'keystore.properties') -Encoding ASCII
Ok 'android/keystore.properties ecrit'

# ---------------------------------------------------------------- 3. web + sync
if (-not $SkipWebSync) {
    Step 'Assemblage de www/'
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir 'sync-web.ps1')
    if ($LASTEXITCODE -ne 0) { Fail 'sync-web.ps1 a echoue' }
    Ok 'www/ reassemble'
}

Step 'capacitor sync'
Push-Location $AppDir
try {
    $ErrorActionPreference = 'Continue'
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { Fail 'cap sync a echoue' }
} finally { Pop-Location }
Ok 'projet Android synchronise'

# ---------------------------------------------------------------- 4. build
Step 'gradlew assembleRelease'
Push-Location $AndroidDir
try {
    $ErrorActionPreference = 'Continue'
    & .\gradlew.bat assembleRelease --console=plain
    if ($LASTEXITCODE -ne 0) { Fail 'gradlew assembleRelease a echoue' }
} finally { Pop-Location }

$built = Join-Path $AndroidDir 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { Fail "APK non produit: $built" }
Ok "APK produit : $built"

# ---------------------------------------------------------------- 5. livraison
Step 'Livraison'
$relDir = Join-Path $AppDir 'release'
New-Item -ItemType Directory -Force -Path $relDir | Out-Null
$final = Join-Path $relDir "coran365-$Version.apk"
Copy-Item $built $final -Force
$size = [math]::Round((Get-Item $final).Length / 1MB, 2)
Ok "copie locale : $final ($size Mo)"

# Verification de signature
$ErrorActionPreference = 'Continue'
$verify = (cmd /c "`"$apksigner`" verify --verbose --print-certs `"$final`" 2>&1") -join "`n"
if ($verify -match 'DOES NOT VERIFY|ERROR:') { Write-Host $verify; Fail 'Signature APK invalide' }
$verify -split "`n" |
    Where-Object { $_ -match 'Signer #1 certificate (DN|SHA-256)|Verified using v[12] scheme' } |
    ForEach-Object { Ok $_.Trim() }

(cmd /c "`"$aapt2`" dump badging `"$final`" 2>&1") |
    Select-String "package:|application-label:|sdkVersion|targetSdkVersion" |
    ForEach-Object { Write-Host "   $($_.Line.Trim())" }

# ---------------------------------------------------------------- 6. Deploiement Google Drive
Step 'Deploiement Google Drive'
$gdriveRoot = "G:\Mon Drive"
$gdriveApps = "G:\Mon Drive\Applications & Outils"

if (Test-Path $gdriveRoot) {
    $dest1 = Join-Path $gdriveRoot "coran365-$Version.apk"
    Copy-Item $final $dest1 -Force
    Ok "Google Drive racine : $dest1"
    
    if (Test-Path $gdriveApps) {
        $dest2 = Join-Path $gdriveApps "coran365-$Version.apk"
        Copy-Item $final $dest2 -Force
        Ok "Google Drive Applications & Outils : $dest2"
    }
} else {
    Write-Warning "Google Drive non detecte sur G:\"
}

Write-Host "`nTERMINE - APK pret et deploye." -ForegroundColor Green
exit 0
