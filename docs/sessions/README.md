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

---

## 다음 Q&A 파일 추가 방법

새 세션 Q&A 파일이 생성되면 위 "세션 목록" 표에 한 줄 추가.  
Claude Code 가 자동으로 처리 — 직접 편집 불필요.
