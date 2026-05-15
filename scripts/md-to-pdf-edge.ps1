# 마크다운 → HTML → PDF (Edge headless)

param(
  [Parameter(Mandatory=$true)][string]$MdFile,
  [Parameter(Mandatory=$true)][string]$PdfFile
)

$mdPath = (Resolve-Path $MdFile).Path
$htmlPath = [System.IO.Path]::ChangeExtension($mdPath, ".html")
$pdfPath = [System.IO.Path]::GetFullPath($PdfFile)

# 1) node 스크립트 — single-quoted here-string 으로 PowerShell 변수 보간 회피
$nodeScript = @'
const fs = require('fs');
const marked = require('marked');
const md = fs.readFileSync(process.argv[2], 'utf-8');
const body = marked.parse(md);
const html = '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8">' +
  '<title>MyPos 가치 평가서</title>' +
  '<style>' +
  '@page { size: A4; margin: 18mm 15mm; }' +
  'body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; line-height: 1.6; color: #111827; max-width: 760px; margin: 0 auto; padding: 20px; font-size: 11pt; }' +
  'h1 { color: #1f2937; border-bottom: 3px solid #ef4444; padding-bottom: 8px; font-size: 22pt; }' +
  'h2 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; margin-top: 28px; font-size: 16pt; }' +
  'h3 { color: #374151; margin-top: 20px; font-size: 13pt; }' +
  'table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }' +
  'th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }' +
  'th { background: #f3f4f6; font-weight: 700; }' +
  'code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: Consolas, monospace; font-size: 9pt; }' +
  'pre { background: #1f2937; color: #f9fafb; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 9pt; line-height: 1.4; }' +
  'pre code { background: transparent; color: inherit; padding: 0; }' +
  'blockquote { border-left: 4px solid #ef4444; padding: 8px 16px; background: #fef2f2; margin: 12px 0; color: #374151; }' +
  'hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }' +
  'ul, ol { padding-left: 24px; }' +
  'li { margin: 4px 0; }' +
  'a { color: #2563eb; text-decoration: none; }' +
  'strong { color: #111827; }' +
  '</style></head><body>' + body + '</body></html>';
fs.writeFileSync(process.argv[3], html, 'utf-8');
console.log('HTML OK');
'@

Write-Host "[1/3] marked 설치 확인..."
$depsDir = Join-Path $env:TEMP "mypos-md-deps"
if (-not (Test-Path "$depsDir\node_modules\marked")) {
  New-Item -ItemType Directory -Force -Path $depsDir | Out-Null
  Push-Location $depsDir
  npm init -y | Out-Null
  npm install marked --silent 2>&1 | Out-Null
  Pop-Location
}

# node 스크립트를 depsDir 안에 두어 marked 모듈 인식
$nodeScriptPath = Join-Path $depsDir "md-to-html.js"
Set-Content -Path $nodeScriptPath -Value $nodeScript -Encoding utf8

Write-Host "[2/3] 마크다운 -> HTML..."
node $nodeScriptPath $mdPath $htmlPath

Write-Host "[3/3] HTML -> PDF (Edge headless)..."
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
  $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
}

# 한글 경로 회피 — 영문 임시 경로로 복사 후 변환, 끝나면 최종 위치로 이동
$tmpHtml = Join-Path $env:TEMP "mypos-report.html"
$tmpPdf = Join-Path $env:TEMP "mypos-report.pdf"
Copy-Item -Path $htmlPath -Destination $tmpHtml -Force

if (Test-Path $tmpPdf) { Remove-Item $tmpPdf -Force }

$tmpHtmlUrl = "file:///" + ($tmpHtml -replace '\\', '/')
& $edge --headless --disable-gpu --no-pdf-header-footer "--print-to-pdf=$tmpPdf" $tmpHtmlUrl 2>&1 | Out-Null

# Edge 가 비동기로 PDF 쓰는 경우 대비 잠깐 대기
$maxWait = 30
$waited = 0
while (-not (Test-Path $tmpPdf) -and $waited -lt $maxWait) {
  Start-Sleep -Seconds 1
  $waited++
}

if (Test-Path $tmpPdf) {
  # 최종 위치로 이동
  $pdfDir = Split-Path -Parent $pdfPath
  if (-not (Test-Path $pdfDir)) { New-Item -ItemType Directory -Path $pdfDir -Force | Out-Null }
  Move-Item -Path $tmpPdf -Destination $pdfPath -Force
  $size = [math]::Round((Get-Item $pdfPath).Length / 1KB, 1)
  Write-Host "[OK] PDF: $pdfPath ($size KB)"
} else {
  Write-Host "[FAIL] PDF 생성 실패 (Edge headless 응답 없음)"
  Write-Host "임시 HTML: $tmpHtml"
  exit 1
}
