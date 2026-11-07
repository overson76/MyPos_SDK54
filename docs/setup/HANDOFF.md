# HANDOFF — 새 세션 인수인계

새 세션 첫 메시지로 아래 `## 지시` 코드블록을 그대로 붙여 넣는다.
이 파일은 「저장」/「세션종료」 때마다 갱신한다 (글로벌 규칙 7단계).

---

## 지시

```
MyPos_SDK54 이어서 한다. C:\MyProjects\MyPos_SDK54

■ 먼저 읽을 파일 (순서대로)
1. docs/sessions/2026-09-11-쓰기폭발-한도소진.md  ← 맨 위 「다음 세션」 섹션
2. CLAUDE.md 의 "출력 양식 변경은 텍스트 빌더에서" 절
3. docs/collaboration-rules.md

■ 지금 상태 (2026-11-07 확인)
- main = 4d5294b, 워킹트리 clean, origin 과 동기화됨
- jest 802 전부 통과 (36 suite)
- 9/11 쓰기폭발 처방(deepEqual + writeGuard) 배포 완료 후 코드 변경 없음
- 자동배포 동작: main push → GitHub Actions → Cloudflare. PC 불필요

■ 다음 일 순서
1. 먼저 물을 것 — 9/11 미검증 2건이 두 달 지났으니 현재 상태부터 확인
   ① 기기 3대 주문·열린 테이블이 합쳐지나?
   ② 관리자 → 시스템 → ☁️ 클라우드 사용량의 오늘 쓰기 건수
      (몇백 = 정상 / 수천 = 루프 잔존)
2. 합쳐지면 → 매장 정리 (사장님 승인 완료, Firebase 콘솔에서)
   stores:     J77BV7SS 검증매장 · XJMV2BUK 테스트매장 · 8777FSHF 행복밀면 · 38KKJ22E 미리보기테스트
   storeCodes: 위 4개 + 고아 8YEGV3MX · Q4X2H9DA
   🔴 T8G8BBXB / 춘하추동(storeId …SXsmLEzcAcui) 은 절대 건드리지 말 것 — 실매장
3. firestore.rules 의 returnRounds 규칙 6줄 추가 (롤백으로 되돌아가 있음)
   → 지금 배달회수 차수가 Firestore 에 저장되지 않는 상태
4. history 전량 구독(1000건) → 최근 N일로 축소. 7/3·9/11 두 번 "다음 근본" 으로 적힌 항목

■ 이미 받은 결정 (다시 묻지 말 것)
- Blaze 업그레이드 안 함. 한도 리셋(한국시간 16시) 을 기다린다
- 결제 정보 입력은 Claude 가 하지 않는다
- 테스트 매장 4개(행복밀면 포함)는 지운다
- 원인이 아닌 선택 기능은 토글로 빼고 꺼둔다
- 출력물 계좌 문구는 ON/OFF 스위치로 운영 (관리자 → 시스템 → 주문지 출력 정책)

■ 검증할 것
cd /c/MyProjects/MyPos_SDK54
git log --oneline -3     # 4d5294b 가 최신
npx jest                 # 802 통과

■ 함정
- 출력 양식은 utils/escposBuilder.js 의 *텍스트 빌더* 에서만 고친다.
  바이트 래퍼/electron/printer 는 .exe 번들이라 재빌드 사이클이 걸린다
- 무한 write 의심 시 Firebase 콘솔 Usage 를 먼저 본다. 롤백부터 하지 말 것
  (6/10 union 사고 · 9/11 재발 — 둘 다 참조 비교가 범인)
- 증거 먼저. 9/11 은 원인 미확정 상태의 배포가 방아쇠가 되어 사태를 키웠다
- 배치 파일은 CRLF 필수 (LF 면 창이 깜빡하고 즉사, 에러도 안 남음)
- PowerShell 파이프로 비밀값을 넘기면 chcp 65001 환경에서 앞에 BOM 이 붙는다
  → 값은 멀쩡한데 인증만 실패. BOM 없는 임시파일 + stdin 리다이렉트로
- deploy:web 은 영업 외 시간(일요일 휴무 · 평일 10:30~20:00 영업)
- docs 만 고쳐도 main push 면 자동배포가 돈다. 번들 내용은 같으니 무해
```

---

## 갱신 이력

| 날짜 | 갱신 내용 |
|---|---|
| 2026-11-07 | 최초 작성. 9/11 쓰기폭발 세션의 「다음 세션」 + 7/30 자동배포 함정을 합쳐 지시문화 |
