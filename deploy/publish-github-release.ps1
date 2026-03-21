param(
    [Parameter(Mandatory = $true)]
    [string]$Repo,

    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$Name = "",
    [string]$NotesFile = "",
    [string[]]$Assets = @(),
    [switch]$Prerelease,
    [switch]$Draft
)

$ErrorActionPreference = "Stop"

if (-not $env:GITHUB_TOKEN) {
    throw "GITHUB_TOKEN is required. Set it in the environment before running this script."
}

if (-not $Name) {
    $Name = $Tag
}

$headers = @{
    Authorization = "Bearer $($env:GITHUB_TOKEN)"
    Accept = "application/vnd.github+json"
    "User-Agent" = "Proxmox-Interfaces-Release-Script"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$bodyText = ""
if ($NotesFile -and (Test-Path $NotesFile)) {
    $bodyText = Get-Content -Raw -Path $NotesFile
}

$payload = @{
    tag_name = $Tag
    name = $Name
    body = $bodyText
    draft = [bool]$Draft
    prerelease = [bool]$Prerelease
}

$releaseUrl = "https://api.github.com/repos/$Repo/releases"

Write-Host "[INFO] Creating release $Tag on $Repo..."
$response = Invoke-RestMethod -Method POST -Uri $releaseUrl -Headers $headers -Body ($payload | ConvertTo-Json -Depth 5) -ContentType "application/json"

$uploadUrlRaw = [string]$response.upload_url
$uploadBase = $uploadUrlRaw -replace "\{\?name,label\}", ""

if (-not $Assets -or $Assets.Count -eq 0) {
    Write-Host "[OK] Release created (no assets uploaded)."
    Write-Host "Release URL: $($response.html_url)"
    exit 0
}

foreach ($asset in $Assets) {
    if (-not (Test-Path $asset)) {
        throw "Asset not found: $asset"
    }

    $assetName = [System.IO.Path]::GetFileName($asset)
    $uri = "$uploadBase?name=$([uri]::EscapeDataString($assetName))"

    Write-Host "[INFO] Uploading $assetName..."
    Invoke-RestMethod -Method POST -Uri $uri -Headers @{
        Authorization = "Bearer $($env:GITHUB_TOKEN)"
        Accept = "application/vnd.github+json"
        "User-Agent" = "Proxmox-Interfaces-Release-Script"
        "X-GitHub-Api-Version" = "2022-11-28"
        "Content-Type" = "application/octet-stream"
    } -InFile $asset
}

Write-Host "[OK] Release created with assets."
Write-Host "Release URL: $($response.html_url)"
