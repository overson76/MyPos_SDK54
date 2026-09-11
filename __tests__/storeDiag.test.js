import { computeMemberDiagnosis, shortId } from '../utils/storeDiag';

describe('computeMemberDiagnosis', () => {
  const ownerUid = 'owner-uid-1234';
  const staffUid = 'staff-uid-5678';
  const otherUid = 'other-uid-9999';
  const storeInfo = { storeId: 'store-doc-id', ownerId: ownerUid };
  const ownerMember = { uid: ownerUid, role: 'owner', displayName: '사장' };
  const staffMember = { uid: staffUid, role: 'staff', displayName: '직원A' };

  test('빈 members 배열 → pending', () => {
    const r = computeMemberDiagnosis([], storeInfo, ownerUid);
    expect(r.level).toBe('pending');
  });

  test('null members → pending', () => {
    const r = computeMemberDiagnosis(null, storeInfo, ownerUid);
    expect(r.level).toBe('pending');
  });

  test('owner 0명 → error', () => {
    const r = computeMemberDiagnosis([staffMember], storeInfo, staffUid);
    expect(r.level).toBe('error');
    expect(r.message).toMatch(/owner 권한 멤버가 0명/);
  });

  test('owner 2명 → warn', () => {
    const second = { uid: 'second-owner', role: 'owner', displayName: '대표2' };
    const r = computeMemberDiagnosis([ownerMember, second], storeInfo, ownerUid);
    expect(r.level).toBe('warn');
    expect(r.message).toMatch(/owner 권한 멤버가 2명/);
  });

  test('owner uid 와 stores.ownerId 어긋남 → warn (어제 사고 시나리오)', () => {
    const mismatchInfo = { storeId: 'sid', ownerId: 'WRONG-OWNER-ID' };
    const r = computeMemberDiagnosis([ownerMember], mismatchInfo, ownerUid);
    expect(r.level).toBe('warn');
    expect(r.message).toMatch(/ownerId.*어긋남/);
  });

  test('myUid 없으면 → pending', () => {
    const r = computeMemberDiagnosis([ownerMember, staffMember], storeInfo, null);
    expect(r.level).toBe('pending');
  });

  test('myUid === owner uid → ok (대표)', () => {
    const r = computeMemberDiagnosis([ownerMember, staffMember], storeInfo, ownerUid);
    expect(r.level).toBe('ok');
    expect(r.message).toMatch(/대표/);
  });

  test('myUid === staff member → ok (직원)', () => {
    const r = computeMemberDiagnosis([ownerMember, staffMember], storeInfo, staffUid);
    expect(r.level).toBe('ok');
    expect(r.message).toMatch(/직원/);
  });

  test('myUid 가 members 에 없음 → error (강퇴/uid 재발급)', () => {
    const r = computeMemberDiagnosis([ownerMember, staffMember], storeInfo, otherUid);
    expect(r.level).toBe('error');
    expect(r.message).toMatch(/멤버 목록에 없음/);
  });

  test('storeInfo.ownerId 가 비어있어도(옛 데이터) owner 멤버만 있으면 ok', () => {
    const noOwnerIdInfo = { storeId: 'sid' };
    const r = computeMemberDiagnosis([ownerMember], noOwnerIdInfo, ownerUid);
    // ownerId 비교 단계는 skip → owner.uid === myUid 매칭으로 ok
    expect(r.level).toBe('ok');
  });
});

describe('shortId', () => {
  test('null/undefined → "-"', () => {
    expect(shortId(null)).toBe('-');
    expect(shortId(undefined)).toBe('-');
    expect(shortId('')).toBe('-');
  });

  test('숫자/객체 → "-"', () => {
    expect(shortId(123)).toBe('-');
    expect(shortId({})).toBe('-');
  });

  test('12자 이하 → 그대로', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('123456789012')).toBe('123456789012');
  });

  test('12자 초과 → "..." + 끝 12자', () => {
    const long = 'firebase-anonymous-uid-XYZ-123456';
    expect(shortId(long)).toBe('...' + long.slice(-12));
    expect(shortId(long).length).toBe(15); // 3 dots + 12 chars
  });
});

// 2026-09-11 유령 매장 — 매장 문서가 삭제됐는데 하위 컬렉션이 살아남아
// 기기가 계속 정상 동작하던 사고. 멤버 진단이 전부 '정상' 으로 나오는 게
// 이 사고를 가려준 핵심이었으므로, 어떤 판정보다 먼저 나와야 한다.
describe('computeMemberDiagnosis — 유령 매장 (storeDocMissing)', () => {
  const owner = { uid: 'u-owner', role: 'owner' };
  const staff = { uid: 'u-staff', role: 'staff' };

  test('멤버가 완벽히 정상이어도 유령 매장이면 error 로 덮는다', () => {
    const r = computeMemberDiagnosis(
      [owner],
      { storeId: 's1', ownerId: 'u-owner', storeDocMissing: true },
      'u-owner'
    );
    expect(r.level).toBe('error');
    expect(r.message).toContain('서버에 없습니다');
  });

  test('직원 기기에서도 동일하게 error', () => {
    const r = computeMemberDiagnosis(
      [owner, staff],
      { storeId: 's1', ownerId: 'u-owner', storeDocMissing: true },
      'u-staff'
    );
    expect(r.level).toBe('error');
  });

  test('멤버 목록이 비어 있어도 pending 이 아니라 유령 판정이 우선', () => {
    const r = computeMemberDiagnosis([], { storeDocMissing: true }, 'u-owner');
    expect(r.level).toBe('error');
  });

  test('합쳐지지 않는다는 사실과 복구 방법을 문구에 담는다', () => {
    const r = computeMemberDiagnosis([owner], { storeDocMissing: true }, 'u-owner');
    expect(r.message).toContain('합쳐지지');
    expect(r.message).toContain('다시 가입');
  });

  test('storeDocMissing 이 false/undefined 면 기존 판정 그대로', () => {
    const ok = computeMemberDiagnosis(
      [owner],
      { storeId: 's1', ownerId: 'u-owner', storeDocMissing: false },
      'u-owner'
    );
    expect(ok.level).toBe('ok');
    const ok2 = computeMemberDiagnosis(
      [owner],
      { storeId: 's1', ownerId: 'u-owner' },
      'u-owner'
    );
    expect(ok2.level).toBe('ok');
  });
});

// 2026-09-11 접근 권한 상실 — 익명 uid 가 멤버에서 빠지면 members 읽기 자체가 거부된다.
// 그 결과 멤버 목록이 영원히 비어 'pending'(불러오는 중) 에 머물렀다. 실제로는
// 그 기기의 주문·매출이 서버에 한 건도 안 닿는 완전 단절 상태다.
describe('computeMemberDiagnosis — 접근 권한 상실 (accessDenied)', () => {
  const owner = { uid: 'u-owner', role: 'owner' };

  test('멤버 목록이 비어도 pending 이 아니라 error 로 명확히 말한다', () => {
    const r = computeMemberDiagnosis([], { storeId: 's1', accessDenied: true }, 'u-me');
    expect(r.level).toBe('error');
    expect(r.message).toContain('접근 권한');
  });

  test('저장이 안 된다는 사실과 복구 방법을 문구에 담는다', () => {
    const r = computeMemberDiagnosis([], { accessDenied: true }, 'u-me');
    expect(r.message).toContain('저장되지 않');
    expect(r.message).toContain('다시 가입');
  });

  test('유령 매장이 접근 거부보다 우선 (더 근본적인 원인)', () => {
    const r = computeMemberDiagnosis(
      [],
      { storeDocMissing: true, accessDenied: true },
      'u-me'
    );
    expect(r.message).toContain('서버에 없습니다');
  });

  test('accessDenied 가 false 면 기존 판정 그대로', () => {
    const r = computeMemberDiagnosis(
      [owner],
      { storeId: 's1', ownerId: 'u-owner', accessDenied: false },
      'u-owner'
    );
    expect(r.level).toBe('ok');
  });
});
