; NSIS 사전 hook — 1.0.11 부터 추가 (1.0.12 에서 $_ 변수 충돌 fix).
;
; 배경:
;   1.0.9 / 1.0.10 자동 업데이트 시 NSIS uninstall 단계에서 매번 "Failed to uninstall
;   old application files. Please try running the installer again.: 2" 에러 반복.
;   원인: 이전 MyPos.exe / MyPos-Setup-X.X.X-x64.exe 좀비 프로세스가 설치 폴더의 일부
;   파일에 락을 들고 있어서 NSIS 가 uninstall 실패.
;
; fix:
;   인스톨러 Init 단계 시작 직전 PowerShell 의 Get-Process -Name 으로 mypos 관련
;   모든 프로세스 강제 종료. PowerShell 의 자동 변수 $_ 는 NSIS 의 $변수 prefix 와
;   충돌하므로 사용 X (1.0.11 의 빌드 실패 원인). -Name 옵션 + 와일드카드로 회피.

!macro customInit
  ; PowerShell -Name 와일드카드: MyPos*.exe / mypos*.exe 모두 매칭.
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-Process -Name MyPos*,mypos* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"'
  ; 락 해제 대기 (2초). 프로세스 종료 직후 파일 핸들 풀리는 데 시간 걸림.
  Sleep 2000
!macroend

!macro customInstall
  ; install 단계 직전 한 번 더. customInit 이 어떤 이유로 누락돼도 안전망.
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-Process -Name MyPos*,mypos* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Sleep 1000
!macroend
