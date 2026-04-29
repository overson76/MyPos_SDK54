// 매장 멤버 / 본인 익명 uid / 매장 문서 일관성 진단.
// 어제 사고 회고: 사장님 폰 익명 uid 가 owner role 멤버 uid 와 어긋나서 joinRequests
// listener 가 0건 read → 가입 요청이 사장님 화면에 안 보임 → 새 매장 만들어 복구.
// 운영자가 Firebase 콘솔 안 보고도 화면에서 즉시 식별할 수 있도록 자동 진단.
//
// 인자:
//   members:   Firestore stores/{sid}/members 의 배열. 각 원소 { uid, role, displayName, joinedAt }
//   storeInfo: { storeId, ownerId, ... } — StoreContext 의 storeInfo
//   myUid:     getCurrentUid() 결과 (이 기기 익명 uid)
//
// 결과: { level, message }
//   level: 'ok' | 'warn' | 'error' | 'pending'
//   ok      → 정상 (대표 또는 직원 등록 확인)
//   warn    → 데이터 어긋남 (정리 권장 — 즉시 운영 영향은 없을 수 있음)
//   error   → 운영 차단 가능성 (재가입 또는 콘솔 확인 필요)
//   pending → 정보 부족 (로딩 중)
export function computeMemberDiagnosis(members, storeInfo, myUid) {
  if (!members || members.length === 0) {
    return { level: 'pending', message: '멤버 정보 불러오는 중...' };
  }
  const owners = members.filter((m) => m.role === 'owner');
  if (owners.length === 0) {
    return {
      level: 'error',
      message:
        'owner 권한 멤버가 0명 — 데이터 손상 가능. Firebase 콘솔 점검 필요.',
    };
  }
  if (owners.length > 1) {
    return {
      level: 'warn',
      message: `owner 권한 멤버가 ${owners.length}명 — 정상은 1명. 중복 정리 필요.`,
    };
  }
  const owner = owners[0];
  if (storeInfo?.ownerId && owner.uid !== storeInfo.ownerId) {
    return {
      level: 'warn',
      message:
        'stores.ownerId 와 실제 owner 멤버 uid 가 어긋남 — 옛 가입 데이터 잔재 의심.',
    };
  }
  if (!myUid) {
    return { level: 'pending', message: '익명 uid 확인 중...' };
  }
  if (owner.uid === myUid) {
    return {
      level: 'ok',
      message: '✓ 정상 — 이 기기가 대표(owner) 로 등록되어 있습니다.',
    };
  }
  const me = members.find((m) => m.uid === myUid);
  if (!me) {
    return {
      level: 'error',
      message:
        '이 기기 uid 가 멤버 목록에 없음 — 강퇴되었거나 익명 uid 가 새로 발급됨. 재가입 필요.',
    };
  }
  return {
    level: 'ok',
    message: '✓ 정상 — 이 기기가 직원(staff) 로 등록되어 있습니다.',
  };
}

// 익명 uid / 매장 ID 같은 긴 문자열을 화면 표시용으로 짧게.
// Firestore doc id 는 20자 내외라 끝 12자만으로도 동일성 비교 충분.
export function shortId(id) {
  if (!id || typeof id !== 'string') return '-';
  return id.length <= 12 ? id : '...' + id.slice(-12);
}
