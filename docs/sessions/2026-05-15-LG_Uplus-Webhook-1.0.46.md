# 2026-05-15 — LG U+ Centrex Webhook 매장 PC 도달 완성 (1.0.46)

## 한 줄 요약

어제 (5월 14일) 1.0.45 까지 setringcallback 등록 ✅. 오늘 실제 전화 검증에서 **6시간** 다중 함정 풀고 마침내 매장 PC 화면 팝업 + 모든 기기 동기화 성공. 핵심 함정 4개: 매장 PC IP 동적 변경 (.125→.107→.103), `.107` 은 ESP32 IoT 디바이스 (NAT 룰 잘못된 IP), Windows Defender 8090 inbound 차단, **LG U+ 가 webhook 호출 시 receiver=영업 번호(0512047133) 보냄** ← 단말 등록 ID(07040702874) 와 다름.

## 무엇이 바뀌었는가 (Q&A)

| Q | A |
|---|---|
| portchecker 8080 closed 이유? | 매장 PC IP 가 매번 다른 임대 (.125→.107→.103). NAT 룰의 .125 가 안 맞음. |
| .107 은 누구? | 매장의 ESP32 IoT 디바이스 (espressif, MAC 90:38:0C:C8:9E:2C). NAT 룰 .107 = 잘못된 호스트. |
| 매장 PC IP 영구 고정 방법? | 광 공유기 (LGU_2C60 / GAPD-7500) → 고급 설정 → DHCP 할당정보 → 고정 할당. MAC 50:5B:C2:D8:FB:87 = 192.168.219.103. |
| 방화벽 룰 누락? | TCP 8090 Inbound — 관리자 PowerShell 로 `New-NetFirewallRule` 추가. |
| LG U+ 가 보내는 receiver 가 070 단말 ID 와 왜 다름? | 매장 영업 번호가 0512047133 (051 부산 지역번호) 로 전환됨. LG U+ 가 webhook 호출 시 receiver 파라미터에 실제 받은 번호 (영업 번호) 보냄. 단말 ID (07040702874) 와 일치 검증하면 차단됨. |
| 단일 receiver 검증 → 다중 어떻게? | cidServer.js 의 `_allowedReceivers()` 가 `MYPOS_LGU_API_ID` + `MYPOS_LGU_RECEIVERS` (콤마 분리) 합집합 Set 반환. |
| setx 박은 환경변수가 새 MyPos 에 안 보임? | `setx` 는 시스템 레지스트리만 업데이트. 이미 떠 있는 explorer.exe 의 캐시된 환경변수는 다음 로그인까지 갱신 X. PowerShell 에서 `$env:` 명시 set 후 그 셸에서 MyPos 실행 = 자식 프로세스로 상속. |
| NSIS 덮어쓰기 안 되는 이유? | `oneClick: true` silent install + 1.0.45 가 락 들고 있음 → customInit 의 2초 Stop-Process 가 Service Worker 정리 시간 부족 → 인스톨러 silent fail. 1.0.47 부터 `oneClick: false` + Sleep 5000 + 진단 카드 "지금 업데이트" 버튼 추가 예정. |
| 모든 기기에 발신자 표시? | YES. 매장 PC 의 cidServer 가 받은 정보를 Firestore `stores/<storeId>/state/incomingCall` 에 write → 매장 가입된 모든 기기가 onSnapshot 으로 받음. 매장 PC = 게이트웨이. |

## 흐름 다이어그램

```
[전화 0512047133 으로 발신]
   ↓
[LG U+ Centrex SIP 서버]
   ↓ HTTP GET (callbackhost=119.71.90.184:8080/cid/ring.html, sender, receiver=0512047133, kind=1)
[매장 광 공유기 GAPD-7500 (192.168.219.1)]
   ↓ NAT: 외부 TCP 8080 → 내부 192.168.219.103:8090
[매장 카운터 PC LAPTOP-6QSO2VUJ (192.168.219.103) 의 cidServer]
   ↓ receiver ∈ {07040702874, 0512047133} ✅ (1.0.46 의 Set 검증)
   ↓ IPC 'mypos/incoming-call'
[useCidHandler.web.js (변경 없음)]
   ↓ Firestore: stores/<storeId>/state/incomingCall set
   ↓
[Firestore onSnapshot]
   ↓
[매장 PC 화면 + 사장님 폰 + 직원 폰 + 다른 탭 모두 동시 알림]
```

## 신규/변경 파일

| 종류 | 파일 | 비고 |
|---|---|---|
| 수정 | `electron/cidServer.js` | `_allowedReceivers()` 신설 — MYPOS_LGU_API_ID + MYPOS_LGU_RECEIVERS Set 기반 검증. 에러 메시지 형식 `∉ {...}` |
| 수정 | `package.json` | 1.0.45 → 1.0.46 |
| 신규 | `docs/sessions/2026-05-15-LG_Uplus-Webhook-1.0.46.md` | 본 세션 노트 |

## 매장 PC 환경변수 (setx 시스템 영구 + 즉시 적용)

```powershell
# 영구 (다음 로그인부터)
[Environment]::SetEnvironmentVariable("MYPOS_LGU_RECEIVERS", "0512047133", "User")

# 즉시 적용 (현재 셸 → MyPos 자식 프로세스 상속)
Get-Process -Name MyPos*,mypos* -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
$env:MYPOS_LGU_RECEIVERS = "0512047133"
& "$env:LOCALAPPDATA\Programs\mypos_sdk54\MyPos.exe"
```

**중요 — setx 의 함정:** `setx` 는 시스템 레지스트리에 박지만, 이미 떠 있는 explorer.exe 는 부팅 시 캐시한 옛 환경변수 들고 있음. 더블클릭으로 실행하는 MyPos 는 explorer.exe 의 환경변수 상속 → 새 변수 못 받음. **PowerShell 에서 `$env:` 명시 set 후 그 셸에서 직접 실행** 하면 즉시 적용.

## 매장 광 공유기 (LGU_2C60 / GAPD-7500) 최종 설정

### NAT 포트포워딩

| 외부 포트 | 내부 IP | 내부 포트 | 프로토콜 |
|---|---|---|---|
| TCP 8080 | **192.168.219.103** | 8090 | TCP/IP |

### DHCP 고정 할당

| MAC 주소 | 호스트 | IP 영구 |
|---|---|---|
| 50:5B:C2:D8:FB:87 | LAPTOP-6QSO2VUJ | **192.168.219.103** |

## 알려진 문제 / 미해결 이슈

1. **NSIS 덮어쓰기 안 됨** — `oneClick: true` silent fail. 1.0.47 부터 `oneClick: false` + `runAfterFinish: true` + `Sleep 5000` + 진단 카드 "🔄 지금 업데이트" 버튼.
2. **매장 PC IP 변경 시 NAT 룰 깨짐** — DHCP 고정 할당으로 .103 영구 박음. 단 매장 PC MAC 바뀌면 (LAN 어댑터 교체 등) 재설정 필요.
3. **외부 IP 변경 시 setringcallback 재등록** — ipWatcher 가 1시간마다 자동 호출. 단 매장 외부 IP (119.71.90.184) 가 1시간 안에 변경되고 그 사이 전화 오면 콜백 미수신 가능 (LG POWERCOMM 의 DHCP 임대 정책에 따라 다름).
4. **MYPOS_LGU_RECEIVERS 가 매장마다 다름** — 매장 영업 번호가 070 이 아닌 경우만 필요. 1.0.47 부터 진단 카드에 환경변수 표시 + 설정 UI 고려.

## 다음 세션 진입 가이드

```powershell
# 매장 PC

# 1) 버전 확인
(Get-Item "$env:LOCALAPPDATA\Programs\mypos_sdk54\MyPos.exe").VersionInfo.FileVersion
# 1.0.46 또는 그 이상

# 2) cidServer 8090 listen 확인
netstat -ano | findstr 8090

# 3) 환경변수 확인
[Environment]::GetEnvironmentVariable("MYPOS_LGU_API_ID", "User")
[Environment]::GetEnvironmentVariable("MYPOS_LGU_RECEIVERS", "User")
[Environment]::GetEnvironmentVariable("MYPOS_LGU_API_PASS", "User")

# 4) 진단 카드 → 🔍 진단 → 모든 줄 ✅ 확인

# 5) 전화 한 통 검증
```

문제 발생 시 — 진단 카드의 "Webhook 에러" 라인이 가장 빠른 단서.

## 핵심 기술 결정

- **receiver 다중 허용 (Set 기반)** — 매장마다 다양한 번호 패턴 (070 + 051 등) 지원. 환경변수 분리로 코드 변경 없이 매장별 설정.
- **DHCP 고정 할당** — NAT 룰 IP 가 매번 깨지는 근본 원인 해결. 광 공유기에서 한 번만 박으면 영구.
- **PowerShell `$env:` 명시 set + 직접 실행 패턴** — setx 즉시 적용 우회. 영구 setx + 즉시 자식 프로세스 적용 동시 가능.
- **autoInstallOnAppQuit:false 유지** — 1.0.11 영업 안전 fix. NSIS 덮어쓰기는 1.0.47 의 `oneClick: false` 로 해결 예정.

## 빌드/실행 명령

```powershell
# 개발 PC (집)
Set-Location C:\MyProjects\MyPos_SDK54
npx electron-builder --config electron/builder.config.js --publish always

# 매장 PC (배포 후 적용)
# 자동: 다음 MyPos 실행 시 백그라운드 다운로드 (단 NSIS 덮어쓰기 미해결 — 1.0.47 까지는 수동 삭제+재설치)
# 수동: GitHub Releases v1.0.46 에서 MyPos-Setup-1.0.46-x64.exe 다운로드 + 더블클릭
```

## 커밋

| 커밋 | 내용 |
|---|---|
| `6555895` | feat(cid): 1.0.46 — receiver 다중 번호 허용 (MYPOS_LGU_RECEIVERS) |

## 다음 체크리스트

- [x] 광 공유기 NAT 룰 IP = .103 + DHCP 고정 할당
- [x] portchecker 8080 open
- [x] 1.0.46 빌드 + GitHub Releases publish
- [x] 매장 PC 환경변수 MYPOS_LGU_RECEIVERS=0512047133
- [x] 실제 전화 검증 — 매장 PC 화면 + 모든 기기 알림
- [ ] **1.0.47**: NSIS 덮어쓰기 fix — `oneClick: false` + `runAfterFinish: true` + `Sleep 5000`
- [ ] **1.0.47**: 진단 카드에 환경변수 (API_ID / RECEIVERS) 표시 + "🔄 지금 업데이트" 버튼
- [ ] 향후: 외부인입번호별 통화이력 조회 (챕터 22) — Webhook 누락 시 폴링 백업
- [ ] 향후: 자동 비번 변경 (챕터 27) — 3개월 만료 대응
