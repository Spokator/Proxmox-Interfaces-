param(
    [Parameter(Mandatory = $true)]
    [string]$Repo,

    [string]$Branch = "main",

    [string[]]$RequiredChecks = @("test", "npm-audit", "Analyze"),

    [switch]$EnforceAdmins,

    [int]$Approvals = 1,

    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$token = $env:GITHUB_TOKEN
if (-not $token) {
    $token = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "User")
}

if (-not $token) {
    throw "GITHUB_TOKEN is required (env or user-level environment variable)."
}

if ($Repo -notmatch "^[^/]+/[^/]+$") {
    throw "Repo must be in the form <owner>/<repo>."
}

$owner, $name = $Repo.Split("/")

$headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "User-Agent" = "Proxmox-Interfaces-Branch-Protection"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$repoUri = "https://api.github.com/repos/$owner/$name"
$repoInfo = Invoke-RestMethod -Method GET -Uri $repoUri -Headers $headers
$hasAdmin = [bool]($repoInfo.permissions -and $repoInfo.permissions.admin)

Write-Host "[INFO] Repo: $Repo"
Write-Host "[INFO] Branch: $Branch"
Write-Host "[INFO] Token has admin permission on repo: $hasAdmin"

if ($CheckOnly) {
    $branchInfo = Invoke-RestMethod -Method GET -Uri "https://api.github.com/repos/$owner/$name/branches/$Branch" -Headers $headers
    Write-Host "[OK] CheckOnly mode"
    Write-Host "Branch protected: $($branchInfo.protected)"
    Write-Host "Required checks (target): $($RequiredChecks -join ', ')"
    exit 0
}

if (-not $hasAdmin) {
    throw "This token cannot configure branch protection (admin permission required on $Repo)."
}

$payload = @{
    required_status_checks = @{
        strict = $true
        contexts = $RequiredChecks
    }
    enforce_admins = [bool]$EnforceAdmins
    required_pull_request_reviews = @{
        dismiss_stale_reviews = $true
        require_code_owner_reviews = $true
        required_approving_review_count = $Approvals
    }
    restrictions = $null
    required_linear_history = $true
    allow_force_pushes = $false
    allow_deletions = $false
    block_creations = $false
    required_conversation_resolution = $true
    lock_branch = $false
    allow_fork_syncing = $false
} | ConvertTo-Json -Depth 10 -Compress

$uri = "https://api.github.com/repos/$owner/$name/branches/$Branch/protection"

try {
    Invoke-RestMethod -Method PUT -Uri $uri -Headers $headers -Body $payload -ContentType "application/json; charset=utf-8" | Out-Null
} catch {
    $msg = $_.Exception.Message
    $details = $_.ErrorDetails.Message
    if ($details -and $details -match 'Resource not accessible by personal access token') {
        throw "Failed to set branch protection: token lacks required write permission for repository administration. For fine-grained PAT, grant 'Administration: Read and write' on $Repo. Details: $details"
    }
    throw "Failed to set branch protection. Message: $msg. Details: $details"
}

$state = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers

Write-Host "[OK] Branch protection configured"
Write-Host "Repo: $Repo"
Write-Host "Branch: $Branch"
Write-Host "Require PR review: $([bool]($state.required_pull_request_reviews -ne $null))"
Write-Host "Approvals: $($state.required_pull_request_reviews.required_approving_review_count)"
Write-Host "Code owner reviews: $($state.required_pull_request_reviews.require_code_owner_reviews)"
Write-Host "Require conversation resolution: $($state.required_conversation_resolution.enabled)"
Write-Host "Allow force pushes: $($state.allow_force_pushes.enabled)"
Write-Host "Allow deletions: $($state.allow_deletions.enabled)"
Write-Host "Required checks: $($RequiredChecks -join ', ')"
