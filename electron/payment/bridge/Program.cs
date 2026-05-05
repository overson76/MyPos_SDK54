// MyPos KIS-NAGT 결제 브릿지
//
// 역할: Electron(Node.js) ↔ KIS OCX 사이의 얇은 변환 계층.
//   - stdin 으로 결제 요청 JSON 수신
//   - KIS OCX(ActiveX, COM) 호출
//   - stdout 으로 결제 응답 JSON 출력
//   - exit code: 0=정상승인, 1=KIS 응답 비정상(거절/오류), 2=시스템 에러(접속 실패 등)
//
// OCX 클래스명: 환경변수 MYPOS_KIS_PROGID 또는 기본 "KisPosAgent.KisPosAgent" (KIS 매뉴얼 기준).
// 매장 환경에서 ProgID 가 다르면 환경변수로 override.
//
// 32 비트 강제: KIS OCX 가 32 비트 COM → x86 빌드 필수. csproj 에 PlatformTarget=x86.
//
// 동기/비동기:
//   inUnitLockYN="Y" 동기 모드 — 한 번 호출에 결제 결과까지 동기 반환. Console 앱 친화적.
//   비동기(Event) 모드는 향후 필요 시 ApplicationContext + OnApprovalEnd 이벤트 패턴으로 확장.
//
// 호출 예 (PowerShell):
//   echo '{"tradeType":"D1","amount":1000}' | KisPaymentBridge.exe
//
// 종료 코드 의미:
//   0 — outAgentCode == "0000" && outReplyCode == "0000" (정상 승인/취소)
//   1 — KIS 응답 받음 but 비정상 (카드 거절, 한도 초과 등) — outReplyMsg 에 사유
//   2 — 시스템 에러 (KIS-NAGT 미실행, OCX 등록 안됨, 네트워크 오류 등)

using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json;

namespace MyPos.KisBridge
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                var rawInput = Console.In.ReadToEnd();
                if (string.IsNullOrWhiteSpace(rawInput))
                {
                    EmitError(2, "stdin 으로 JSON 결제 요청을 보내야 합니다.");
                    return 2;
                }

                PaymentRequest req;
                try
                {
                    req = JsonConvert.DeserializeObject<PaymentRequest>(rawInput);
                }
                catch (Exception ex)
                {
                    EmitError(2, "요청 JSON 파싱 실패: " + ex.Message);
                    return 2;
                }

                if (req == null)
                {
                    EmitError(2, "요청 JSON 이 비어있습니다.");
                    return 2;
                }

                // dry-run: OCX 등록/연결만 확인. 실 결제 X. 매장 셋업 검증용.
                if (req.DryRun)
                {
                    return RunDryRun(req);
                }

                return RunPayment(req);
            }
            catch (Exception ex)
            {
                EmitError(2, "치명적 오류: " + ex.Message, ex.StackTrace);
                return 2;
            }
        }

        // 결제 실행 — 매뉴얼의 [샘플코드 - 신용승인] 흐름.
        private static int RunPayment(PaymentRequest req)
        {
            var progId = ResolveProgId(req);
            var agentType = Type.GetTypeFromProgID(progId, throwOnError: false);
            if (agentType == null)
            {
                EmitError(2, $"OCX 등록 안 됨 (ProgID: {progId}). KIS-NAGT 설치 + regsvr32 확인 필요.");
                return 2;
            }

            dynamic agent = null;
            try
            {
                agent = Activator.CreateInstance(agentType);

                // 매번 호출 전 초기화 — 이전 호출의 프로퍼티 잔류 방지.
                TryInvoke(agent, "Init");

                agent.inTranCode = req.TranCode ?? "NV";
                agent.inTradeType = req.TradeType ?? "D1"; // D1 승인, D2 취소
                agent.inAgentIP = string.IsNullOrEmpty(req.AgentIP) ? "127.0.0.1" : req.AgentIP;
                agent.inAgentPort = req.AgentPort > 0 ? req.AgentPort : 1515;

                if (!string.IsNullOrEmpty(req.CatId)) agent.inCatId = req.CatId;
                if (!string.IsNullOrEmpty(req.AddressNo1)) agent.inAddressNo1 = req.AddressNo1;
                if (!string.IsNullOrEmpty(req.AddressNo2)) agent.inAddressNo2 = req.AddressNo2;

                agent.inTranAmt = req.Amount.ToString();
                agent.inVatAmt = req.VatAmount > 0 ? req.VatAmount.ToString() : "";
                agent.inSvcAmt = req.ServiceAmount > 0 ? req.ServiceAmount.ToString() : "";
                agent.inInstallment = (req.Installment >= 0 ? req.Installment : 0).ToString("D2");

                // 5만원 미만은 무서명, 이상은 전자서명 필수 (Y).
                // KIS 매뉴얼: ※ 5만원 이상 결제와 무관하게 보내야 함 → 빈 문자열도 허용.
                agent.inSignYN = string.IsNullOrEmpty(req.SignMode) ? "" : req.SignMode;
                agent.inSignFileName = req.SignFilePath ?? "";

                // 동기 모드 — Console 앱에서 가장 단순. 한 호출에 결제 결과 반환.
                agent.inUnitLockYN = "Y";
                // UI 출력 — KIS-NAGT 의 결제 진행 팝업 표시. "0" 이면 백그라운드.
                agent.inUnitMode = req.ShowUI ? "1" : "0";

                // 취소 거래 시 원거래 정보 필수.
                if (string.Equals(req.TradeType, "D2", StringComparison.OrdinalIgnoreCase))
                {
                    agent.inOrgAuthDate = req.OrgAuthDate ?? "";
                    agent.inOrgAuthNo = req.OrgAuthNo ?? "";
                }

                // 거래 수단 (KEY-IN, 삼성페이, 바코드 등) — 미지정 시 KIS 기본값(IC).
                if (!string.IsNullOrEmpty(req.TranGubun)) agent.inTranGubun = req.TranGubun;
                if (!string.IsNullOrEmpty(req.BarCodeNumber)) agent.inBarCodeNumber = req.BarCodeNumber;

                // KIS_ICApproval — 매뉴얼 기준 승인/취소 모두 같은 메서드 (TradeType 으로 구분).
                int rc = SafeInvokeInt(agent, "KIS_ICApproval");

                var resp = ReadResponse(agent);
                resp.RawRc = rc;

                Console.Write(JsonConvert.SerializeObject(resp, Formatting.None));

                bool approved =
                    string.Equals(resp.AgentCode, "0000", StringComparison.Ordinal) &&
                    string.Equals(resp.ReplyCode, "0000", StringComparison.Ordinal);

                return approved ? 0 : 1;
            }
            finally
            {
                if (agent != null)
                {
                    try { System.Runtime.InteropServices.Marshal.ReleaseComObject(agent); }
                    catch { /* 무시 — best-effort */ }
                }
            }
        }

        // 매장 셋업 검증 — OCX 등록/로드만 확인. 결제 X.
        private static int RunDryRun(PaymentRequest req)
        {
            var progId = ResolveProgId(req);
            var agentType = Type.GetTypeFromProgID(progId, throwOnError: false);
            if (agentType == null)
            {
                EmitError(2, $"OCX 등록 안 됨 (ProgID: {progId}).");
                return 2;
            }

            try
            {
                dynamic probe = Activator.CreateInstance(agentType);
                TryInvoke(probe, "Init");
                System.Runtime.InteropServices.Marshal.ReleaseComObject(probe);
            }
            catch (Exception ex)
            {
                EmitError(2, "OCX 인스턴스화 실패: " + ex.Message);
                return 2;
            }

            var ok = new
            {
                ok = true,
                dryRun = true,
                progId,
                message = "OCX 정상 로드. KIS-NAGT 통신은 실 결제 호출에서 검증."
            };
            Console.Write(JsonConvert.SerializeObject(ok, Formatting.None));
            return 0;
        }

        private static string ResolveProgId(PaymentRequest req)
        {
            if (!string.IsNullOrWhiteSpace(req.ProgId)) return req.ProgId;
            var env = Environment.GetEnvironmentVariable("MYPOS_KIS_PROGID");
            if (!string.IsNullOrWhiteSpace(env)) return env;
            // 매뉴얼/샘플 기준 가장 흔한 ProgID. 매장 환경에서 다르면 환경변수로 override.
            return "KisPosAgent.KisPosAgent";
        }

        private static PaymentResponse ReadResponse(dynamic agent)
        {
            return new PaymentResponse
            {
                Ok = SafeReadString(agent, "outAgentCode") == "0000"
                    && SafeReadString(agent, "outReplyCode") == "0000",
                AgentCode = SafeReadString(agent, "outAgentCode"),
                ReplyCode = SafeReadString(agent, "outReplyCode"),
                CatId = SafeReadString(agent, "outCatId"),
                Amount = SafeReadString(agent, "outTranAmt"),
                AuthNo = SafeReadString(agent, "outAuthNo"),
                ReplyDate = SafeReadString(agent, "ouReplyDate"), // 매뉴얼 오타: ouReplyDate
                AccepterCode = SafeReadString(agent, "outAccepterCode"),
                AccepterName = SafeReadString(agent, "outAccepterName"),
                IssuerCode = SafeReadString(agent, "outIssuerCode"),
                IssuerName = SafeReadString(agent, "outIssuerName"),
                MerchantRegNo = SafeReadString(agent, "outMerchantRegNo"),
                CardBin = SafeReadString(agent, "outCardNo"),
                CardGubun = SafeReadString(agent, "outCardGubun"), // 0 신용 1 체크 2 기프트
                PurchaseGubun = SafeReadString(agent, "outPurchaseGubun"),
                ReplyMsg1 = SafeReadString(agent, "outReplyMsg1"),
                ReplyMsg2 = SafeReadString(agent, "outReplyMsg2"),
                TradeNum = SafeReadString(agent, "outTradeNum"),
                TradeReqDate = SafeReadString(agent, "outTradeReqDate"),
                TradeReqTime = SafeReadString(agent, "outTradeReqTime"),
                Wcc = SafeReadString(agent, "outWCC"),
                VanKey = SafeReadString(agent, "outVanKey"),
                EightCardBin = SafeReadString(agent, "outEightCardNo"),
            };
        }

        private static string SafeReadString(dynamic agent, string prop)
        {
            try
            {
                var t = agent.GetType();
                var p = t.InvokeMember(prop, BindingFlags.GetProperty, null, agent, null);
                return p?.ToString() ?? "";
            }
            catch { return ""; }
        }

        private static int SafeInvokeInt(dynamic agent, string method, params object[] args)
        {
            try
            {
                var t = agent.GetType();
                var r = t.InvokeMember(method, BindingFlags.InvokeMethod, null, agent, args);
                if (r == null) return 0;
                if (r is int i) return i;
                int.TryParse(r.ToString(), out int parsed);
                return parsed;
            }
            catch
            {
                return -999;
            }
        }

        private static void TryInvoke(dynamic agent, string method)
        {
            try
            {
                var t = agent.GetType();
                t.InvokeMember(method, BindingFlags.InvokeMethod, null, agent, null);
            }
            catch { /* 무시 */ }
        }

        private static void EmitError(int rc, string message, string stack = null)
        {
            var err = new
            {
                ok = false,
                rc,
                error = message,
                stack
            };
            Console.Write(JsonConvert.SerializeObject(err, Formatting.None));
        }
    }
}
