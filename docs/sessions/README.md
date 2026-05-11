# 세션 Q&A 인덱스

각 세션에서 다룬 핵심 질문/결정/체크리스트 정리본.  
Claude Code 에서 "날짜 세션 보여줘" 또는 "주제명 관련 정리 있어?" 라고 물으면 바로 꺼내줌.

---

## 세션 목록

| 날짜 | 파일 | 핵심 주제 | 커밋 |
|---|---|---|---|
| 2026-05-03 | [2026-05-03-q-and-a.md](2026-05-03-q-and-a.md) | 익명 UID 손실 자가복구 + 폰 지도 + 대표 가입 + CID 준비 | c523683, 37cb00d |
| 2026-05-04 | [2026-05-04-firebase-pc-recovery-cid-map.md](2026-05-04-firebase-pc-recovery-cid-map.md) | Firebase v12 PC연동복구 + Cloudflare차단 + CID준비 + 배달지도경로 | 33f8606, d279775 |
| 2026-05-06 | [2026-05-06-KIS카드결제-자동업데이트개선-CID진단.md](2026-05-06-KIS카드결제-자동업데이트개선-CID진단.md) | KIS 카드결제 Phase5 + 자동업데이트 개선(1.0.3→1.0.8) + CID 진단 + UI 개선 | 08794ef, 16c6838, eefc4f6 |
| 2026-05-06 | [2026-05-06-글씨개선-메뉴이동-충돌원인.md](2026-05-06-글씨개선-메뉴이동-충돌원인.md) | 글씨 OTA 재배포 + 폰 메뉴 이동 시도(2회 롤백) + Firestore 중첩배열 크래시 원인 파악 | 62648d6 |
| 2026-05-06 | [2026-05-06-CID센트릭스-도메인발견-SIP진단필요.md](2026-05-06-CID센트릭스-도메인발견-SIP진단필요.md) | CID 사진 분석 + 매장 네트워크 구조 + 센트릭스 도메인 발견 + 비번 변경 → 1.0.9 진단 빌드 필요 | 63ffecd |
| 2026-05-06 | [2026-05-06-CID-망분리확정-1.0.9to13.md](2026-05-06-CID-망분리확정-1.0.9to13.md) | CID 진단 빌드 1.0.9~1.0.13 + NSIS 자동업데이트 사이클 영구 fix + 광↔LTE 망분리로 인터넷 SIP 등록 불가능 확정 (응답 404) → USB-LAN 망 합류 결정 | e903a49, c06279e, ed0de8f, fc746ad, 61ee625 |
| 2026-05-07 | [2026-05-07-결제완료-조리완료-되돌리기.md](2026-05-07-결제완료-조리완료-되돌리기.md) | 결제완료 / 조리완료 되돌리기 안전망 — history append-only + reverted 플래그 + 부활 시 occupied 가드 + KitchenScreen 최근 조리완료 섹션 + 단위 테스트 18 | 94430cd |
| 2026-05-07 | [2026-05-07-되돌리기-탭분리.md](2026-05-07-되돌리기-탭분리.md) | 되돌리기 운영 도구 — 상부 탭 메뉴에 별도 "되돌리기" 탭 추가 (주문현황 ↔ 관리자 사이). 결제완료/조리완료 두 모드 토글 + 최신순 정렬. 도메인 로직 변경 없음 | (1.0.15) |
| 2026-05-08 | [2026-05-08-되돌리기-UI-제거-isweb-디버깅.md](2026-05-08-되돌리기-UI-제거-isweb-디버깅.md) | 주문현황·관리자 수익현황의 되돌리기 UI 제거 (UndoScreen 단일화). 진행 중 폰 fallback 두 차례 사고 → 진단 도구(CrashFallback production 표시) 추가 → 진짜 원인 = OrderScreen 의 isWeb ReferenceError (이틀 잠복) | 09c6d61, ec27b99, 0605740 |
| 2026-05-08 | [2026-05-08-영수증프린터-USB-매장맥북빌드.md](2026-05-08-영수증프린터-USB-매장맥북빌드.md) | SEWOO SLK-TS400 USB 통합 — 드라이버 4.70(180dpi) 설치 + 환경변수 setx + node-thermal-printer 의존성 등록 + 매장 맥북 macOS→Windows 크로스빌드(wine 자동) + GitHub Releases v1.0.16 publish. 카운터 PC 의 1.0.16 적용은 install-on-quit 미트리거 + NSIS "cannot be closed" 반복 → 다음 세션(집 윈도우 PC) 이어감 | ff60843, 41d4f3e |
| 2026-05-09 | [2026-05-09-프린터-driver-fix-electron-printer호환X-winspool우회.md](2026-05-09-프린터-driver-fix-electron-printer호환X-winspool우회.md) | "No driver set!" 진단 → 1.0.17 fix(electron-printer 추가) → 매장 PC 검증 시 호환 X (electron-v0.36 prebuild 만 포함) → 다른 fork 모두 native compile 막힘(VS Build Tools 부재) → **1.0.18: PowerShell + Add-Type 인라인 winspool API 우회**로 native 모듈 의존성 통째 제거. 매장 PC SEWOO USB 출력 정상 ✅ | fd842df, f6c89b1 |
| 2026-05-09 | [2026-05-09-올레의-대항해-1.0.20-to-1.0.28.md](2026-05-09-올레의-대항해-1.0.20-to-1.0.28.md) | 1.0.20→1.0.28 9단계 점프. "🚀 지금 적용" / 배달 자동 출력 / 알림 spam fix / 단체 dissolve / 설정 탭 / PIN 박스 / 5탭 컬러 / 분홍 반짝이 / 포장 픽업완료 / 폰 PanResponder / EUC-KR / quitAndInstall 8초 timeout / 메뉴 인라인 편집 (Phase A~D) → 1.0.26 빈 화면 사고 후 1.0.27 보수적 재작성 → 결국 자동업데이트 메커니즘 단순화 (1.0.28: 분홍 배너 제거, GitHub 직접 다운로드만). wrangler deploy 누락이 모든 fix 가 매장 PC 에 안 닿게 한 결정타 진단. | 3850368, ddb450e, 4e1e498, 202ee94, 17cc39e, bcd9542, 8c66430, 5326208, a7fa350 |
| 2026-05-09 | [2026-05-09-2부-1.0.29-to-1.0.32-폰OTA-영수증통일.md](2026-05-09-2부-1.0.29-to-1.0.32-폰OTA-영수증통일.md) | 폰 OTA runtimeVersion 호환 fix (1부에서 sync 한 app.json 1.0.28 → 1.0.2 복구). 폰 PIN 박스 반응형 + 메뉴 드래그 crash 차단 (useRef + try/catch + Sentry). 자동 출력 신규 주문 메뉴 빠짐 fix (resolvePrintKinds isFresh 자동 added). 영수증 A형 디자인 (메모/옵션/가격/테이블명/총가격/배달지/매장정보). 모든 출력 영수증 빌더 통일 (정책 분리 X) — 4가지 시점(주문 확정 자동 / 주방 🖨️ / 결제 자동 / 재출력) 모두 같은 A형. **1.0.33 후속**: 사장님 요청으로 영수증 더 간결화 — 매장 정보 / 부가세 분리 / 결제수단 / 푸터 모두 제거. "주문지 / 테이블명 / 배달지 / 메뉴+수량+가격 / 합계" 만 남김. | a2ee6b1, 93c41eb, 96eae3d, 5c6a24a, 5f4c39b, (1.0.33) |
| 2026-05-11 | [2026-05-11-단체결제분리-1.0.35-to-1.0.38.md](2026-05-11-단체결제분리-1.0.35-to-1.0.38.md) | 단체 묶기 + 1인/테이블별 결제 분리 전 흐름 — 4 단계. **1.0.35** item.sourceTableId 토대 (addItem 자동 박기 + normalizeSlots 매칭 + useGroups stamp + migratePendingCart 치환). **1.0.36** TableSourcePicker (단체 묶기 후 메뉴 추가 시 손님 선택 모달 + 마지막 선택 ★). **1.0.37** GroupPaymentSplitPicker (합산 vs 분리) + clearTableBySource API + 분리 큐 + history 분리 기록(sourceTableId + isPartial). **1.0.38** 분리 결제 영수증에 "👤 분리 결제 손님" 줄. jest 252/252. 4 트랙 배포 (wrangler + EAS production + electron publish). | 355c6a1, 8a0a61d, a01f7ba, 7f327fd |

---

## 관련 학습 노트 (`docs/learning/`)

| 날짜 | 파일 | 주제 |
|---|---|---|
| 2026-04-28 | [cloud-setup](../learning/2026-04-28-cloud-setup.md) | 클라우드 셋업 (GitHub + Cloudflare + Firebase) |
| 2026-04-28 | [android-build-firebase](../learning/2026-04-28-android-build-firebase.md) | Android 빌드 + Firebase 연동 |
| 2026-04-28 | [PC-카운터-Firebase-Web-통합](../learning/2026-04-28-PC-카운터-Firebase-Web-통합.md) | PC 카운터 Firebase Web SDK 통합 |
| 2026-04-28 | [카운터-PC-키오스크-부팅-자동화](../learning/2026-04-28-카운터-PC-키오스크-부팅-자동화.md) | Electron 키오스크 부팅 자동화 |
| 2026-04-29 | [iOS-TestFlight-RN-Firebase-호환](../learning/2026-04-29-iOS-TestFlight-RN-Firebase-호환.md) | iOS TestFlight + RN Firebase 호환 |
| 2026-04-29 | [매장-운영-개선-+-동기화-복구](../learning/2026-04-29-매장-운영-개선-+-동기화-복구.md) | 매장 운영 개선 + 동기화 복구 |
| 2026-04-29 | [아이콘-PWA-진단도구](../learning/2026-04-29-아이콘-PWA-진단도구.md) | 아이콘 + PWA + 진단 도구 |
| 2026-04-29 | [회계-결제수단-VAT-CSV](../learning/2026-04-29-회계-결제수단-VAT-CSV.md) | 회계 / 결제수단 / VAT / CSV |
| 2026-04-29 | [Electron-Phase1](../learning/2026-04-29-Electron-Phase1.md) | Electron Phase 1 (라이브 URL wrapper + 키오스크) |
| 2026-04-29 | [Electron-Phase2-printer](../learning/2026-04-29-Electron-Phase2-printer.md) | Electron Phase 2 (영수증 프린터) |
| 2026-04-29 | [Electron-Phase3-autoupdate](../learning/2026-04-29-Electron-Phase3-autoupdate.md) | Electron Phase 3 (자동 업데이트) |
| 2026-04-29 | [Phase2.1-월계-매뉴얼](../learning/2026-04-29-Phase2.1-월계-매뉴얼.md) | Phase 2.1 결제 후 자동 출력 |
| 2026-04-29 | [Electron-Phase4-offline](../learning/2026-04-29-Electron-Phase4-offline.md) | Electron Phase 4 (오프라인 캐시) |
| 2026-04-30 | [세션인계](../learning/2026-04-30-세션인계.md) | 세션 인계 (CID / 동기화 / 배달) |
| 2026-05-02 | [PC-라이브-번들-해시-진단](../learning/2026-05-02-PC-라이브-번들-해시-진단.md) | PC 동기화 안 될 때 30초 진단 흐름 |
| 2026-05-03 | [kakao-delivery-distance-map](../learning/2026-05-03-kakao-delivery-distance-map.md) | 카카오 배달 거리 계산 + 지도 오버레이 |
| 2026-05-03 | [uid-loss-diagnosis-and-self-recovery](../learning/2026-05-03-uid-loss-diagnosis-and-self-recovery.md) | 익명 UID 손실 진단 + 자가 복구 흐름 설계 |
| 2026-05-07 | [undo-reverted-flag-pattern](../learning/2026-05-07-undo-reverted-flag-pattern.md) | append-only history 의 "되돌리기" — reverted 플래그 패턴 (delete vs flag, 모든 집계의 isCounted 가드, idempotent + occupied 가드) |
| 2026-05-09 | [PowerShell-winspool-우회-electron-native회피](../learning/2026-05-09-PowerShell-winspool-우회-electron-native회피.md) | Electron 의 native module 의존성을 PowerShell + Add-Type 인라인 C# 으로 우회. winspool.Drv API 직접 호출 패턴 + 함정 5종 + 적용 가능 분야 |
| 2026-05-09 | [electron-updater-한계-그리고-단순화](../learning/2026-05-09-electron-updater-한계-그리고-단순화.md) | JS 측(라이브 URL) vs native(.exe) 이원화 빌드 + electron-updater quitAndInstall silent 실패의 한계 + 1.0.28 GitHub 직접 다운로드 단순화 결정 + version sync (package.json + app.json) + 향후 재도입 옵션 4종 |
| 2026-05-09 | [2부-OTA-runtimeVersion-호환과-통일-빌더-패턴](../learning/2026-05-09-2부-OTA-runtimeVersion-호환과-통일-빌더-패턴.md) | expo-updates 의 OTA runtimeVersion 정책 (app.json version 매번 bump 시 호환 깨짐) + 통일 빌더 패턴 (4가지 출력 시점을 한 빌더 buildReceiptText 로) + Sentry breadcrumb 6단계 silent 실패 진단 + RN native onLayout 의 e.target 한계 (useRef 패턴 필수) |

---

## 다음 Q&A 파일 추가 방법

새 세션 Q&A 파일이 생성되면 위 "세션 목록" 표에 한 줄 추가.  
Claude Code 가 자동으로 처리 — 직접 편집 불필요.
