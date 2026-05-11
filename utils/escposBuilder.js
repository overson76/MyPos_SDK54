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

// 영수증 본문 텍스트 빌드. 출력 라이브러리에 그대로 넘기거나, 또는 buildEscposBytes 가
// 명령 바이트와 합쳐 raw 출력.
//
// receipt: {
//   storeName, tableId, items: [{ name, qty, price, largeQty, sizeUpcharge }],
//   total, paymentMethod, paymentStatus, deliveryAddress, printedAt
// }
export function buildReceiptText(receipt) {
  const lines = [];
  const r = receipt || {};

  lines.push(divider('='));
  if (r.storeName) lines.push(centerText(r.storeName));
  lines.push(centerText(formatDateTime(r.printedAt || Date.now())));
  if (r.tableId) lines.push(centerText(`테이블: ${r.tableId}`));
  lines.push(divider('-'));

  for (const item of r.items || []) {
    const name = item.name || '?';
    const qty = item.qty || 0;
    const lineTotal = (item.price || 0) * qty + (item.sizeUpcharge || 0) * (item.largeQty || 0);
    lines.push(pad2col(`${name} x${qty}`, formatWon(lineTotal)));
    if ((item.largeQty || 0) > 0) {
      lines.push(`  └ 대 ${item.largeQty}개`);
    }
  }

  lines.push(divider('-'));

  // 부가세 분리 (10% 부가세 포함 가정 — utils/payment.js 와 동일 정책)
  const total = Number(r.total) || 0;
  const supply = Math.round(total / 1.1);
  const vat = total - supply;

  lines.push(pad2col('공급가액', formatWon(supply)));
  lines.push(pad2col('부가세 (10%)', formatWon(vat)));
  lines.push(pad2col('합계', formatWon(total)));
  lines.push('');
  lines.push(pad2col('결제수단', paymentMethodLabel(r.paymentMethod)));
  lines.push(pad2col('결제상태', r.paymentStatus === 'paid' ? '결제완료' : '미결제'));

  if (r.deliveryAddress) {
    lines.push('');
    lines.push('배달 주소');
    lines.push(r.deliveryAddress);
  }

  lines.push(divider('='));
  lines.push(centerText('감사합니다'));

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
      const optLabels = item.optionLabels || [];
      if (optLabels.length > 0) lines.push('  ▸ ' + optLabels.join(' · '));
      if (item.memo) lines.push('  📝 ' + item.memo);
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
