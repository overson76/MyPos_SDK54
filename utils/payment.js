// 결제수단 / 부가세(VAT) / CSV 익스포트 관련 순수 함수.
// UI 와 분리해서 Jest 단위 테스트로 견고성 확보.
//
// 한국 소형 매장 현실 기준:
//   - 결제수단 4종 (현금/카드/계좌이체/지역화폐) — 매장 매뉴 기본 충분.
//   - 부가세 10% — 일반과세자 기준. 간이과세자는 4%지만 표시 정책상 10% 가정.
//   - 가격은 부가세 "포함" 기본값 — 한국 소비자 가격은 부가세 포함 표시가 표준.

// 결제수단 코드 + 라벨. UI 에서 쓸 때 PAYMENT_METHOD_LIST 순서대로 표시.
export const PAYMENT_METHODS = {
  cash: '현금',
  card: '카드',
  transfer: '계좌이체',
  localCurrency: '지역화폐',
};

export const PAYMENT_METHOD_LIST = ['cash', 'card', 'transfer', 'localCurrency'];

// 옛 데이터 / 미선택 — '미분류' 로 집계. 매출 기록은 유지하지만 결제수단별 내역엔 별도 표시.
export const PAYMENT_METHOD_UNSPECIFIED = 'unspecified';

export function paymentMethodLabel(code) {
  if (!code || code === PAYMENT_METHOD_UNSPECIFIED) return '미분류';
  return PAYMENT_METHODS[code] || '미분류';
}

// 부가세 10% (일반과세자).
const VAT_RATE = 0.1;

// 가격이 "부가세 포함" 으로 입력됐다는 가정 하에, 부가세분 / 공급가액 분리.
// total = 공급가액 + 부가세 = 공급가액 × 1.1
//   → 공급가액 = total / 1.1
//   → 부가세 = total - 공급가액
// 정수 원 단위 반올림. 사장님 신고 시 정확한 합계가 중요하므로 반올림 정책 한 곳에서 통제.
export function splitVatIncluded(total) {
  const t = Number(total) || 0;
  const supply = Math.round(t / (1 + VAT_RATE));
  const vat = t - supply;
  return { total: t, supply, vat };
}

// 가격이 "부가세 별도" — total 에 부가세 더해야 실제 받을 금액.
export function addVatExcluded(supply) {
  const s = Number(supply) || 0;
  const vat = Math.round(s * VAT_RATE);
  return { supply: s, vat, total: s + vat };
}

// history 배열을 결제수단별 합계 객체로 집계.
// 반환: { cash: { count, total }, card: {...}, ..., unspecified: {...} }
// 옛 history (paymentMethod 없음) 는 unspecified 로 집계.
export function summarizeByPaymentMethod(history) {
  const out = {};
  for (const code of [...PAYMENT_METHOD_LIST, PAYMENT_METHOD_UNSPECIFIED]) {
    out[code] = { count: 0, total: 0 };
  }
  for (const entry of history || []) {
    const code = entry?.paymentMethod || PAYMENT_METHOD_UNSPECIFIED;
    const bucket = out[code] || out[PAYMENT_METHOD_UNSPECIFIED];
    bucket.count += 1;
    bucket.total += Number(entry?.total) || 0;
  }
  return out;
}

// history → CSV 문자열. 회계 사무소 송부용.
// 한 줄 = 한 history 항목. 한국어 헤더.
// 메뉴는 한 셀에 "치킨×2,콜라×1" 식으로 합쳐 표시 — 행 분리하면 거래 단위가 깨짐.
// 부가세 포함 가정 + 공급가액 / 부가세 분리 컬럼 동시 제공.
export function historyToCsv(history) {
  const headers = [
    '시점',
    '테이블',
    '메뉴',
    '결제수단',
    '결제상태',
    '배달주소',
    '합계',
    '공급가액',
    '부가세',
  ];

  const rows = [headers];

  for (const entry of history || []) {
    const when = entry.clearedAt
      ? formatCsvDateTime(entry.clearedAt)
      : '';
    const itemsText = (entry.items || [])
      .map((i) => `${i.name || '?'}×${i.qty || 0}`)
      .join(',');
    const { supply, vat } = splitVatIncluded(entry.total);

    rows.push([
      when,
      entry.tableId || '',
      itemsText,
      paymentMethodLabel(entry.paymentMethod),
      entry.paymentStatus === 'paid' ? '결제완료' : '미결제',
      entry.deliveryAddress || '',
      String(entry.total || 0),
      String(supply),
      String(vat),
    ]);
  }

  // CSV escape: 셀에 ',' 나 '"' 또는 '\n' 있으면 큰따옴표 감싸고 내부 큰따옴표 두 번.
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(cell) {
  const s = String(cell ?? '');
  if (/[,"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatCsvDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 일계 보고서: history 를 (메뉴별 / 시간대별 / 결제수단별) 로 한 번에 집계.
// 반환 shape:
//   { byMenu: [{ name, qty, total }], byHour: [{ hour, count, total }], byPayment: { cash: ..., ... } }
export function summarizeDaily(history) {
  const byMenuMap = new Map();
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, total: 0 }));

  for (const entry of history || []) {
    // 메뉴별
    for (const item of entry.items || []) {
      const name = item.name || '(이름 없음)';
      const cur = byMenuMap.get(name) || { name, qty: 0, total: 0 };
      const itemTotal =
        (item.price || 0) * (item.qty || 0) +
        (item.sizeUpcharge || 0) * (item.largeQty || 0);
      cur.qty += (item.qty || 0) + (item.largeQty || 0);
      cur.total += itemTotal;
      byMenuMap.set(name, cur);
    }
    // 시간대별
    if (entry.clearedAt) {
      const h = new Date(entry.clearedAt).getHours();
      if (h >= 0 && h < 24) {
        byHour[h].count += 1;
        byHour[h].total += Number(entry.total) || 0;
      }
    }
  }

  const byMenu = Array.from(byMenuMap.values()).sort((a, b) => b.total - a.total);
  const byPayment = summarizeByPaymentMethod(history);

  return { byMenu, byHour, byPayment };
}

// 월계 보고서 — 한 달 history 의 메뉴별/요일별/결제수단별 집계.
// summarizeDaily 와 같은 형태 + byHour 대신 byDayOfWeek (월~일).
// 반환:
//   {
//     byMenu: [{ name, qty, total }],
//     byDayOfWeek: [{ day: 0~6, label: '일'~'토', count, total }],
//     byPayment: { cash: ..., ... },
//     totalDays: 매출 발생한 영업일 수
//   }
//
// JS Date.getDay(): 0=일, 1=월, ..., 6=토. 사장님 친숙한 월~일 순서로 reorder 가능하지만
// 표준 Date 인덱스 그대로 두고 label 로 표시.
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function summarizeMonthly(history) {
  const byMenuMap = new Map();
  const byDayOfWeek = DAY_LABELS.map((label, day) => ({
    day,
    label,
    count: 0,
    total: 0,
  }));
  const dateSet = new Set(); // 영업일 카운트용 (yyyy-mm-dd)

  for (const entry of history || []) {
    // 메뉴별
    for (const item of entry.items || []) {
      const name = item.name || '(이름 없음)';
      const cur = byMenuMap.get(name) || { name, qty: 0, total: 0 };
      const itemTotal =
        (item.price || 0) * (item.qty || 0) +
        (item.sizeUpcharge || 0) * (item.largeQty || 0);
      cur.qty += (item.qty || 0) + (item.largeQty || 0);
      cur.total += itemTotal;
      byMenuMap.set(name, cur);
    }
    // 요일별 + 영업일
    if (entry.clearedAt) {
      const d = new Date(entry.clearedAt);
      const dow = d.getDay();
      byDayOfWeek[dow].count += 1;
      byDayOfWeek[dow].total += Number(entry.total) || 0;
      const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      dateSet.add(dateKey);
    }
  }

  const byMenu = Array.from(byMenuMap.values()).sort((a, b) => b.total - a.total);
  const byPayment = summarizeByPaymentMethod(history);

  return {
    byMenu,
    byDayOfWeek,
    byPayment,
    totalDays: dateSet.size,
  };
}
