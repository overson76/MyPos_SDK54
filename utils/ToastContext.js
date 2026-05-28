// 2026-05-28: 사장님 호소 "어디에 저장됐는지 알림" — 주소록 저장 결과 시각 피드백.
//
// 사용 시나리오:
//   - 사장님이 주문 라벨에 "진실" 입력 + 주문 → AliasPromptModal → "진실보석" 후보 선택 →
//     mergePhoneIntoEntry → showToast("010-1234-1234 → 진실보석 에 추가 저장")
//   - 사장님이 새 손님으로 진행 → 새 entry 생성 → showToast("010-1234-1234 → 진실 신규 저장")
//   - CID 통합 모달에서 같은 흐름.
//
// 사장님이 즉시 "잘 들어갔구나" 확인 가능. 잘못 저장됐다면 그 자리에서 ✏️ 편집.

import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext({
  toast: null,
  showToast: () => {},
  dismissToast: () => {},
});

const DEFAULT_DURATION_MS = 5000;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  // payload: { kind: 'success'|'warn'|'info', text: string, durationMs?: number }
  const showToast = useCallback((payload) => {
    if (!payload || !payload.text) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const duration = payload.durationMs || DEFAULT_DURATION_MS;
    const next = {
      id: Date.now() + Math.random(),
      kind: payload.kind || 'success',
      text: payload.text,
    };
    setToast(next);
    timerRef.current = setTimeout(() => {
      setToast((cur) => (cur && cur.id === next.id ? null : cur));
      timerRef.current = null;
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
