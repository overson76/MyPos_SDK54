; NSIS 사전 hook — 1.0.11 부터 추가.
;
; 배경:
;   1.0.9 / 1.0.10 자동 업데이트 시 NSIS uninstall 단계에서 매번 "Failed to uninstall
;   old application files. Please try running the installer again.: 2" 에러 반복.
;   원인: 이전 MyPos.exe / MyPos-Setup-X.X.X-x64.exe 좀비 프로세스가 설치 폴더의 일부
;   파일에 락을 들고 있어서 NSIS 가 uninstall 실패.
;
; fix:
;   인스톨러 Init 단계 시작 직전 PowerShell 로 mypos*.exe 모두 강제 종료.
;   electron-builder 의 default NSIS 도 자체적으로 프로세스 종료 시도하지만 일부 환경에서
;   부족함. 이 hook 으로 이중 안전.

!macro customInit
  ; PowerShell 한 줄로 mypos 관련 모든 프로세스 강제 종료 (소문자/대문자 무관 매칭).
  ; -ErrorAction SilentlyContinue : 프로세스 없어도 에러 없이 진행.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.ProcessName -match \"mypos\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  ; 락 해제 대기 (2초). 프로세스 종료 직후 파일 핸들 풀리는 데 시간 걸림.
  Sleep 2000
!macroend

!macro customInstall
  ; install 단계 직전 한 번 더. customInit 이 어떤 이유로 누락돼도 안전망.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.ProcessName -match \"mypos\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Sleep 1000
!macroend
