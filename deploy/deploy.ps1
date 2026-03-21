# ===============================================================
#  deploy.ps1 - Deploiement via hote Proxmox + pct push
#  Flux historique: Windows -> hote PVE -> CT 107
#  Usage : .\deploy\deploy.ps1
# ===============================================================

param(
    [string]$ProxmoxHost = "10.0.0.10",
    [string]$ProxmoxUser = "root",
    [int]$CTID = 190,
    [string]$RemoteDir = "/opt/proxmox-interfaces",
    [string]$SSHKeyPath = "",
    [switch]$AcceptNewHostKey = $true
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Blue
Write-Host "  Proxmox-Interfaces - Deploiement (pct push)" -ForegroundColor Blue
Write-Host "============================================" -ForegroundColor Blue
Write-Host ""

$SourceDir = Split-Path -Parent $PSScriptRoot
$ArchivePath = Join-Path $env:TEMP "proxmox-interfaces-deploy.tgz"
$RemoteTmpArchive = "/tmp/proxmox-interfaces-deploy.tgz"
$SshTarget = "$ProxmoxUser@$ProxmoxHost"

foreach ($cmd in @("ssh", "scp", "tar")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[ERREUR] '$cmd' introuvable. Installez OpenSSH et tar." -ForegroundColor Red
        exit 1
    }
}

$sshOptions = @("-o", "BatchMode=yes")
if ($AcceptNewHostKey) {
    $sshOptions += @("-o", "StrictHostKeyChecking=accept-new")
}
if ($SSHKeyPath) {
    $sshOptions += @("-i", $SSHKeyPath)
}

$scpOptions = @()
if ($AcceptNewHostKey) {
    $scpOptions += @("-o", "StrictHostKeyChecking=accept-new")
}
if ($SSHKeyPath) {
    $scpOptions += @("-i", $SSHKeyPath)
}

function Invoke-Ssh([string]$command) {
    & ssh @sshOptions $SshTarget $command
    if ($LASTEXITCODE -ne 0) {
        throw "Commande SSH en echec: $command"
    }
}

Write-Host "[1/5] Creation de l'archive locale..." -ForegroundColor Yellow
if (Test-Path $ArchivePath) {
    Remove-Item -Force $ArchivePath
}
$ArchiveItems = @("package.json", "server.js", "public", "deploy")
$LocalEnvFile = Join-Path $SourceDir ".env"
if (Test-Path $LocalEnvFile) {
    $ArchiveItems += ".env"
}
tar -czf $ArchivePath -C $SourceDir @ArchiveItems
if ($LASTEXITCODE -ne 0) {
    throw "Echec creation archive $ArchivePath"
}

Write-Host "[2/5] Copie de l'archive vers l'hote Proxmox..." -ForegroundColor Yellow
& scp @scpOptions $ArchivePath "${SshTarget}:${RemoteTmpArchive}"
if ($LASTEXITCODE -ne 0) {
    throw "Echec copie archive vers $SshTarget"
}

Write-Host "[3/5] Push archive vers CT $CTID..." -ForegroundColor Yellow
Invoke-Ssh "pct push $CTID $RemoteTmpArchive $RemoteTmpArchive"

Write-Host "[4/5] Extraction + installation dans CT $CTID..." -ForegroundColor Yellow
Invoke-Ssh "pct exec $CTID -- bash -lc 'mkdir -p $RemoteDir; tar -xzf $RemoteTmpArchive -C $RemoteDir; rm -f $RemoteTmpArchive'"
Invoke-Ssh "rm -f $RemoteTmpArchive"
Invoke-Ssh "pct exec $CTID -- bash -lc 'chmod +x $RemoteDir/deploy/install.sh; bash $RemoteDir/deploy/install.sh'"

Write-Host "[5/5] Verification HTTP locale dans le CT..." -ForegroundColor Yellow
$result = (& ssh @sshOptions $SshTarget "pct exec $CTID -- curl -s -o /dev/null -w '%{http_code}' http://localhost/").Trim()

if ($result -eq "200") {
    Write-Host ""
    Write-Host "  OK Deploiement reussi ! HTTP 200" -ForegroundColor Green
    Write-Host "  Hote Proxmox : $ProxmoxHost" -ForegroundColor Cyan
    Write-Host "  CT cible     : $CTID" -ForegroundColor Cyan
} else {
    Write-Host "  Code HTTP: $result" -ForegroundColor Yellow
    Write-Host "  Logs: ssh $SshTarget 'pct exec $CTID -- journalctl -u proxmox-interfaces -n 80 --no-pager'" -ForegroundColor Yellow
    exit 1
}

if (Test-Path $ArchivePath) {
    Remove-Item -Force $ArchivePath
}

Write-Host ""
Write-Host "Deploiement termine." -ForegroundColor Green
Write-Host ""
