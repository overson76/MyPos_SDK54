// 결제 요청/응답 DTO. Newtonsoft.Json 으로 stdin/stdout JSON 직렬화.
//
// JS 측 (utils/kisPayment.web.js → electron/payment/kis.js) 의 객체 모양과 1:1 대응.
// 필드 이름은 카멜케이스(JS 관례) 로 직렬화되도록 [JsonProperty] 명시.

using Newtonsoft.Json;

namespace MyPos.KisBridge
{
    public class PaymentRequest
    {
        // 셋업 검증 — true 면 OCX 로드만 확인하고 실 결제 X.
        [JsonProperty("dryRun")]
        public bool DryRun { get; set; }

        // OCX ProgID override. 미지정 시 환경변수 또는 default.
        [JsonProperty("progId")]
        public string ProgId { get; set; }

        // 전문구분코드 — Event 버전은 "NV" 필수.
        [JsonProperty("tranCode")]
        public string TranCode { get; set; }

        // D1=신용승인 / D2=신용취소.
        [JsonProperty("tradeType")]
        public string TradeType { get; set; }

        [JsonProperty("agentIP")]
        public string AgentIP { get; set; }

        [JsonProperty("agentPort")]
        public int AgentPort { get; set; }

        // 가맹점단말기번호. KIS-NAGT 설정 메뉴의 default 사용 시 빈 문자열.
        [JsonProperty("catId")]
        public string CatId { get; set; }

        // 서버 IP override (KIS-NAGT 의 default 우선).
        [JsonProperty("addressNo1")]
        public string AddressNo1 { get; set; }

        // 서버 PORT override.
        [JsonProperty("addressNo2")]
        public string AddressNo2 { get; set; }

        // 결제금액 (부가세 포함). 단위: 원, 정수.
        [JsonProperty("amount")]
        public long Amount { get; set; }

        [JsonProperty("vatAmount")]
        public long VatAmount { get; set; }

        [JsonProperty("serviceAmount")]
        public long ServiceAmount { get; set; }

        // 할부 개월. 0 또는 음수 = 일시불.
        [JsonProperty("installment")]
        public int Installment { get; set; }

        // "Y" = Agent 통한 전자서명, "N" = 직접 서명데이터, "" = 무서명.
        [JsonProperty("signMode")]
        public string SignMode { get; set; }

        // 서명 파일 절대 경로. 무서명이면 빈 문자열.
        [JsonProperty("signFilePath")]
        public string SignFilePath { get; set; }

        // KIS-NAGT 의 결제 진행 UI 표시 여부.
        [JsonProperty("showUI")]
        public bool ShowUI { get; set; } = true;

        // 거래수단: K=KEY-IN, s=삼성페이OTC, B=바코드. 미지정 시 IC 기본.
        [JsonProperty("tranGubun")]
        public string TranGubun { get; set; }

        [JsonProperty("barCodeNumber")]
        public string BarCodeNumber { get; set; }

        // 취소거래(D2) 시 원거래 정보.
        [JsonProperty("orgAuthDate")]
        public string OrgAuthDate { get; set; } // YYMMDD

        [JsonProperty("orgAuthNo")]
        public string OrgAuthNo { get; set; }
    }

    public class PaymentResponse
    {
        [JsonProperty("ok")]
        public bool Ok { get; set; }

        [JsonProperty("rawRc")]
        public int RawRc { get; set; }

        [JsonProperty("agentCode")]
        public string AgentCode { get; set; }

        [JsonProperty("replyCode")]
        public string ReplyCode { get; set; }

        [JsonProperty("catId")]
        public string CatId { get; set; }

        [JsonProperty("amount")]
        public string Amount { get; set; }

        [JsonProperty("authNo")]
        public string AuthNo { get; set; }

        [JsonProperty("replyDate")]
        public string ReplyDate { get; set; } // YYYYMMDD

        [JsonProperty("accepterCode")]
        public string AccepterCode { get; set; }

        [JsonProperty("accepterName")]
        public string AccepterName { get; set; }

        [JsonProperty("issuerCode")]
        public string IssuerCode { get; set; }

        [JsonProperty("issuerName")]
        public string IssuerName { get; set; }

        [JsonProperty("merchantRegNo")]
        public string MerchantRegNo { get; set; }

        [JsonProperty("cardBin")]
        public string CardBin { get; set; }

        // 0=신용, 1=체크, 2=기프트.
        [JsonProperty("cardGubun")]
        public string CardGubun { get; set; }

        [JsonProperty("purchaseGubun")]
        public string PurchaseGubun { get; set; }

        [JsonProperty("replyMsg1")]
        public string ReplyMsg1 { get; set; }

        [JsonProperty("replyMsg2")]
        public string ReplyMsg2 { get; set; }

        [JsonProperty("tradeNum")]
        public string TradeNum { get; set; }

        [JsonProperty("tradeReqDate")]
        public string TradeReqDate { get; set; }

        [JsonProperty("tradeReqTime")]
        public string TradeReqTime { get; set; }

        [JsonProperty("wcc")]
        public string Wcc { get; set; }

        // 신용승인 시 발급되는 Van 고유번호 — 취소거래 D2 때 필요.
        [JsonProperty("vanKey")]
        public string VanKey { get; set; }

        [JsonProperty("eightCardBin")]
        public string EightCardBin { get; set; }
    }
}
