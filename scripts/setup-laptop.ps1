# =====================================================================
# 노트북 외부 작업 셋업 — 한 번 실행으로 완료
#
# 사용법:
#   1. 노트북에서 GitHub 로그인 (https://github.com/login, 계정 overson76)
#   2. https://github.com/overson76/MyPos_SDK54 → scripts/setup-laptop.ps1
#   3. "Raw" 우클릭 → "다른 이름으로 저장" → 바탕화면 등에
#   4. PowerShell (관리자 권장) 에서:
#        cd ~/Desktop          # 또는 다운로드 위치
#        powershell -ExecutionPolicy Bypass -File .\setup-laptop.ps1
#
# 자동 처리:
#   - Git / GitHub CLI / .NET SDK / Node.js 자동 설치 (winget)
#   - GitHub 인증 (브라우저 열림, 한 번만)
#   - C:\MyProjects 폴더 생성
#   - MyPos_SDK54 / Ts_MyTool 두 프로젝트 자동 clone
#
# 추가 수동 단계 (스크립트 끝나면 안내):
#   - .env 파일 (Firebase / Kakao 등 키) — 메인컴에서 보안 메신저로 복사
# =====================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  MyPos / Ts_MyTool 노트북 외부 작업 셋업 시작" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# ----- 1. winget 도구 설치 ---------------------------------
Write-Host "[1/4] 필수 도구 설치 중 (winget)..." -ForegroundColor Yellow
Write-Host "  Git, GitHub CLI, .NET SDK 8, Node.js LTS"
Write-Host ""

$pkgs = @(
    "Git.Git",
    "GitHub.cli",
    "Microsoft.DotNet.SDK.8",
    "OpenJS.NodeJS.LTS"
)
foreach ($pkg in $pkgs) {
    Write-Host "  설치: $pkg" -ForegroundColor DarkGray
    winget install --id $pkg --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null
}
Write-Host "  완료 ✓" -ForegroundColor Green
Write-Host ""

# ----- 2. PATH 새로고침 -------------------------------------
Write-Host "[2/4] PATH 새로고침..." -ForegroundColor Yellow
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Write-Host "  완료 ✓" -ForegroundColor Green
Write-Host ""

# ----- 3. GitHub 인증 ---------------------------------------
Write-Host "[3/4] GitHub 인증 (브라우저 열림)..." -ForegroundColor Yellow
Write-Host "  계정: overson76 으로 로그인"
Write-Host ""
$ghStatus = gh auth status 2>&1
if ($ghStatus -match "Logged in") {
    Write-Host "  이미 인증됨 ✓" -ForegroundColor Green
} else {
    gh auth login
}
Write-Host ""

# ----- 4. 프로젝트 clone ------------------------------------
Write-Host "[4/4] 프로젝트 clone..." -ForegroundColor Yellow

$projectsDir = "C:\MyProjects"
if (-not (Test-Path $projectsDir)) {
    New-Item -ItemType Directory -Path $projectsDir | Out-Null
    Write-Host "  $projectsDir 폴더 생성" -ForegroundColor DarkGray
}
Set-Location $projectsDir

foreach ($repo in @("MyPos_SDK54", "Ts_MyTool")) {
    $target = Join-Path $projectsDir $repo
    if (Test-Path $target) {
        Write-Host "  이미 존재: $repo (skip)" -ForegroundColor DarkGray
    } else {
        Write-Host "  clone: overson76/$repo" -ForegroundColor DarkGray
        gh repo clone "overson76/$repo" $target
    }
}
Write-Host "  완료 ✓" -ForegroundColor Green
Write-Host ""

# ----- 마무리 안내 -----------------------------------------
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  ✅ 자동 셋업 완료" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "다음 수동 단계:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. MyPos .env 복사 (Firebase / Kakao / Sentry 키)"
Write-Host "     메인컴 C:\MyProjects\MyPos_SDK54\.env  →  보안 메신저 / USB"
Write-Host "     노트북 동일 위치에 붙여넣기"
Write-Host ""
Write-Host "  2. 작업 시작:" -ForegroundColor Yellow
Write-Host "     cd C:\MyProjects\MyPos_SDK54"
Write-Host "     git pull origin main"
Write-Host "     npm install                    # MyPos 의존성"
Write-Host ""
Write-Host "  3. Ts_MyTool 빌드:" -ForegroundColor Yellow
Write-Host "     cd C:\MyProjects\Ts_MyTool"
Write-Host "     dotnet restore"
Write-Host "     dotnet build -c Release"
Write-Host ""
Write-Host "  4. 자세한 가이드:" -ForegroundColor Yellow
Write-Host "     C:\MyProjects\MyPos_SDK54\docs\learning\2026-05-18-노트북-외부작업-셋업-가이드.md"
Write-Host ""
