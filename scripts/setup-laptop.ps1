# =====================================================================
# Laptop Setup - MyPos_SDK54 / Ts_MyTool
# Run on a new laptop to install all tools and clone both repos.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\setup-laptop.ps1
#
# Auto:
#   - Install: Git, GitHub CLI, .NET SDK 8, Node.js LTS (via winget)
#   - GitHub auth (browser opens once)
#   - Create C:\MyProjects and clone MyPos_SDK54 + Ts_MyTool
#
# Manual after script (printed at the end):
#   - Copy .env from main PC (Firebase / Kakao / Sentry keys)
# =====================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "=================================================="
Write-Host "  Laptop Setup - MyPos / Ts_MyTool"
Write-Host "=================================================="
Write-Host ""

# ----- 1. Install tools via winget -----------------------------
Write-Host "[1/4] Installing tools via winget..."
Write-Host "  Git, GitHub CLI, .NET SDK 8, Node.js LTS"
Write-Host ""

$pkgs = @(
    "Git.Git",
    "GitHub.cli",
    "Microsoft.DotNet.SDK.8",
    "OpenJS.NodeJS.LTS"
)
foreach ($pkg in $pkgs) {
    Write-Host "  Installing: $pkg"
    winget install --id $pkg --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null
}
Write-Host "  Done."
Write-Host ""

# ----- 2. Refresh PATH ------------------------------------------
Write-Host "[2/4] Refreshing PATH..."
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = $machinePath + ";" + $userPath
Write-Host "  Done."
Write-Host ""

# ----- 3. GitHub auth -------------------------------------------
Write-Host "[3/4] GitHub authentication (browser opens)..."
Write-Host "  Login as: overson76"
Write-Host ""
$ghStatus = gh auth status 2>&1
if ($ghStatus -match "Logged in") {
    Write-Host "  Already logged in."
} else {
    gh auth login
}
Write-Host ""

# ----- 4. Clone projects ----------------------------------------
Write-Host "[4/4] Cloning projects..."

$projectsDir = "C:\MyProjects"
if (-not (Test-Path $projectsDir)) {
    New-Item -ItemType Directory -Path $projectsDir | Out-Null
    Write-Host "  Created $projectsDir"
}
Set-Location $projectsDir

$repos = @("MyPos_SDK54", "Ts_MyTool")
foreach ($repo in $repos) {
    $target = Join-Path $projectsDir $repo
    if (Test-Path $target) {
        Write-Host "  Exists: $repo (skip)"
    } else {
        Write-Host "  Cloning: overson76/$repo"
        gh repo clone "overson76/$repo" $target
    }
}
Write-Host "  Done."
Write-Host ""

# ----- Final notes ----------------------------------------------
Write-Host "=================================================="
Write-Host "  Setup complete."
Write-Host "=================================================="
Write-Host ""
Write-Host "Manual steps remaining:"
Write-Host ""
Write-Host "  1. Copy .env (Firebase / Kakao / Sentry keys)"
Write-Host "     From main PC:  C:\MyProjects\MyPos_SDK54\.env"
Write-Host "     To laptop:     same location"
Write-Host "     Transfer via secure messenger or USB."
Write-Host ""
Write-Host "  2. Start working:"
Write-Host "     cd C:\MyProjects\MyPos_SDK54"
Write-Host "     git pull origin main"
Write-Host "     npm install"
Write-Host ""
Write-Host "  3. Build Ts_MyTool:"
Write-Host "     cd C:\MyProjects\Ts_MyTool"
Write-Host "     dotnet restore"
Write-Host "     dotnet build -c Release"
Write-Host ""
Write-Host "  4. Full guide (Korean):"
Write-Host "     C:\MyProjects\MyPos_SDK54\docs\learning\2026-05-18-laptop-setup.md"
Write-Host ""
