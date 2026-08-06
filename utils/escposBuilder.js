// ESC/POS 영수증 빌더 — 순수 함수.
// 한국 매장에서 가장 흔한 80mm 서멀 프린터(Bixolon SRP, Epson TM-T20, Star TSP 등) 호환.
// 실제 USB / 네트워크 출력은 electron/printer/print.js 가 처리. 여기는 명령 바이트열만 생성.
//
// 표준 ESC/POS 명령 (가장 보편적인 것만):
//   ESC @     0x1B 0x40        — Initialize printer (reset)
//   ESC E n   0x1B 0x45 n      — Bold ON(1)/OFF(0)
//   ESC ! n   0x1B 0x21 n      — Print mode (font size, double-width 등)
//   ESC a n   0x1B 0x61 n      — Justification: 0 left, 1 center, 2 right
//   GS V n    0x1D 0x56 n      — Cut paper (0=full, 1=partial)
//   LF        0x0A             — Line feed
//
// 한국어: 대부분 80mm 매장 프린터는 EUC-KR(CP949) 한글 자체 코드 페이지 지원.
// 이 모듈은 인코딩 직접 안 함 — 출력 라이브러리(node-thermal-printer 등) 가 자동 변환.
// 여기서는 UTF-8 string + ESC/POS 명령 바이트열을 합친 Uint8Array 반환.
// 출력 단계에서 텍스트만 EUC-KR 변환 후 명령 바이트와 concat.
//
// 더 단순한 대안: text-only 영수증 (printer-ready string) 도 함께 반환 — 출력 라이브러리가
// 알아서 양식 + 명령 변환. 두 가지 모드 지원.

// ESC/POS 명령 상수 (Uint8Array 로 만들어두면 편함).
const ESC = 0x1B;
const GS = 0x1D;

export const CMD = {
  init: new Uint8Array([ESC, 0x40]),
  cutFull: new Uint8Array([GS, 0x56, 0x00]),
  cutPartial: new Uint8Array([GS, 0x56, 0x01]),
  alignLeft: new Uint8Array([ESC, 0x61, 0x00]),
  alignCenter: new Uint8Array([ESC, 0x61, 0x01]),
  alignRight: new Uint8Array([ESC, 0x61, 0x02]),
  boldOn: new Uint8Array([ESC, 0x45, 0x01]),
  boldOff: new Uint8Array([ESC, 0x45, 0x00]),
  // ESC ! n — bit0: font B, bit3: bold, bit4: double height, bit5: double width, bit7: underline
  sizeNormal: new Uint8Array([ESC, 0x21, 0x00]),
  sizeDoubleWide: new Uint8Array([ESC, 0x21, 0x20]),
  sizeDouble: new Uint8Array([ESC, 0x21, 0x30]), // double w + h
  feed: new Uint8Array([0x0A]),
};

// 매장 입금 계좌 — 모든 출력물(영수증 / 주문지 / 배달회수) 상단에 고정 표기.
// 손님이 계좌이체할 때 영수증만 보고 바로 송금할 수 있게.
export const STORE_BANK_LINES = ['부산은행 강 태 선', '082-02-0303057'];

// 계좌 블록 출력 여부 — 모듈 단일 진실 소스 (notify.js 의 _volume 과 같은 패턴).
// 텍스트 빌더는 순수 함수라 매 출력마다 AsyncStorage 를 읽을 수 없다. 앱 부팅 시 1회
// hydrate(App.js) + 설정 토글이 즉시 갱신하고, 영속화는 utils/printPolicy.js 책임.
// 기본 true — 저장값 없는 옛 매장은 지금까지의 동작(계좌 항상 출력) 그대로.
let _bankHeaderEnabled = true;

export function setBankHeaderEnabled(enabled) {
  _bankHeaderEnabled = !!enabled;
}

export function isBankHeaderEnabled() {
  return _bankHeaderEnabled;
}

// 상단 고정 블록 텍스트 — 굵은 계좌 안내 + 구분선.
//
// 2026-07-30: 사장님 요청 "좀더 크고 진하게". 세로까지 2배('big') 로 안 가는 이유는
// 1.0.45 헤더 피드백("2배 너무 큼") 과 같은 기준 — 가로 2배 + bold 가 상한.
// 정렬은 공백 padding(centerText) 이 아니라 프린터의 ESC a 1 에 맡긴다.
// 가로 2배 글씨는 32칼럼 폭 계산이 깨져서 padding 방식이면 오른쪽으로 밀린다.
//
// 2026-08-06: 사장님 요청 "30% 정도 줄여". ESC/POS 배율은 정수(1x/2x/…) 뿐이라 0.7배가
// 없다 — 가장 가까운 수단이 font B(ESC ! bit0). font A 12dot 대비 9dot 폭이라 약 25%
// 작아진다. 가로 2배는 유지 — 손님이 멀리서 계좌를 읽는 게 이 블록의 존재 이유.
export function buildTopHeaderText() {
  return [...STORE_BANK_LINES.map((line) => boldCenter(line)), divider('-')].join('\n');
}

// 완성된 본문 위에 계좌 블록을 얹는다. 이미 붙어있으면 그대로 — 이중 출력 방지.
// opts.bankHeader 로 이 출력 한 번만 강제 ON/OFF 가능 (미지정 시 매장 설정값).
//
// 2026-07-30: 계좌 블록을 *텍스트 빌더* 단계에 두는 이유 — 배포 경로.
// 바이트 래핑(buildReceiptBytes/buildTextBytes) 은 .exe 메인 프로세스에서만 도는
// 코드라 문구를 거기 두면 매장 반영에 .exe 재빌드가 필요하다. 텍스트 빌더는 라이브
// URL 번들(렌더러) 에서 도므로 deploy:web 한 번이면 매장 PC 가 새로고침 시 즉시 반영.
export function withTopHeader(text, opts) {
  const body = String(text ?? '');
  const enabled = typeof opts?.bankHeader === 'boolean' ? opts.bankHeader : _bankHeaderEnabled;
  if (!enabled) return body;
  if (STORE_BANK_LINES.length > 0 && body.includes(STORE_BANK_LINES[0])) return body;
  return buildTopHeaderText() + '\n' + body;
}

// 80mm 서멀 한 줄에 한글 약 16자, 영문 32자 가량. 폭 32 칼럼 기준으로 좌/우 정렬.
const COL_WIDTH = 32;

// 텍스트 두 영역을 한 줄에 좌우 정렬 — 메뉴명 / 가격 같이.
// 한글은 2칼럼 차지로 카운트 (대부분 80mm 프린터 기본 코드페이지 동작).
export function pad2col(left, right, width = COL_WIDTH) {
  const lw = visualWidth(left);
  const rw = visualWidth(right);
  const space = Math.max(1, width - lw - rw);
  return left + ' '.repeat(space) + right;
}

// 한글(2칼럼) / ASCII(1칼럼) 추정. 정확하진 않지만 영수증 정렬엔 충분.
export function visualWidth(s) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    const code = ch.codePointAt(0);
    // ASCII / Latin-1 은 1, 그 외 (한글 / 일본어 / 한자 등 CJK) 는 2 가정
    w += code < 0x80 ? 1 : 2;
  }
  return w;
}

// 단순 구분선 — '-' 32개.
export function divider(ch = '-', width = COL_WIDTH) {
  return ch.repeat(width);
}

// 결제수단 코드 → 한국어 라벨. utils/payment.js 와 동일 매핑이지만 순환 import 방지차 분리.
function paymentMethodLabel(code) {
  if (!code || code === 'unspecified') return '미분류';
  const map = {
    cash: '현금',
    card: '카드',
    transfer: '계좌이체',
    localCurrency: '지역화폐',
  };
  return map[code] || '미분류';
}

// ─── 1.0.44: ESC/POS 명령 인라인 헬퍼 ───
// buildTextBytes(text, eucKrEncode) 가 텍스트를 EUC-KR 변환할 때 ASCII 범위(0x00-0x7F)는
// 그대로 보존. 명령 바이트(ESC=0x1B, !=0x21 등)도 ASCII 라 안전. 한글만 EUC-KR 로 변환.
// 줄별로 ESC ! n / ESC a n 명령을 prefix 로 붙이고, 줄 끝에 reset 으로 복귀.
//
// size: 'normal' | 'wide' (가로 두 배) | 'big' (가로+세로 두 배)
const ESC_S = '\x1B';
const SIZE_NORMAL = ESC_S + '\x21\x00';
const SIZE_WIDE = ESC_S + '\x21\x20';
const SIZE_BIG = ESC_S + '\x21\x30';
const ALIGN_LEFT = ESC_S + '\x61\x00';
const ALIGN_CENTER = ESC_S + '\x61\x01';
// ESC E n — 굵게 ON/OFF. ESC ! 의 bold 비트(0x08) 와 이중으로 거는 이유:
// 프린터 모델에 따라 둘 중 하나만 인식하는 경우가 있어 양쪽 다 걸어야 확실히 진해진다.
const BOLD_ON = ESC_S + '\x45\x01';
const BOLD_OFF = ESC_S + '\x45\x00';
const SIZE_WIDE_BOLD = ESC_S + '\x21\x28'; // 가로 2배(0x20) + bold(0x08)
// 계좌 블록 전용 — 위 조합에 font B(0x01) 를 더해 폭 12dot → 9dot (약 25% 축소).
// 프린터가 한글에 font B 를 지원하지 않으면 그 줄만 옛 크기로 나올 뿐 깨지지는 않는다.
const SIZE_WIDE_BOLD_SMALL = ESC_S + '\x21\x29';

function sizeCmd(size) {
  if (size === 'big') return SIZE_BIG;
  if (size === 'wide') return SIZE_WIDE;
  return SIZE_NORMAL;
}

// 큰 글씨 + 가운데 정렬 — 프린터가 자동 정렬 (32 vs 16 폭 계산 안 해도 됨).
function bigCenter(text, size = 'big') {
  return ALIGN_CENTER + sizeCmd(size) + text + SIZE_NORMAL + ALIGN_LEFT;
}

// 굵게 + 큰 글씨 + 가운데 정렬 — 손님이 한눈에 읽어야 하는 계좌 안내용.
function boldCenter(text) {
  return ALIGN_CENTER + SIZE_WIDE_BOLD_SMALL + BOLD_ON + text + BOLD_OFF + SIZE_NORMAL + ALIGN_LEFT;
}

// 큰 글씨 + 왼쪽 정렬 (배달 본문 줄).
function bigLeft(text, size = 'wide') {
  return sizeCmd(size) + text + SIZE_NORMAL;
}

// 1.0.44: 주문지 헤더 라벨 — 상황별. EUC-KR 호환 (이모지 X, 한글 + ASCII).
function headerTitle(orderType) {
  if (orderType === 'delivery') return '[ 배 달 주 문 지 ]';
  if (orderType === 'reservation') return '[ 예 약 주 문 지 ]';
  if (orderType === 'takeout') return '[ 포 장 주 문 지 ]';
  return '[ 매 장 주 문 지 ]';
}

// 거리 m → "도로 1.2km" / "도로 850m"
// 2026-05-28: 절대값 sanity check — 잠복 비정상 drivingM 이 영수증에 흘러들지
// 않도록 빌더 단에서도 차단. 사장님 룰 "매장 5km 반경" 기준 도로 거리 상한 10km.
// 이 빌더는 순수 함수(useStore 못 씀) 라 헬퍼 import 대신 상수 인라인.
function formatDrivingShort(m) {
  if (typeof m !== 'number' || !isFinite(m) || m < 0) return '';
  if (m > 10 * 1000) return '';
  if (m < 1000) return `${Math.round(m)}m`;
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

function formatDurationShort(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// 사장님 배달 라벨 정책: 별칭 > 전번(포맷팅) > 주소 — 가장 우선되는 한 라벨.
// prefix("배달지 ", "별칭 ", "손님 ") 없이 *순수 식별자* 만 반환.
// 영수증/주방슬립 모두 이 헬퍼로 통일.
function resolveDeliveryLabel(r) {
  const aliasText = (r?.customerAlias || '').trim();
  if (aliasText) return aliasText;
  const phoneText = (r?.customerPhone || '').trim();
  if (phoneText) return formatPhone(phoneText);
  const addrText = (r?.deliveryAddress || '').trim();
  if (addrText) return addrText;
  return '';
}

// "01012345678" → "010-1234-5678". 7~11자리만 처리, 외엔 그대로.
function formatPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) {
    if (d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 9 && d.startsWith('02')) {
    return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  }
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return digits || '';
}

// "1220" + isPM=true → "오후 12시 20분". null 처리.
function formatScheduledTime(rawTime, isPM) {
  if (!rawTime) return '';
  const digits = String(rawTime).replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 4) return '';
  let h, m;
  if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10);
    m = parseInt(digits.slice(1), 10);
  } else {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2), 10);
  }
  if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m > 59) return '';
  const period = isPM ? '오후' : '오전';
  return `${period} ${h}시 ${String(m).padStart(2, '0')}분`;
}

// 영수증 본문 텍스트 빌드 — 1.0.33 간결형.
// 사장님 의도: 주문지 / 테이블명 / 배달지 / 주문메뉴 + 수량 + 가격 / 합계만. 매장 정보 / 부가세 분리 / 결제수단 / 푸터 모두 제거.
//
// 1.0.38: 분리 결제 영수증은 헤더에 "(분리 결제 — 손님: <라벨>)" 한 줄 추가.
// 1.0.44: 상황별 헤더 + 배달 본문 큰 글씨 + 예약/포장 시각 출력.
//   - delivery: 주소(가로+세로 큰글씨) / 별칭 / 손님번호 / 도로거리 큰글씨
//   - reservation/takeout: 라벨 큰글씨
//   - regular: 기존 그대로
// 2026-05-29: 사장님 요청 — 시각(출발/예약시각/픽업시각) 폰트는 본문(wide) 의
//   절반(normal) 으로. 라벨/주소/도로 등 식별 본문은 wide 유지.
// ESC/POS 명령(ESC ! n, ESC a n) 을 텍스트 string 안에 inline. EUC-KR 인코더가
// ASCII 범위 그대로 보존 → 한글만 변환되고 명령은 그대로 프린터로 전달.
//
// receipt: {
//   tableId, tableLabel,
//   items: [{ name, qty, price, largeQty, sizeUpcharge, optionLabels, memo }],
//   total, deliveryAddress, printedAt,
//   isSplit?: boolean,           // 분리 결제 영수증 여부
//   sourceTableId?: string,
//   sourceTableLabel?: string,
//   orderType?: 'regular'|'delivery'|'reservation'|'takeout',  // 1.0.44
//   customerPhone?: string,        // 1.0.44 — 배달용
//   customerAlias?: string,        // 1.0.44 — 배달용
//   drivingDistanceM?: number,     // 1.0.44 — 배달용 (m)
//   drivingDurationSec?: number,   // 1.0.44 — 배달용 (sec)
//   scheduledTime?: string,        // 1.0.44 — "420" / "1220"
//   scheduledTimeIsPM?: boolean,   // 1.0.44
//   customerRequest?: string,      // 단골요청 — 주방·라이더가 미리 준비 (예: "다진고추, 김치많이")
//   bankHeader?: boolean,          // 2026-08-06 — 이 출력만 계좌 블록 강제 ON/OFF. 미지정 시 매장 설정값.
// }
export function buildReceiptText(receipt) {
  const lines = [];
  const r = receipt || {};
  const orderType = r.orderType || (r.deliveryAddress ? 'delivery' : 'regular');

  // ───── 헤더 (상황별 라벨 + 가로 두 배 가운데 정렬) ─────
  // 1.0.45: sizeBig(2x×2x) → sizeWide(2x×1x) 통일. 사장님 피드백 "2배 너무 큼".
  // ESC/POS 표준상 1.5배 직접 옵션 없음 — 가로만 두 배 (세로 기본) 가 가장 가까움.
  lines.push(divider('='));
  lines.push(bigCenter(headerTitle(orderType), 'wide'));
  lines.push(centerText(formatDateTime(r.printedAt || Date.now())));

  // ───── 테이블 / 배달지 ─────
  lines.push(divider('-'));
  // 1.0.39: 매장 서멀 프린터(EUC-KR 코드 페이지) 호환 — 이모지/유니코드 보충문자 제거.
  const tableLabel = r.tableLabel || r.tableId;
  if (tableLabel) {
    lines.push(`■ 테이블: ${tableLabel}`);
  }
  // 1.0.38: 분리 결제 — 손님 자리 명시.
  if (r.isSplit && (r.sourceTableLabel || r.sourceTableId)) {
    const src = r.sourceTableLabel || r.sourceTableId;
    lines.push(`● 분리 결제 손님: ${src}`);
  }

  // 1.0.44: orderType 별 본문 메타.
  // 1.0.45: 배달지/별칭도 sizeWide 로 통일 — 본문 모두 가로 두 배 한 크기로 정렬.
  // 2026-05-21: 사장님 정책 — "배달지 ..." prefix 와 별칭/손님 세 줄 출력 제거.
  //   별칭 > 전번 > 주소 중 가장 우선되는 *한 줄* 만 prefix 없이 큰 글씨. 라이더/사장님
  //   식별엔 단일 라벨로 충분. 도로/출발/요청 메타는 그대로 유지.
  if (orderType === 'delivery') {
    const label = resolveDeliveryLabel(r);
    if (label) {
      lines.push(bigLeft(label, 'wide'));
    }
    if (typeof r.drivingDistanceM === 'number') {
      const km = formatDrivingShort(r.drivingDistanceM);
      const dur = formatDurationShort(r.drivingDurationSec);
      const txt = dur ? `도로   ${km} (${dur})` : `도로   ${km}`;
      lines.push(bigLeft(txt, 'wide'));
    }
    const schedDelivery = formatScheduledTime(r.scheduledTime, r.scheduledTimeIsPM);
    if (schedDelivery) {
      // 2026-05-29: 사장님 요청 — 시간 폰트 절반. wide(가로2배) → normal(1배).
      lines.push(bigLeft(`출발   ${schedDelivery}`, 'normal'));
    }
    if (r.customerRequest) {
      lines.push(bigLeft(`요청   ${r.customerRequest}`, 'wide'));
    }
  } else if (orderType === 'reservation') {
    // 2026-05-21: 전화 주문 라벨 정책 통일 — 별칭/전번 prefix 없이 한 줄 (있을 때만).
    const label = resolveDeliveryLabel(r);
    if (label) lines.push(bigLeft(label, 'wide'));
    const sched = formatScheduledTime(r.scheduledTime, r.scheduledTimeIsPM);
    if (sched) {
      // 2026-05-29: 사장님 요청 — 시간 폰트 절반. wide → normal.
      lines.push(bigLeft(`예약시각 ${sched}`, 'normal'));
    }
  } else if (orderType === 'takeout') {
    const label = resolveDeliveryLabel(r);
    if (label) lines.push(bigLeft(label, 'wide'));
    const sched = formatScheduledTime(r.scheduledTime, r.scheduledTimeIsPM);
    if (sched) {
      // 2026-05-29: 사장님 요청 — 시간 폰트 절반. wide → normal.
      lines.push(bigLeft(`픽업시각 ${sched}`, 'normal'));
    }
  } else if (r.deliveryAddress) {
    // regular 인데 deliveryAddress 가 있으면 (호환 — orderType 미지정 옛 호출부)
    lines.push(`■ 배달: ${r.deliveryAddress}`);
  }

  // ───── 메뉴 라인 — 옵션 / 메모 / 큰사이즈 분리 ─────
  lines.push(divider('-'));
  for (const item of r.items || []) {
    const name = item.name || '?';
    const qty = item.qty || 0;
    const lq = item.largeQty || 0;
    const nq = qty - lq;
    const price = Number(item.price) || 0;
    const sizeUp = Number(item.sizeUpcharge) || 0;

    if (lq > 0 && nq > 0) {
      lines.push(pad2col(`${name} 보통 x${nq}`, formatWon(price * nq)));
      lines.push(pad2col(`${name} 대 x${lq}`, formatWon((price + sizeUp) * lq)));
    } else if (lq > 0) {
      lines.push(pad2col(`${name} 대 x${lq}`, formatWon((price + sizeUp) * lq)));
    } else {
      lines.push(pad2col(`${name} x${qty}`, formatWon(price * qty)));
    }

    // 1.0.39: 옵션 bullet ▸ → '-' (ASCII), 가운데점 · → ',' . 메모 📝 → '메모:'
    const opts = item.optionLabels || [];
    if (opts.length > 0) {
      lines.push('  - ' + opts.join(', '));
    }
    if (item.memo && String(item.memo).trim()) {
      lines.push('  메모: ' + String(item.memo).trim());
    }
  }

  // ───── 합계 ─────
  lines.push(divider('-'));
  lines.push(pad2col('합계', formatWon(Number(r.total) || 0)));
  lines.push(divider('='));

  return withTopHeader(lines.join('\n'), { bankHeader: r.bankHeader });
}

// 명령 바이트 + 텍스트 합친 raw bytes. 출력 라이브러리에 텍스트만 넘기는 게 더 흔하지만
// raw mode (바이트 직접 전송) 가 필요한 환경 대비. 텍스트는 EUC-KR 변환은 출력 단계 책임.
//
// textEncoder: function(string) → Uint8Array.
//   - 미지정 시 UTF-8 (TextEncoder) — 영수증에 한글 있으면 깨질 수 있음.
//   - 사용자 환경에 맞는 EUC-KR 인코더 (iconv-lite 등) 가 있으면 주입.
export function buildReceiptBytes(receipt, textEncoder) {
  const text = buildReceiptText(receipt);
  const encode = textEncoder || ((s) => new TextEncoder().encode(s));

  const parts = [
    CMD.init,
    CMD.alignLeft,
    encode(text + '\n'),
    CMD.feed,
    CMD.feed,
    CMD.feed,
    CMD.cutPartial,
  ];

  // 모든 Uint8Array concat
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// 주문지 빌더 — 주방/배달용 슬립. 결제 정보 없음, 항목만 출력.
//
// slip: {
//   tableLabel: string,
//   isDelivery: boolean,
//   deliveryAddress?: string,
//   customerAlias?: string,   // 사장님 정책: 별칭 > 전번 > 주소. 라이더/주방이 손님 식별
//   customerPhone?: string,
//   rows: Array<{ item, kind: 'added'|'changed'|'unchanged'|'removed', previousQty? }>,
//   kinds: Array<'added'|'changed'|'all'|'delivery'>,
//   slippedAt?: number,
// }
// item 에 optionLabels?: string[] 를 미리 resolve 해서 전달해야 함 (hook 못 씀).
export function buildOrderSlipText(slip) {
  const {
    tableLabel = '',
    isDelivery,
    deliveryAddress,
    customerAlias,
    customerPhone,
    rows = [],
    kinds = ['all'],
    slippedAt,
    bankHeader,
  } = slip;
  const kindSet = new Set(kinds);
  const showAll = kindSet.has('all');
  const showDelivery = kindSet.has('delivery') && isDelivery && !!deliveryAddress;

  const toPrint = rows.filter((r) => {
    if (r.kind === 'removed') return false;
    if (showAll) return true;
    return (kindSet.has('added') && r.kind === 'added') ||
           (kindSet.has('changed') && r.kind === 'changed');
  });
  const removed = (showAll || kindSet.has('changed'))
    ? rows.filter((r) => r.kind === 'removed')
    : [];

  const lines = [];
  lines.push(divider('='));
  lines.push(centerText('주  문  지'));
  lines.push(centerText(formatDateTime(slippedAt || Date.now())));
  lines.push(centerText(`[ ${tableLabel} ]`));

  if (showDelivery) {
    lines.push(divider('-'));
    // 2026-05-21: 사장님 정책 — "배달지: ..." prefix 와 별칭/손님 세 줄 출력 제거.
    //   별칭 > 전번 > 주소 중 가장 우선되는 *한 줄* 만 prefix 없이 출력. 단일 라벨로 충분.
    const label = resolveDeliveryLabel({
      customerAlias,
      customerPhone,
      deliveryAddress,
    });
    if (label) lines.push(label);
  }

  lines.push(divider('-'));

  if (toPrint.length === 0 && removed.length === 0) {
    lines.push(centerText('(출력 항목 없음)'));
  } else {
    // 1.0.30: 모든 row 가 added 면 (= 신규 주문) [추가] 라벨 생략 — 깔끔.
    // 변경/추가 섞인 경우만 라벨로 구분.
    const isAllAdded = !showAll && toPrint.length > 0 && toPrint.every((r) => r.kind === 'added');
    for (const r of toPrint) {
      const item = r.item;
      const kindLabel = (showAll || isAllAdded)
        ? ''
        : (r.kind === 'added' ? '[추가] ' : '[변경] ');
      const lq = item.largeQty || 0;
      const nq = item.qty - lq;

      if (lq === 0) {
        lines.push(pad2col(kindLabel + item.name, `×${item.qty}`));
      } else {
        if (nq > 0) lines.push(pad2col(kindLabel + item.name + ' 보통', `×${nq}`));
        if (lq > 0) lines.push(pad2col(`  ${item.name} 대`, `×${lq}`));
      }
      // 1.0.39: 이모지/유니코드 보충문자 제거 (EUC-KR 프린터 호환)
      const optLabels = item.optionLabels || [];
      if (optLabels.length > 0) lines.push('  - ' + optLabels.join(', '));
      if (item.memo) lines.push('  메모: ' + item.memo);
      if (!showAll && r.kind === 'changed' && r.previousQty != null) {
        lines.push(`  (이전 ×${r.previousQty})`);
      }
    }
    for (const r of removed) {
      lines.push(pad2col('[취소] ' + r.item.name, `×${r.previousQty ?? r.item.qty}`));
    }
  }

  lines.push(divider('='));
  return withTopHeader(lines.join('\n'), { bankHeader });
}

// 배달 회수 목록 — 그릇 회수용 출력물.
// 사장님이 출력물 들고 다니며 회수. 멀리부터 들어와 가까이로 — 라이더 동선 효율.
//
// result 는 utils/deliveryReturns.js 의 computeDeliveryReturns() 반환값.
//   { ranked: [{ rank, label, address, alias, distanceM, menuSummary, totalDishes }], unknown: [...], sortMode }
//
// 형식:
//   ═══════════════
//      배 달 회 수
//   2026-05-15 16:30
//   원거리 순  ⏶  N건
//   ───────────────
//   [ 주소불명 (3) ]
//    0. 하나자원
//       칼국수 1
//    0. 불고기
//       팥죽 2
//   ───────────────
//   1. 진실보석   2.3km
//      칼국수 2, 팥죽 1
//      총 3 그릇
//   2. 하나헤어   1.8km
//      만두 1
//      총 1 그릇
//   ═══════════════
export function buildDeliveryReturnText(result, opts = {}) {
  const r = result || {};
  const ranked = Array.isArray(r.ranked) ? r.ranked : [];
  const unknown = Array.isArray(r.unknown) ? r.unknown : [];
  const sortMode = r.sortMode || 'far';
  const printedAt = opts.printedAt || Date.now();

  const lines = [];
  lines.push(divider('='));
  lines.push(bigCenter('배 달 회 수', 'wide'));
  lines.push(centerText(formatDateTime(printedAt)));
  const orderLabel = sortMode === 'near' ? '근거리 순' : '원거리 순';
  lines.push(centerText(`${orderLabel}  ·  ${ranked.length + unknown.length}건`));
  lines.push(divider('='));

  if (unknown.length > 0) {
    lines.push(`[ 주소불명 ${unknown.length}건 ]`);
    for (const u of unknown) {
      lines.push(` 0. ${u.label}`);
      if (u.menuSummary && u.menuSummary.length > 0) {
        lines.push(`    ${u.menuSummary.map((m) => `${m.name} ${m.qty}`).join(', ')}`);
      }
      if (typeof u.totalDishes === 'number' && u.totalDishes > 1) {
        lines.push(`    총 ${u.totalDishes} 그릇`);
      }
    }
    lines.push(divider('-'));
  }

  if (ranked.length === 0 && unknown.length === 0) {
    lines.push(centerText('회수할 그릇이 없습니다.'));
    lines.push(divider('='));
    return withTopHeader(lines.join('\n'), { bankHeader: opts.bankHeader });
  }

  for (const it of ranked) {
    const dist = typeof it.distanceM === 'number' ? `  ${formatDistance(it.distanceM)}` : '';
    lines.push(`${it.rank}. ${it.label}${dist}`);
    if (it.menuSummary && it.menuSummary.length > 0) {
      lines.push(`   ${it.menuSummary.map((m) => `${m.name} ${m.qty}`).join(', ')}`);
    }
    if (typeof it.totalDishes === 'number') {
      lines.push(`   총 ${it.totalDishes} 그릇`);
    }
  }

  lines.push(divider('='));
  return withTopHeader(lines.join('\n'), { bankHeader: opts.bankHeader });
}

// 거리 m → "1.2km" / "250m" 짧은 표기.
function formatDistance(distanceM) {
  const m = Number(distanceM) || 0;
  if (m < 1000) return `${m}m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

// 미리 만들어진 텍스트를 ESC/POS bytes 로 래핑. buildOrderSlipText 결과 등에 사용.
export function buildTextBytes(text, textEncoder) {
  const encode = textEncoder || ((s) => new TextEncoder().encode(s));
  const parts = [
    CMD.init,
    CMD.alignLeft,
    encode(text + '\n'),
    CMD.feed,
    CMD.feed,
    CMD.feed,
    CMD.cutPartial,
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

// ──────── 헬퍼 ──────────────────────────────────────────────

function centerText(s, width = COL_WIDTH) {
  const w = visualWidth(s);
  if (w >= width) return String(s);
  const pad = Math.floor((width - w) / 2);
  return ' '.repeat(pad) + s;
}

function formatWon(n) {
  return `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
