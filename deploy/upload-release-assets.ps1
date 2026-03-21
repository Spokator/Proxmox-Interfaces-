param(
    [Parameter(Mandatory = $true)]
    [string]$Repo,

    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string[]]$Assets
)

$ErrorActionPreference = "Stop"

if (-not $env:GITHUB_TOKEN) {
    throw "GITHUB_TOKEN is required"
}

$apiHeaders = @{
    Authorization = "Bearer $($env:GITHUB_TOKEN)"
    Accept = "application/vnd.github+json"
    "User-Agent" = "Proxmox-Interfaces-Asset-Uploader"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$release = Invoke-RestMethod -Method GET -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $apiHeaders
$uploadBase = ([string]$release.upload_url).Split('{')[0]

if (-not $Assets -or $Assets.Count -eq 0) {
    $Assets = @(
        ".\\dist\\proxmox-interfaces-v1.0.0.tar.gz",
        ".\\dist\\proxmox-interfaces-v1.0.0.sha256",
        ".\\dist\\proxmox-interfaces-latest.tar.gz",
        ".\\dist\\proxmox-interfaces-latest.sha256"
    )
}

foreach ($asset in $Assets) {
    if (-not (Test-Path $asset)) {
        throw "Asset not found: $asset"
    }

    $name = [System.IO.Path]::GetFileName($asset)
    $exists = $false
    foreach ($ea in $release.assets) {
        if ($ea.name -eq $name) { $exists = $true; break }
    }

    if ($exists) {
        Write-Host "[SKIP] Already present: $name"
        continue
    }

    $uploadUri = "${uploadBase}?name=$([uri]::EscapeDataString($name))"
    Write-Host "[INFO] Uploading $name..."

    $uploadHeaders = @{
        Authorization = "Bearer $($env:GITHUB_TOKEN)"
        Accept = "application/vnd.github+json"
        "User-Agent" = "Proxmox-Interfaces-Asset-Uploader"
        "X-GitHub-Api-Version" = "2022-11-28"
        "Content-Type" = "application/octet-stream"
    }

    Invoke-RestMethod -Method POST -Uri $uploadUri -Headers $uploadHeaders -InFile $asset | Out-Null
}

$releaseFinal = Invoke-RestMethod -Method GET -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $apiHeaders
$releaseFinal.assets | Select-Object name,size,browser_download_url | Format-Table -AutoSize
