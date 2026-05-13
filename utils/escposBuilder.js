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

function sizeCmd(size) {
  if (size === 'big') return SIZE_BIG;
  if (size === 'wide') return SIZE_WIDE;
  return SIZE_NORMAL;
}

// 큰 글씨 + 가운데 정렬 — 프린터가 자동 정렬 (32 vs 16 폭 계산 안 해도 됨).
function bigCenter(text, size = 'big') {
  return ALIGN_CENTER + sizeCmd(size) + text + SIZE_NORMAL + ALIGN_LEFT;
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
function formatDrivingShort(m) {
  if (typeof m !== 'number' || !isFinite(m) || m < 0) return '';
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
//   - delivery: 주소(가로+세로 큰글씨) / 별칭 / 손님번호 / 도로거리 / 배달요청 시각 모두 큰글씨
//   - reservation: 예약시각 큰글씨
//   - takeout: 픽업시각 큰글씨
//   - regular: 기존 그대로
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
// }
export function buildReceiptText(receipt) {
  const lines = [];
  const r = receipt || {};
  const orderType = r.orderType || (r.deliveryAddress ? 'delivery' : 'regular');

  // ───── 헤더 (상황별 라벨 + 큰 글씨 가운데 정렬) ─────
  lines.push(divider('='));
  lines.push(bigCenter(headerTitle(orderType), 'big'));
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
  if (orderType === 'delivery') {
    if (r.deliveryAddress) {
      lines.push(bigLeft(`배달지 ${r.deliveryAddress}`, 'big'));
    }
    if (r.customerAlias) {
      lines.push(bigLeft(`별칭   ${r.customerAlias}`, 'big'));
    }
    if (r.customerPhone) {
      lines.push(bigLeft(`손님   ${formatPhone(r.customerPhone)}`, 'wide'));
    }
    if (typeof r.drivingDistanceM === 'number') {
      const km = formatDrivingShort(r.drivingDistanceM);
      const dur = formatDurationShort(r.drivingDurationSec);
      const txt = dur ? `도로   ${km} (${dur})` : `도로   ${km}`;
      lines.push(bigLeft(txt, 'wide'));
    }
    const schedDelivery = formatScheduledTime(r.scheduledTime, r.scheduledTimeIsPM);
    if (schedDelivery) {
      lines.push(bigLeft(`출발   ${schedDelivery}`, 'wide'));
    }
  } else if (orderType === 'reservation') {
    const sched = formatScheduledTime(r.scheduledTime, r.scheduledTimeIsPM);
    if (sched) {
      lines.push(bigLeft(`예약시각 ${sched}`, 'wide'));
    }
  } else if (orderType === 'takeout') {
    const sched = formatScheduledTime(r.scheduledTime, r.scheduledTimeIsPM);
    if (sched) {
      lines.push(bigLeft(`픽업시각 ${sched}`, 'wide'));
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

  return lines.join('\n');
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
//   rows: Array<{ item, kind: 'added'|'changed'|'unchanged'|'removed', previousQty? }>,
//   kinds: Array<'added'|'changed'|'all'|'delivery'>,
//   slippedAt?: number,
// }
// item 에 optionLabels?: string[] 를 미리 resolve 해서 전달해야 함 (hook 못 씀).
export function buildOrderSlipText(slip) {
  const { tableLabel = '', isDelivery, deliveryAddress, rows = [], kinds = ['all'], slippedAt } = slip;
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
    lines.push('배달지: ' + deliveryAddress);
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
  return lines.join('\n');
}

// 미리 만들어진 텍스트를 ESC/POS bytes 로 래핑. buildOrderSlipText 결과 등에 사용.
export function buildTextBytes(text, textEncoder) {
  const encode = textEncoder || ((s) => new TextEncoder().encode(s));
  const parts = [CMD.init, CMD.alignLeft, encode(text + '\n'), CMD.feed, CMD.feed, CMD.feed, CMD.cutPartial];
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
