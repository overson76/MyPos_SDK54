# KIS-NAGT 결제 브릿지 (C#)

Electron(Node.js)이 KIS OCX(ActiveX, COM)를 직접 호출할 수 없으므로, 얇은 C# 콘솔 앱이 사이에 들어가서 변환만 한다.

```
Electron 메인 프로세스 (electron/payment/kis.js)
   ↓ child_process.spawn + stdin JSON
KisPaymentBridge.exe (이 폴더)
   ↓ COM Late Binding (dynamic)
KIS OCX (KisPosAgent.KisPosAgent)
   ↓ TCP 127.0.0.1:1515
KIS-NAGT (Network Agent — 매장 PC 에 설치)
   ↓
KIS-PAD 카드 단말기 (LAN)
   ↓
카드사 승인 서버
```

## 빌드

**필요**: Visual Studio 2022 또는 .NET SDK 7+ (net48 타겟 빌드 가능).

```bash
cd electron/payment/bridge
dotnet build -c Release -p:Platform=x86
```

산출물: `bin/Release/net48/KisPaymentBridge.exe` (32 비트).

> **32 비트 강제 이유**: KIS OCX 가 32 비트 COM. 64 비트로 빌드하면 `Type.GetTypeFromProgID` 가 `null` 반환.

## 입출력 프로토콜

### 입력 (stdin, JSON)

```json
{
  "tradeType": "D1",          // D1=승인, D2=취소
  "amount": 12500,            // 결제금액 (원, 정수)
  "vatAmount": 1136,          // 부가세 (선택)
  "installment": 0,           // 할부개월 (0=일시불)
  "agentIP": "127.0.0.1",
  "agentPort": 1515,
  "showUI": true,             // KIS-NAGT 결제 진행 팝업 표시
  "signMode": "",             // "" 무서명 / "Y" 서명패드 / "N" 직접

  "orgAuthDate": "260105",    // 취소 시 필수 (YYMMDD)
  "orgAuthNo": "12345678901"  // 취소 시 필수
}
```

### 출력 (stdout, JSON)

```json
{
  "ok": true,
  "agentCode": "0000",
  "replyCode": "0000",
  "amount": "12500",
  "authNo": "12345678901",
  "replyDate": "20260105",
  "issuerName": "신한카드",
  "accepterName": "신한카드",
  "cardBin": "457199",
  "vanKey": "ABCDEFGHIJKLMNOP",
  "replyMsg1": "정상승인",
  "replyMsg2": ""
}
```

### 종료 코드

- `0` — 정상 승인/취소 (`agentCode == "0000" && replyCode == "0000"`)
- `1` — KIS 응답 받음, 비정상 (카드 거절, 한도 초과 등). `replyMsg1/2` 에 사유.
- `2` — 시스템 에러 (KIS-NAGT 미실행, OCX 미등록, 파싱 실패 등). `error` 필드.

## 환경변수

- `MYPOS_KIS_PROGID` — OCX ProgID override. default: `KisPosAgent.KisPosAgent`. 매장 KIS 버전마다 다를 수 있어 셋업 시 확인.

## 셋업 검증 (dry-run)

실 결제 전에 OCX 등록/로드만 확인:

```bash
echo {"dryRun":true} | KisPaymentBridge.exe
# stdout: {"ok":true,"dryRun":true,"progId":"KisPosAgent.KisPosAgent",...}
```

## 매장 PC 셋업 순서

1. KIS POSPORTAL 자료실에서 `KisAgent_Setup_3460_PosNo_*.zip` 다운로드.
2. 압축 풀고 동봉된 설치 순서대로:
   - VS2008 재배포 패키지 (32비트, 64비트)
   - .NET Framework 4.0
   - KIS-NAGT 본체 (관리자 권한 설치)
3. KIS-NAGT 실행 → 가맹점 다운로드 → 단말기번호 설정.
4. KIS-PAD 단말기를 같은 LAN(공유기)에 연결.
5. 이 브릿지 dry-run 실행으로 OCX 로드 확인:
   ```
   echo {"dryRun":true} | "C:\Program Files\MyPos\resources\bridge\KisPaymentBridge.exe"
   ```

## 향후 확장

- **비동기 Event 모드**: 현재는 `inUnitLockYN="Y"` 동기. ApplicationContext + OnApprovalEnd 이벤트로 진행 상태 실시간 표시 가능. UI 진행 모달 만들 때 검토.
- **현금영수증/통합간편결제**: 매뉴얼 다른 섹션. 메서드만 다르고 패턴 동일 — 같은 브릿지에 분기 추가.
