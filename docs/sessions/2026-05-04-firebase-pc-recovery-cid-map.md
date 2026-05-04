# 세션 Q&A — 2026-05-04

주제: Firebase v12 PC 연동복구 + Cloudflare 자동빌드 차단 + CID 준비 + 배달 지도 경로

---

## Q&A (질문 순서)

**Q1. 오늘 있었던 이슈를 상황별로 — 원인 찾아봐**
→ 두 원인 동시 발생. ① 아이폰 세션에서 Firebase v12 fix push → Cloudflare 자동 빌드 → Firebase 키 없는 깨진 번들 배포. ② EXE SW 캐시가 그 깨진 번들을 잡아 버림. 장소(매장) 자체는 원인 아님.

**Q2. 아이폰 세션 내용이 저장돼있나? 추가 작업 확인**
→ origin/main 에 4 커밋 추가됨 (Firebase v12 호환 + 매장 코드 레이스 + 대표 PC 재연동). 라이브 URL 번들 해시가 로컬과 달라 Cloudflare 자동 빌드 존재 확인.

**Q3. Sentry 직접 연람해서 확인해봐**
→ JAVASCRIPT-7: firestore/permission-denied 102 events / 4 users / iOS 100%. dist=12, runtime_version=1.0.2, is_embedded_launch=true. 원인 확정.

**Q4. (사진) MyPos v1.0.2 (12) iPhone/iPad — 이게 어떤 의미야?**
→ 카운터 PC 에서 Chrome F12 열어서 번들 해시 확인 → `c606fc6...` (Firebase 키 없음). 원인 100% 확정.

**Q5. Cloudflare 자동 빌드 끊자 + 연동 복구**
→ deploy:web 재배포 → 정상 번들 올림 → Cloudflare Settings → Disconnect → 영구 차단. 카운터 PC Chrome 웹버전 연동 성공, EXE 도 성공.

**Q6. 두 PC 중 한 대는 되고 한 대는 안 되는 시나리오 이해했어**
→ 맞아. 각 PC 의 SW 캐시 상태가 독립적. 주방 PC 는 깨진 번들 전에 정상 캐시 → 정상. 카운터 PC 는 깨진 번들 받은 후 → 이상.

**Q7. 오늘 CID 가 안 된 이유?**
→ CID 자체 문제 아님. 아이폰 세션의 GitHub push → Cloudflare 자동 빌드 → Firebase 키 없는 번들 → 매장 연동 전체 끊김 → CID 시작 불가 (storeId 없음). Cloudflare 끊었으니 내일은 없음.

**Q8. CID 성공 시 어떻게 보여?**
→ 화면 상단 어두운 배너: 📞 전화번호 + 📍 주소(주황) + N번째 주문(민트) + [주문받기] 버튼. 8초 자동 사라짐. 단골/새손님/별칭 3가지 케이스 Preview 로 실제 확인.

**Q9. 배달 지도에 경로도 표시할 수 있어?**
→ 가능. Leaflet Routing Machine (무료 OSRM) 으로 실제 도로 경로 색깔 선 표시. Preview 로 주황 경로 확인.

**Q10. 배달 여러 개를 지도에 전부 다 핀으로 표시하고 색깔 다른 경로 표시 가능해?**
→ 가능. Preview 에서 배달1(주황)/배달2(파랑)/배달3(초록) 번호 마커 + 색깔 경로 + 범례 확인. 적용 결정.

**Q11. 개별 🗺️ 클릭 vs 전체 배달 지도 둘 다 가능해?**
→ A+B 둘 다. 개별 배달 카드 🗺️ 클릭 → 그 배달만. 헤더 "🗺️ 배달지도" 버튼 → 전체 배달 한 화면.

**Q12. 프린터 (SEWOO SLK-TS400) 연결 방법?**
→ 기본 모델 = USB only (블루투스 없음). USB-A to USB-B 케이블. 5m 이상이면 USB 신호 손실 → 주방 배치 어려움. 해결: USB 프린터 서버 (2~3만원) 또는 SLK-TS400EB (Ethernet 버전) 구매.

**Q13. 주방에 두고 카운터에서 원격 출력하려면?**
→ USB 프린터 서버(Wi-Fi) 가 가장 경제적. 현재 프린터 그대로 사용 + 2~3만원 추가. 우리 코드 MYPOS_PRINTER_MODE=network 로 바로 연동 가능.

---

## 단계별 흐름

```
[PC 연동 실패 진단]
1. Sentry 콘솔 직접 연람 (Chrome 자동화)
   → firestore/permission-denied 102 events / dist=12 확정
2. origin/main 과 sync → 아이폰 세션 4 커밋 확인
3. 라이브 URL 번들 해시 불일치 확인 → Cloudflare 자동 빌드 원인
4. F12 콘솔 (카운터 PC Chrome) → c606fc6 깨진 번들 확인

[복구]
5. deploy:web 재배포 → 정상 번들 (29a7e1d) 올림
6. Cloudflare Settings → Disconnect → 자동 빌드 영구 차단
7. 카운터 PC Chrome 강제 새로고침 → 정상 번들 수신 → 연동 성공
8. 주방 PC + 폰 연동 확인

[기능 추가 — commit d279775]
9. DeliveryMapModal.js / .native.js — Leaflet Routing Machine 경로 + 다중 배달 deliveries 배열
10. TableScreen.js — openAllDeliveryMap + "🗺️ 배달지도" 헤더 버튼
11. EAS OTA 2ba4b014 + deploy:web + git push

[프린터 조사]
12. SEWOO SLK-TS400 스펙 확인 → USB only (블루투스 X)
13. 주방 원격 출력: USB 프린터 서버 또는 SLK-TS400EB 구매 권장
```

---

## 커밋

| 커밋 | 내용 |
|---|---|
| `33f8606` (아이폰 세션) | Firebase v12 호환 + 매장 코드 레이스 수정 |
| `d279775` | 배달 지도 경로 + 다중 배달 핀 (Leaflet Routing Machine) |

---

## 내일 체크리스트

- [ ] 카운터 PC EXE 켜기 → 매장 연동 확인
- [ ] `ping 192.168.10.100` — SIP 서버 도달
- [ ] 본인 폰으로 매장 회선에 전화 1통 → CID 팝업 + TTS 확인
- [ ] CID 성공 → 영업 정상화
- [ ] 프린터 (카운터 PC 옆 USB) 출력 테스트
- [ ] 이후 방향: USB 프린터 서버 or SLK-TS400EB 결정

---

## 오늘 학습 포인트

### Cloudflare 자동 빌드 함정
GitHub main push → Cloudflare 자동 빌드 → Firebase 키 없이 빌드 → 라이브 URL 깨진 번들 배포.
F12 콘솔에 `EXPO_PUBLIC_FIREBASE_* 비어있어` 메시지가 첫 단서. 즉시 로컬 deploy:web.

**영구 처방 (오늘 적용)**: Cloudflare Settings → Build → Disconnect. 앞으로 deploy:web 수동으로만.

### 캐시 독립 원칙
PC 두 대가 같은 라이브 URL 사용해도 SW 캐시는 각각 독립. 한 대는 정상 번들 캐시 → OK, 다른 한 대는 깨진 번들 캐시 → 연동 실패. 진단 시 F12 → script src 해시 비교가 핵심.

### EXE = Chromium 내장
Electron .exe = 내부 Chromium이 라이브 URL을 fetch. SW 캐시도 내부에 있음. 웹브라우저 캐시와 독립. 연동 복구는 내부 캐시 비우기 또는 새 번들 fetch 후 재시작.
