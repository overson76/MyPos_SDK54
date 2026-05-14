# 2026-05-14 — LG U+ Centrex Webhook 통합 (1.0.44 → 1.0.45)

## 한 줄 요약

5월 9일 시점의 SIP 등록 정책 우회 계획을 **LG U+ Centrex Rest API 의 전화 수신시 URL알림(setringcallback)** 으로 완성. 매장 광 공유기 NAT 포트포워딩(외부 8080 → 매장 PC 8090) + 매장 PC 의 node:http 서버 + 자동 IP 워치독. **callback 등록 ✅**. 실제 전화 한 통 검증은 다음 세션.

## 5월 9일 → 5월 13일 흐름 단절 회복

5월 9일 세션 마무리 후 우리 작업 (utils/lguApi.js / electron/cidServer.js / utils/ipWatcher.js 초안) 이 본관에 안 들어갔고, 5월 10~13 에 사장님이 다른 흐름으로 1.0.14~1.0.43 진행 (주소록 공용 DB, 상황별 영수증, CID 자동 등록 등). 5월 14일 오늘 본관 1.0.43 위에 Webhook 흐름 통합 — 기존 `useCidHandler.web.js` 그대로 두고 cidServer 가 같은 IPC (`mypos/incoming-call`) 로 푸시.

## 무엇이 바뀌었는가 (Q&A)

| Q | A |
|---|---|
| 1.0.13 의 SIP 등록 시도가 404 → 가능한 길? | **A. LG U+ Centrex Rest API Webhook**. 매장 광 공유기 NAT + cidServer + setringcallback. SIP 직접 등록 정책(single-device only) 우회. |
| 어제 만든 USB-LAN 어댑터 + 정적 라우트 무의미해짐? | YES. SIP 흐름이 무관. 단 그대로 둬도 영향 X. |
| LG U+ API 의 id 가 070번호 (07040702874)? 또는 사용자 ID (tmpid7133)? | **070번호** (매뉴얼 13.3 + 13.4 샘플). 사용자 ID 가 아님. |
| 비번은 centrex.uplus.co.kr 로그인 비번? | YES. 평문 setx 박고 코드(`utils/lguApi.js`)가 SHA-512 hex 로 자동 변환. |
| callbackurl 에 확장자 필요? | YES. 매뉴얼 13.3(3): "URL의 page 는 확장자를 포함해야 함". `/cid/ring` → `/cid/ring.html`. |
| URLSearchParams 가 `/` 를 `%2F` 로 인코딩 → PARAM_ERR? | 검증: PowerShell raw `/` 호출 → SVC_RT=0000 성공. 그러나 1.0.45 ipWatcher (URLSearchParams 사용) 도 자동 setringcallback → 성공 (✅). 즉 URLSearchParams 가 실제로 `/` 인코딩 안 하거나 LG U+ 가 둘 다 받음. 1.0.46 에서 raw 조립으로 명시화 가치. |
| 진단 카드 "🔍 진단" 무한 hang 원인? | main.js 의 cid-status 핸들러가 `sip: (function() { return getCidDiagnosis(); })()` 에서 async 함수의 Promise 반환 → IPC structured clone 이 Promise 처리 불가 → reject "An object could not be cloned" → 렌더러 영원히 await. **1.0.45 에서 sip 필드 제거로 fix**. |

## 흐름 다이어그램

```
[전화 수신]
  ↓
[LG U+ Centrex SIP 서버]
  ↓ HTTP GET (callbackhost=119.71.90.184, port=8080, url=/cid/ring.html)
[매장 광 공유기 LGU_2C60 (192.168.219.1)]
  ↓ NAT: 외부 TCP 8080 → 내부 192.168.219.125:8090
[매장 카운터 PC 의 cidServer (electron/cidServer.js)]
  ↓ ?sender=01012345678&receiver=07040702874&kind=1&inner_num=7133
  ↓ → IPC 'mypos/incoming-call'
[useCidHandler.web.js (변경 없음)]
  ↓ → 매장 주소록 매칭 / 자동 phone-only 등록
  ↓ → Firestore: stores/<storeId>/state/incomingCall set
  ↓ → speakIncomingCid TTS
[Firestore onSnapshot]
  ↓
[매장 PC + 폰 + 탭 모두 동시 알림]
```

## 신규/변경 파일

| 종류 | 파일 | 비고 |
|---|---|---|
| 신규 | `utils/lguApi.js` | SHA-512 + setringcallback REST API + rate limit 5초 가드 |
| 신규 | `electron/cidServer.js` | node:http 기반 Webhook 수신 서버 (8090, /cid/ring.html) + 한국식 포맷 + IPC broadcast |
| 신규 | `utils/ipWatcher.js` | 1시간마다 매장 광 공유기 WAN IP 체크 + 변경 시 setringcallback 자동 재호출 |
| 수정 | `electron/main.js` | start-cid IPC 안에 cidServer + ipWatcher 시작. mypos/cid-status 통합 진단. mypos/cid-register-now 신설. SIP 본체(getCidDiagnosis) sip 필드는 1.0.45 에서 제거 (Promise clone 버그). |
| 수정 | `electron/cid.js` | SIP 시작 비활성화. MYPOS_CID_MODE=sip 일 때만 fallback. 함수 시그니처 보존. |
| 수정 | `electron/preload.js` | cidRegisterNow() 노출. |
| 수정 | `electron/builder.config.js` | files 에 utils/lguApi.js + utils/ipWatcher.js 명시. |
| 수정 | `screens/AdminScreen.js` | CID 진단 카드 Webhook 모드 개편 + 🔄 지금 등록 버튼. |
| 수정 | `package.json` | 1.0.43 → 1.0.44 → 1.0.45 |

## 매장 PC 환경변수 (setx)

```
MYPOS_LGU_API_ID        07040702874         (070번호)
MYPOS_LGU_API_PASS      dmscks501*          (centrex.uplus.co.kr 로그인 비번, 평문)
MYPOS_LGU_CALLBACK_URL  /cid/ring.html      (확장자 .html 필수 — 매뉴얼 13.3(3))
MYPOS_LGU_CALLBACK_PORT 8080                (광 공유기 외부 포트)
MYPOS_CID_INTERNAL_PORT 8090                (매장 PC cidServer 내부 포트)
MYPOS_CID_MODE          webhook
```

## 매장 광 공유기 (LGU_2C60) NAT 포트 포워딩

| 항목 | 값 |
|---|---|
| 외부 포트 | TCP 8080 |
| 내부 IP | 192.168.219.125 (LAPTOP-6QSO2VUJ) |
| 내부 포트 | 8090 |
| 프로토콜 | TCP/IP |

설정 후 portchecker (yougetsignal.com): **closed** = 정상 (광 공유기 도달 + 매장 PC 8090 빈 상태 = 서버 안 떴을 때 정상 응답). cidServer 시작 후 **open** 이 정상.

## 알려진 문제 / 미해결 이슈

1. **실제 전화 한 통 검증 안 됨** — 사장님이 다음 세션에서. 진단 카드의 "마지막 수신: 없음" + "총 요청: 0회" 상태. 사장님 폰 → 매장 070(07040702874) 으로 전화 시도 → 화면 팝업 + cidServer 콘솔 로그 + 진단 카드 갱신 확인.
2. **URLSearchParams 의 `/` 인코딩 가설 vs 실제 동작** — PowerShell raw 호출은 성공, 1.0.45 ipWatcher (URLSearchParams) 도 성공. 가설 부분 틀림. 1.0.46 에서 raw query string 조립으로 명시화 권장 (LG U+ 가 매뉴얼 샘플 그대로 받는다는 보장).
3. **3개월 비번 만료** (매뉴얼 1.6) — 자동 알림 X. 사장님이 수동 관리. 향후 챕터 27 패스워드 변경 API 활용 가능.
4. **유료 부가서비스 미지원** — 녹취 다운로드 / 삭제 (챕터 23, 24) 는 별도 청약 필요. 현재 사용 X.

## 다음 세션 진입 가이드

```powershell
# 매장 PC 에 원격 접속 (또는 사장님 직접)

# 1) 현재 메인 .exe 버전 확인
(Get-Item "$env:LOCALAPPDATA\Programs\mypos_sdk54\MyPos.exe").VersionInfo.FileVersion
# 1.0.45 또는 그 이상이어야

# 2) 콘솔 띄운 채로 MyPos 직접 실행
Get-Process | Where-Object { $_.ProcessName -like "*mypos*" } | Stop-Process -Force
Start-Sleep -Seconds 3
& "$env:LOCALAPPDATA\Programs\mypos_sdk54\MyPos.exe"
# 콘솔에 [cidServer] CID Webhook 시작 — 0.0.0.0:8090/cid/ring.html 보여야

# 3) 진단 카드 → 🔍 진단 → LG U+ 등록 ✅ 확인

# 4) 사장님 폰 → 매장 070 (07040702874) 전화 한 통
#    → 매장 PC 화면 팝업 + 진단 카드 "마지막 수신" 갱신 확인
```

만약 실제 전화 검증 실패 시 — `netstat -ano | findstr 8090` 로 cidServer listen 확인. portchecker 로 외부 8080 open 확인. 광 공유기 NAT 룰 다시 확인.

## 핵심 기술 결정

- **node:http 사용** (Express X) — 외부 의존성 0, asar 빌드 크기 부담 X.
- **기존 useCidHandler.web.js 의 IPC (`mypos/incoming-call`) 재사용** — cidServer 가 같은 IPC + 같은 payload 형식. useCidHandler 코드 무변경. 매장 주소록 매칭 / 자동 phone-only 등록 / TTS 등 기존 흐름 그대로.
- **autoInstallOnAppQuit:false 유지** — 1.0.11 의 영업 안전 fix 그대로.
- **rate limit 5초 가드** — `utils/lguApi.js` 의 `_throttleAndFetch` 가 호출 간격 강제. 매뉴얼 1.6 의 "동시 호출 / 짧은 시간 연달아 호출 시 차단" 회피.
- **IPv4 callback host** — 매뉴얼 13.3(4): IPv4 만. ipWatcher 가 ipinfo.io 로 외부 IP 자동 조회 + 변경 시 자동 재등록.
- **MYPOS_CID_MODE=sip fallback** — 1.0.45 의 electron/cid.js 가 `MYPOS_CID_MODE=sip` 일 때만 옛 SIP 흐름. 기본은 Webhook 모드. 코드 보존 — 향후 다른 통신사 / SIP 전용 환경 대응.

## 빌드/실행 명령 (운영 배포)

```powershell
# 폰 OTA (Webhook 흐름은 폰 영향 X — useCidHandler 가 isElectron 가드)
# 폰 빌드는 생략 가능

# PC 라이브 URL — Cloudflare (UI 변경 시만)
npm run deploy:web

# PC .exe — GitHub Releases (자동 업데이트)
$env:GH_TOKEN = "ghp_..."
npx electron-builder --config electron/builder.config.js --publish always
```

## 커밋

| 커밋 | 내용 |
|---|---|
| `b82429d` | feat(cid): 1.0.44 — LG U+ Centrex Rest API Webhook 으로 SIP 우회 |
| `9cffe36` | fix(cid): 1.0.45 — mypos/cid-status IPC clone 실패 fix (sip 필드 제거) |

## 다음 체크리스트

- [ ] 사장님 폰 → 매장 070 (07040702874) 전화 한 통 → 매장 PC 화면 팝업 검증
- [ ] 검증 OK 시: 1.0.46 빌드 — utils/lguApi.js 의 URLSearchParams 제거 + raw query string 조립 (매뉴얼 샘플 호환 명시)
- [ ] 검증 실패 시: cidServer 콘솔 로그 + 진단 카드 "총 요청 1+" 확인 → 광 공유기 NAT 또는 useCidHandler 매칭 진단
- [ ] 매장 PC 의 USB-LAN 어댑터 / 정적 라우트 (211.36.152.230) 정리 (Webhook 흐름에서 무관, 영향 X 이지만 깔끔히)
- [ ] 향후: 자동 비번 변경 (챕터 27, 3개월 만료 대응)
- [ ] 향후: 외부인입번호별 통화이력 조회 (챕터 22) — Webhook 누락 시 폴링 백업
