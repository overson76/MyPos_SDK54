// 관리자 시스템 설정 안의 "매장 관리" 섹션.
// - 매장 정보 (이름, 코드, 본인 표시 이름, 역할)
// - 수익 PIN 설정/변경/제거 (대표만, stores/{sid}.revenuePinHash)
// - 가입 요청 / 멤버 관리는 Phase 5-2 다음 단계에서 추가 예정.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PinEntry from './PinEntry';
import { useStore } from '../utils/StoreContext';
import { useResponsive } from '../utils/useResponsive';
import {
  clearRevenuePin,
  hasRevenuePin,
  setRevenuePin,
  verifyRevenuePin,
} from '../utils/revenuePin';
import {
  approveJoinRequest,
  formatStoreCode,
  leaveStore as leaveStoreOp,
  rejectJoinRequest,
  removeMember,
  subscribeJoinRequests,
  subscribeMembers,
} from '../utils/storeOps';

const PIN_LENGTH = 4;

export default function StoreManagementSection() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { storeInfo, isOwner } = useStore();
  const [pinModal, setPinModal] = useState(null); // 'set' | 'change' | 'clear' | null
  const [joinRequests, setJoinRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [busyUid, setBusyUid] = useState(null);

  // 가입 요청 listener — 대표만. 멤버 listener — 모두.
  useEffect(() => {
    if (!storeInfo?.storeId) return;
    let unsubReq = null;
    let unsubMembers = null;
    if (isOwner) {
      unsubReq = subscribeJoinRequests(storeInfo.storeId, setJoinRequests);
    }
    unsubMembers = subscribeMembers(storeInfo.storeId, setMembers);
    return () => {
      unsubReq?.();
      unsubMembers?.();
    };
  }, [storeInfo?.storeId, isOwner]);

  if (!storeInfo) return null;

  const showAlert = (title, msg) => {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      window?.alert?.(`${title}\n${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  const askConfirm = (title, msg, destructive) =>
    new Promise((resolve) => {
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-alert
        const ok = window?.confirm?.(`${title}\n${msg}`);
        resolve(!!ok);
        return;
      }
      Alert.alert(title, msg, [
        { text: '취소', style: 'cancel', onPress: () => resolve(false) },
        {
          text: destructive || '확인',
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ]);
    });

  const handleApprove = async (uid) => {
    if (busyUid) return;
    setBusyUid(uid);
    try {
      await approveJoinRequest({
        storeId: storeInfo.storeId,
        requestUid: uid,
      });
    } catch (e) {
      showAlert('오류', e?.message || '승인 실패');
    } finally {
      setBusyUid(null);
    }
  };

  const handleReject = async (uid, name) => {
    if (busyUid) return;
    const ok = await askConfirm(
      '가입 요청 거부',
      `${name || '이 사용자'} 의 가입 요청을 거부하시겠습니까?`,
      '거부'
    );
    if (!ok) return;
    setBusyUid(uid);
    try {
      await rejectJoinRequest({
        storeId: storeInfo.storeId,
        requestUid: uid,
      });
    } catch (e) {
      showAlert('오류', e?.message || '거부 실패');
    } finally {
      setBusyUid(null);
    }
  };

  const handleRemove = async (uid, name) => {
    if (busyUid) return;
    const ok = await askConfirm(
      '직원 강퇴',
      `${name || '이 직원'} 을(를) 매장에서 제거합니다. 해당 직원은 즉시 매장 데이터에 접근할 수 없게 됩니다.`,
      '강퇴'
    );
    if (!ok) return;
    setBusyUid(uid);
    try {
      await removeMember({ storeId: storeInfo.storeId, memberUid: uid });
    } catch (e) {
      showAlert('오류', e?.message || '강퇴 실패');
    } finally {
      setBusyUid(null);
    }
  };

  const handleLeave = async () => {
    if (isOwner) {
      showAlert(
        '떠날 수 없습니다',
        '대표는 매장을 떠날 수 없습니다. 매장 삭제는 추후 추가됩니다.'
      );
      return;
    }
    const ok = await askConfirm(
      '매장 떠나기',
      '이 매장에서 본인을 제거합니다. 다시 가입하려면 대표에게 매장 코드를 받아 새로 가입 요청해야 합니다.',
      '떠나기'
    );
    if (!ok) return;
    try {
      await leaveStoreOp({ storeId: storeInfo.storeId });
      // listener 가 멤버 문서 사라짐 감지 → StoreContext 가 자동 unjoined.
    } catch (e) {
      showAlert('오류', e?.message || '매장 떠나기 실패');
    }
  };

  const onPinDone = (action) => {
    setPinModal(null);
    const msg =
      action === 'set'
        ? '수익 PIN 이 설정됐습니다.'
        : action === 'changed'
          ? '수익 PIN 이 변경됐습니다.'
          : '수익 PIN 이 해제됐습니다.';
    showAlert('완료', msg);
  };

  return (
    <View>
      {/* === 매장 정보 === */}
      <Text style={styles.sectionTitle}>매장 정보</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>상호</Text>
          <Text style={styles.value}>{storeInfo.name || '-'}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>매장 코드</Text>
          <Text style={styles.codeValue}>
            {storeInfo.code ? formatStoreCode(storeInfo.code) : '-'}
          </Text>
          <Text style={styles.helper}>
            이 코드를 직원에게 알려주면 직원이 매장에 가입 요청을 보낼 수 있습니다.
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>본인</Text>
          <Text style={styles.value}>
            {storeInfo.displayName || '-'} ·{' '}
            {storeInfo.role === 'owner' ? '대표' : '직원'}
          </Text>
        </View>
      </View>

      {/* === 수익 PIN — 대표만 === */}
      {isOwner && (
        <>
          <Text style={styles.sectionTitle}>수익 PIN (매장 공유)</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>
                수익 PIN {hasRevenuePin(storeInfo) ? '설정됨' : '미설정'}
              </Text>
              <Text style={styles.helper}>
                수익 현황 화면을 PIN 으로 보호합니다. 매장 공유 — PIN 을 아는
                직원도 열람할 수 있습니다. 미설정 시 모든 멤버가 즉시 열람합니다.
              </Text>
            </View>
            {!hasRevenuePin(storeInfo) ? (
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => setPinModal('set')}
              >
                <Text style={styles.btnPrimaryText}>PIN 설정</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => setPinModal('change')}
                >
                  <Text style={styles.btnSecondaryText}>변경</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnDanger}
                  onPress={() => setPinModal('clear')}
                >
                  <Text style={styles.btnDangerText}>해제</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </>
      )}

      {/* === 가입 요청 — 대표만 === */}
      {isOwner && joinRequests.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            가입 요청 ({joinRequests.length})
          </Text>
          {joinRequests.map((r) => (
            <View key={r.uid} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>{r.displayName || '(이름 없음)'}</Text>
                <Text style={styles.helper}>매장 가입을 요청했습니다.</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={[
                    styles.btnPrimary,
                    busyUid === r.uid && styles.btnDisabled,
                  ]}
                  disabled={busyUid === r.uid}
                  onPress={() => handleApprove(r.uid)}
                >
                  <Text style={styles.btnPrimaryText}>승인</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.btnDanger,
                    busyUid === r.uid && styles.btnDisabled,
                  ]}
                  disabled={busyUid === r.uid}
                  onPress={() => handleReject(r.uid, r.displayName)}
                >
                  <Text style={styles.btnDangerText}>거부</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      )}

      {/* === 멤버 목록 — 모두 === */}
      <Text style={styles.sectionTitle}>매장 멤버 ({members.length})</Text>
      {members.length === 0 ? (
        <View style={styles.row}>
          <Text style={styles.helper}>멤버 정보를 불러오는 중...</Text>
        </View>
      ) : (
        members.map((m) => {
          const isSelf = m.uid && storeInfo.ownerId
            ? false // 본인 표시는 displayName 비교가 아닌 uid 비교가 정확. storeOps 가 이미 uid 사용.
            : false;
          // 본인 여부는 storeInfo.role/displayName 으로 추정 (storeInfo 의 본인 uid 직접 노출 안 함).
          // 대신 storeInfo.role + members 의 role 매칭으로 본인 추정 가능.
          const isOwnerRow = m.role === 'owner';
          return (
            <View key={m.uid} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>
                  {m.displayName || '(이름 없음)'}{' '}
                  <Text style={styles.roleTag}>
                    {isOwnerRow ? '대표' : '직원'}
                  </Text>
                </Text>
                {m.joinedAt ? (
                  <Text style={styles.helper}>
                    {formatJoinedAt(m.joinedAt)}
                  </Text>
                ) : null}
              </View>
              {/* 대표는 직원 강퇴 가능 (본인 owner 자기 자신은 제외) */}
              {isOwner && !isOwnerRow && (
                <TouchableOpacity
                  style={[
                    styles.btnDanger,
                    busyUid === m.uid && styles.btnDisabled,
                  ]}
                  disabled={busyUid === m.uid}
                  onPress={() => handleRemove(m.uid, m.displayName)}
                >
                  <Text style={styles.btnDangerText}>강퇴</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}

      {/* === 매장 떠나기 === */}
      <Text style={styles.sectionTitle}>매장 탈퇴</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>매장 떠나기</Text>
          <Text style={styles.helper}>
            {isOwner
              ? '대표는 매장을 떠날 수 없습니다. 매장 삭제는 추후 추가됩니다.'
              : '이 매장에서 본인을 제거합니다. 다시 가입하려면 매장 코드로 새로 요청해야 합니다.'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.btnDanger, isOwner && styles.btnDisabled]}
          disabled={isOwner}
          onPress={handleLeave}
        >
          <Text style={styles.btnDangerText}>떠나기</Text>
        </TouchableOpacity>
      </View>

      {pinModal ? (
        <RevenuePinModal
          mode={pinModal}
          storeInfo={storeInfo}
          onClose={() => setPinModal(null)}
          onDone={onPinDone}
        />
      ) : null}
    </View>
  );
}

// 수익 PIN 설정/변경/해제 모달.
// AdminScreen 의 PinManageModal 과 동일 패턴 — 매장 PIN 함수만 다르게.
function RevenuePinModal({ mode, storeInfo, onClose, onDone }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const [step, setStep] = useState(
    mode === 'change' || mode === 'clear' ? 'old' : 'new'
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstNew, setFirstNew] = useState('');

  const titleByStep =
    step === 'old'
      ? mode === 'change'
        ? '기존 수익 PIN 입력'
        : '수익 PIN 해제 — 현재 PIN 입력'
      : step === 'new'
        ? '새 수익 PIN 입력 (4자리)'
        : '새 PIN 한 번 더 입력';

  const subtitleByStep =
    step === 'old'
      ? '확인을 위해 기존 PIN 을 입력하세요'
      : step === 'new'
        ? '매장 공유 PIN — 직원이 PIN 알면 열람 가능'
        : '확인을 위해 다시 입력하세요';

  const onSubmit = async (pin) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (step === 'old') {
        const ok = await verifyRevenuePin(storeInfo, pin);
        if (!ok) {
          setError('PIN 이 일치하지 않습니다.');
        } else if (mode === 'clear') {
          await clearRevenuePin({ storeId: storeInfo.storeId });
          onDone?.('cleared');
        } else {
          setStep('new');
        }
      } else if (step === 'new') {
        setFirstNew(pin);
        setStep('confirm');
      } else {
        if (pin !== firstNew) {
          setError('두 번 입력한 PIN 이 다릅니다. 다시 시작하세요.');
          setFirstNew('');
          setStep('new');
        } else {
          await setRevenuePin({ storeId: storeInfo.storeId, newPin: pin });
          onDone?.(mode === 'set' ? 'set' : 'changed');
        }
      }
    } catch (e) {
      setError(e?.message || 'PIN 처리 중 오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={modalStyles.overlay} pointerEvents="auto">
      <Pressable style={modalStyles.backdrop} onPress={onClose}>
        <Pressable style={modalStyles.card} onPress={() => {}}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.headerTitle}>{titleByStep}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={modalStyles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <PinEntry
            title=""
            subtitle={subtitleByStep}
            errorMessage={error}
            length={PIN_LENGTH}
            onSubmit={onSubmit}
          />
        </Pressable>
      </Pressable>
    </View>
  );
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0).
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
  sectionTitle: {
    fontSize: fp(14),
    fontWeight: '800',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
  },
  rowText: { flex: 1 },
  label: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
  value: { fontSize: fp(15), color: '#111827', marginTop: 2 },
  codeValue: {
    fontSize: fp(22),
    fontWeight: '900',
    color: '#2563eb',
    letterSpacing: 3,
    marginTop: 4,
  },
  helper: { fontSize: fp(11), color: '#6b7280', marginTop: 4, lineHeight: fp(15) },

  btnPrimary: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnPrimaryText: { color: '#fff', fontSize: fp(13), fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnSecondaryText: { color: '#374151', fontSize: fp(13), fontWeight: '600' },
  btnDanger: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnDangerText: { color: '#b91c1c', fontSize: fp(13), fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  roleTag: { fontSize: fp(11), color: '#6b7280', fontWeight: '600' },
});

// Firestore Timestamp → "2026-04-26 14:30" 식 표시.
// serverTimestamp() 가 아직 commit 안 됐으면 null 일 수 있음 — 그땐 빈 문자열.
function formatJoinedAt(ts) {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : null;
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `가입 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const modalStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 320,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: { fontSize: fp(16), fontWeight: '800', color: '#111827' },
  close: { fontSize: fp(18), color: '#6b7280', paddingHorizontal: 8 },
  });
}
