; NSIS 사전 hook — 1.0.11 부터 추가, 1.0.13 에서 자살 패턴 fix.
;
; 배경:
;   1.0.9 / 1.0.10 자동 업데이트 시 NSIS uninstall 단계에서 매번 "Failed to uninstall
;   old application files" 에러. 좀비 MyPos.exe / MyPos-Setup-X-x64.exe 가 락 들고 있음.
;
;   1.0.12 의 첫 시도: Get-Process -Name MyPos*,mypos* 로 모두 종료. 하지만 와일드카드가
;   인스톨러 자신(MyPos-Setup-1.0.12-x64) 도 매칭해서 customInit 시점에 자살 → 더블클릭해도
;   "아무 일도 안 일어남" 증상 (1.0.12 의 핵심 버그).
;
; 1.0.13 fix:
;   Where-Object ProcessName -notlike *Setup* 로 인스톨러 자신 제외.
;   PowerShell 단축구문(Where-Object property -operator value) 사용 — $_ 자동변수 안 씀
;   → NSIS 의 $ 변수 prefix 충돌도 회피.

!macro customInit
  ; mypos 관련 프로세스 모두 종료. 단 Setup 인스톨러 자신은 제외 (자살 방지).
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-Process -Name MyPos*,mypos* -ErrorAction SilentlyContinue | Where-Object ProcessName -notlike *Setup* | Stop-Process -Force -ErrorAction SilentlyContinue"'
  ; 락 해제 대기 (2초). 프로세스 종료 직후 파일 핸들 풀리는 데 시간 걸림.
  Sleep 2000
!macroend

!macro customInstall
  ; install 단계 직전 한 번 더. customInit 이 어떤 이유로 누락돼도 안전망.
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-Process -Name MyPos*,mypos* -ErrorAction SilentlyContinue | Where-Object ProcessName -notlike *Setup* | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Sleep 1000
!macroend
