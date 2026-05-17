// 매장 매출 history 기반 로컬 메뉴 추천. 외부 API 사용 X.
//
// 점수 = (시간대 매칭 빈도 × W_TIME)
//      + (단골 손님 매칭 빈도 × W_REGULAR)
//      + (전체 인기도 × W_POPULAR)
//
// 가중치 의도:
//   - 시간대 매칭(±2시간) > 일반 인기도: "점심엔 칼국수, 저녁엔 부대찌개"
//   - 단골 매칭 > 시간대: 자주 오는 손님 메뉴 우대
//
// 단골 매칭 정책:
//   - customerAddressKey: 같은 주소만 매칭 (옛 동작)
//   - customerPhone + addressBook: 같은 phone 으로 묶인 모든 주소가 단골 set
//     → 본점/지점/회사/집 등 한 손님이 여러 주소로 시켜도 동일 손님 인식
//   - 둘 다 주면 union (주소 단일 + phone 그룹 합쳐서 매칭)
//
// 매칭 정책:
//   - history.items 는 name 만 보존됨 (id 가 아닌 name 기준 매칭)
//   - 카탈로그에서 이름이 바뀐 옛 메뉴는 추천에서 제외 — 의도된 동작
//   - reverted entry / 30일 초과 entry 자동 제외

import { normalizeAddressKey } from './orderHelpers';
import { listAddressBookEntries, getAllPhoneDigits } from './addressBookLookup';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_DAYS = 30;
const DEFAULT_TIME_WINDOW_HOURS = 2;
const DEFAULT_TOP_N = 12;

const W_POPULAR = 1;
const W_TIME = 3;
const W_REGULAR = 5;

// 카테고리 탭에 표시할 이름. OrderScreen 분기 시 같은 값 사용.
export const RECOMMENDATION_CATEGORY = '🌟 추천';

function qtySum(item) {
  return Math.max(0, (item?.qty || 0) + (item?.largeQty || 0));
}

function hourOf(ts) {
  return new Date(ts).getHours();
}

// 24시간 순환 차이 — 23시와 1시는 2시간 차이로 계산.
function isWithinTimeWindow(itemHour, nowHour, windowHours) {
  const linear = Math.abs(itemHour - nowHour);
  const circular = Math.min(linear, 24 - linear);
  return circular <= windowHours;
}

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// 단골 매칭 후보 키 set 빌드.
//   - customerAddressKey 있으면 그 정규화 키 포함
//   - customerPhone + addressBook 있으면 같은 phone 의 모든 entry 의
//     정규화 key 도 포함 → 한 손님이 여러 주소로 시켜도 단골 인식
//   - 둘 다 비면 null (단골 매칭 비활성)
export function buildRegularKeySet(customerAddressKey, customerPhone, addressBook) {
  const set = new Set();
  if (customerAddressKey) {
    const k = normalizeAddressKey(customerAddressKey);
    if (k) set.add(k);
  }
  const target = digitsOnly(customerPhone);
  if (target && target.length >= 4) {
    for (const e of listAddressBookEntries(addressBook)) {
      // 2026-05-16: phones array 다중 phone 모두 매칭 + 옛 phone 단일 fallback.
      const allDigits = getAllPhoneDigits(e);
      if (allDigits.includes(target)) {
        const k = normalizeAddressKey(e?.key || e?.label || '');
        if (k) set.add(k);
      }
    }
  }
  return set.size > 0 ? set : null;
}

export function computeRecommendations({
  history,
  menus,
  now = Date.now(),
  customerAddressKey = null,
  customerPhone = null,
  addressBook = null,
  topN = DEFAULT_TOP_N,
  recentDays = DEFAULT_RECENT_DAYS,
  timeWindowHours = DEFAULT_TIME_WINDOW_HOURS,
} = {}) {
  if (!Array.isArray(history) || !Array.isArray(menus) || menus.length === 0) {
    return [];
  }

  const recentMs = recentDays * DAY_MS;
  const nowHour = hourOf(now);
  const regularKeys = buildRegularKeySet(
    customerAddressKey,
    customerPhone,
    addressBook
  );

  const scoresByName = new Map();

  for (const entry of history) {
    if (!entry || entry.reverted) continue;
    const ts = entry.clearedAt;
    if (typeof ts !== 'number') continue;
    if (now - ts > recentMs) continue;
    if (now - ts < 0) continue;

    const items = entry.items || [];
    if (items.length === 0) continue;

    const inTimeWindow = isWithinTimeWindow(
      hourOf(ts),
      nowHour,
      timeWindowHours
    );
    const entryKey = normalizeAddressKey(entry.deliveryAddress || '');
    const isRegularMatch = !!(regularKeys && entryKey && regularKeys.has(entryKey));

    for (const item of items) {
      const name = item?.name;
      if (!name) continue;
      const qty = qtySum(item);
      if (qty <= 0) continue;

      let score = qty * W_POPULAR;
      if (inTimeWindow) score += qty * W_TIME;
      if (isRegularMatch) score += qty * W_REGULAR;

      scoresByName.set(name, (scoresByName.get(name) || 0) + score);
    }
  }

  return menus
    .map((m) => ({
      id: m.id,
      name: m.name,
      score: scoresByName.get(m.name) || 0,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// 추천 결과를 OrderScreen 의 6×4 격자 형태로 변환.
// 초과분은 잘림, 부족분은 null 로 채움.
export function recommendationsToGrid(recommendations, cols = 6, rows = 4) {
  const total = cols * rows;
  const flat = new Array(total).fill(null);
  const list = Array.isArray(recommendations) ? recommendations : [];
  for (let i = 0; i < Math.min(list.length, total); i += 1) {
    flat[i] = list[i]?.id ?? null;
  }
  const grid = [];
  for (let r = 0; r < rows; r += 1) {
    grid.push(flat.slice(r * cols, (r + 1) * cols));
  }
  return grid;
}
