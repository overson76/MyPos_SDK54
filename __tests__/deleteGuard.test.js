import {
  checkBulkDelete,
  shouldLogBlock,
  _resetBlockLogForTest,
  MAX_ALWAYS_ALLOWED,
  WIPE_RATIO,
} from '../utils/deleteGuard';

// 2026-08-19 사고: "포스 현황이 다 날아갔다".
// 클라이언트 한 대의 로컬 state 이상이 서버 문서를 전부 지우고 전 기기로 전파됐다.
// 정책: 의심스러우면 지우지 않는다 (남는 건 다시 치우면 되지만, 사라진 건 못 되돌린다).
describe('checkBulkDelete', () => {
  const g = (deleteCount, syncedCount) =>
    checkBulkDelete({ label: '주문', deleteCount, syncedCount });

  it('3건 이하는 항상 통과 — 테이블 하나씩 치우는 정상 영업', () => {
    expect(g(0, 10).allowed).toBe(true);
    expect(g(1, 10).allowed).toBe(true);
    expect(g(3, 3).allowed).toBe(true); // 3개뿐인데 3개 다 치워도 통과
    expect(MAX_ALWAYS_ALLOWED).toBe(3);
  });

  it('🛑 전멸 차단 — 전체의 60% 이상을 한 번에 지우려 하면 막는다', () => {
    expect(g(8, 8).allowed).toBe(false); // 이번 사고 모양: 전부
    expect(g(10, 10).allowed).toBe(false);
    expect(g(6, 10).allowed).toBe(false); // 정확히 60%
    expect(g(600, 1000).allowed).toBe(false);
    expect(WIPE_RATIO).toBe(0.6);
  });

  it('정당한 묶음 삭제는 통과 — 배달 자동정리 등', () => {
    expect(g(5, 20).allowed).toBe(true); // 25%
    expect(g(4, 10).allowed).toBe(true); // 40%
    expect(g(5, 10).allowed).toBe(true); // 50% — 아직 전멸 아님
  });

  it('차단 사유에 규모가 사람이 읽을 수 있게 담긴다', () => {
    const r = g(8, 8);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('주문');
    expect(r.reason).toContain('8/8');
    expect(r.reason).toContain('100%');
  });

  it('synced 가 비어있으면(기준 없음) 막지 않는다 — 삭제할 것도 없음', () => {
    expect(g(0, 0).allowed).toBe(true);
  });

  it('이상값(음수/undefined)에도 통과 — 가드가 정상 흐름을 깨지 않게', () => {
    expect(checkBulkDelete({ label: 'x' }).allowed).toBe(true);
    expect(g(-1, 10).allowed).toBe(true);
  });
});

describe('shouldLogBlock', () => {
  beforeEach(() => _resetBlockLogForTest());

  it('첫 차단은 로그, 1분 안의 반복은 억제', () => {
    const t = 1_000_000;
    expect(shouldLogBlock('orders', t)).toBe(true);
    expect(shouldLogBlock('orders', t + 1000)).toBe(false);
    expect(shouldLogBlock('orders', t + 59_999)).toBe(false);
    expect(shouldLogBlock('orders', t + 60_000)).toBe(true);
  });

  it('라벨별로 따로 센다', () => {
    const t = 1_000_000;
    expect(shouldLogBlock('orders', t)).toBe(true);
    expect(shouldLogBlock('history', t)).toBe(true); // 다른 라벨은 막히지 않음
  });
});
