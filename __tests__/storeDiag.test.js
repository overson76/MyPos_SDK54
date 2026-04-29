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
