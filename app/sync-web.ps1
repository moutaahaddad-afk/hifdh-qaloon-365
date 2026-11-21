# Assemble le dossier www/ de l'app Android à partir du site hifdh-qaloon-365 (dossier parent).
$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = Split-Path -Parent $appDir
$www    = Join-Path $appDir "www"

if (Test-Path $www) { Remove-Item -Path $www -Recurse -Force }
New-Item -ItemType Directory -Path $www -Force | Out-Null

$files = @(
  "index.html",
  "manifest.json",
  "sw.js",
  "quran-data.json",
  "schedule_365.js",
  "surahs.js",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
  "favicon.ico",
  "favicon.svg",
  "favicon-16.png",
  "favicon-32.png",
  "apple-touch-icon.png"
)

$missing = @()
foreach ($f in $files) {
  $p = Join-Path $srcDir $f
  if (Test-Path $p) { Copy-Item -Path $p -Destination $www -Force }
  else { $missing += $f }
}

# Dossiers d'assets éventuels
foreach ($d in @("icons")) {
  $p = Join-Path $srcDir $d
  if (Test-Path $p) { Copy-Item -Path $p -Destination (Join-Path $www $d) -Recurse -Force }
  else { $missing += "$d/" }
}

# Copie des fichiers audio locaux (les petits MP3, sans le gros fichier 018_kahf.mp3 qui fait 41Mo)
$audioSrc = Join-Path $srcDir "audio\qaloon_husary"
if (Test-Path $audioSrc) {
  $audioDest = Join-Path $www "audio\qaloon_husary"
  New-Item -ItemType Directory -Path $audioDest -Force | Out-Null
  Get-ChildItem -Path $audioSrc -File -Filter "*.mp3" | Where-Object { $_.Length -lt 2MB } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $audioDest -Force
  }
}

if ($missing.Count -gt 0) { Write-Warning ("Absents (ignorés) : " + ($missing -join ", ")) }

$total = (Get-ChildItem -Path $www -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("www/ assemblé : {0} fichiers, {1:N2} Mo" -f (Get-ChildItem -Path $www -Recurse -File).Count, ($total / 1MB))
