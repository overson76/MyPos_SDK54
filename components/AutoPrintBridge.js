// 주문 확정 시 자동 주문지 출력 브릿지 — 1.0.20.
//
// 동작:
//   1. OrderContext 의 confirmOrder 호출마다 listener 가 정보 받음
//      ({ tableId, isFresh, rows, isDelivery, deliveryAddress, tableLabel })
//   2. 자동 출력 토글(loadAutoOn) 이 ON 이고 정책(loadPolicy) 의 kinds 가 비어있지 않으면
//   3. 정책 + isDelivery + isFresh 로 실제 출력 종류(resolvePrintKinds) 결정
//   4. buildOrderSlipText 로 슬립 빌드 후 printReceipt({ rawText }) 호출
//   5. 출력 실패는 영업 흐름에 영향 X (silent catch)
//
// 책임 분리:
//   - OrderContext: 주문 상태 관리 + listener 등록 API (subscribeConfirmed)
//   - 이 컴포넌트: 정책 로드 + 슬립 빌드 + 프린터 호출
//   - KitchenScreen 의 🖨️ 수동 버튼(handlePrintSlip) 과 동일한 로직 — 트리거만 다름
//
// 기기별:
//   - PC 카운터 .exe 만 isPrinterAvailable() === true → 실제 출력
//   - 폰/iPad 는 false → no-op (안전)
//   - 매장 약속 = 카운터 PC 만 자동 출력 토글 ON, 주방 PC 는 OFF (PrintPolicySection 의 helper)

import { useEffect } from 'react';
import { useOrders } from '../utils/OrderContext';
import { useMenu } from '../utils/MenuContext';
import { loadAutoOn, loadPolicy, resolvePrintKinds } from '../utils/printPolicy';
import { buildOrderSlipText } from '../utils/escposBuilder';
import { printReceipt, isPrinterAvailable } from '../utils/printReceipt';
import { addBreadcrumb, reportError } from '../utils/sentry';

export default function AutoPrintBridge() {
  const { subscribeConfirmed } = useOrders();
  const { optionsList: OPTIONS_CATALOG } = useMenu();

  useEffect(() => {
    if (typeof subscribeConfirmed !== 'function') return undefined;

    const unsubscribe = subscribeConfirmed(async (info) => {
      // 1.0.30: 흐름 단계별 breadcrumb — 사장님 보고 "옵션 안 먹음" 진단용. 다음 출력 시
      // Sentry 에 어디서 멈추는지 stack 으로 확인 가능.
      try {
        const { tableId, isFresh, rows, isDelivery, deliveryAddress, tableLabel } = info;
        addBreadcrumb('autoprint.received', {
          tableId,
          isFresh,
          isDelivery,
          rowsCount: Array.isArray(rows) ? rows.length : 0,
          hasAddress: !!deliveryAddress,
        });

        // 폰/iPad 등 비-Electron 환경은 즉시 skip.
        if (!isPrinterAvailable()) {
          addBreadcrumb('autoprint.skip.no-printer', { tableId });
          return;
        }

        const autoOn = await loadAutoOn();
        if (!autoOn) {
          addBreadcrumb('autoprint.skip.toggle-off', { tableId });
          return;
        }

        const policy = await loadPolicy();
        addBreadcrumb('autoprint.policy', {
          kinds: policy?.kinds,
          isFresh,
          isDelivery,
        });

        const kindsSet = resolvePrintKinds(policy, { isDelivery, isFresh });
        if (kindsSet.size === 0) {
          addBreadcrumb('autoprint.skip.empty-kinds', { tableId, policy: policy?.kinds });
          return;
        }
        const kinds = [...kindsSet];

        // 옵션 라벨 resolve
        const resolvedRows = (rows || []).map((r) => ({
          ...r,
          item: {
            ...r.item,
            optionLabels: (r.item?.options || [])
              .map((oid) => OPTIONS_CATALOG.find((opt) => opt.id === oid)?.label)
              .filter(Boolean),
          },
        }));

        addBreadcrumb('autoprint.building', {
          tableId,
          resolvedRowsCount: resolvedRows.length,
          kinds,
        });

        const slipText = buildOrderSlipText({
          tableLabel,
          isDelivery,
          deliveryAddress,
          rows: resolvedRows,
          kinds,
          slippedAt: Date.now(),
        });

        addBreadcrumb('autoprint.slipText.length', { len: slipText?.length || 0 });

        // 비동기 출력 — 영업 흐름 안 막음. 실패는 silent (단 breadcrumb 으로 캡처).
        const result = await printReceipt({ rawText: slipText });
        addBreadcrumb('autoprint.printResult', {
          ok: result?.ok,
          reason: result?.reason,
          error: result?.error,
          mode: result?.mode,
        });
      } catch (err) {
        try { reportError(err, { ctx: 'autoprint.bridge' }); } catch {}
      }
    });

    return unsubscribe;
  }, [subscribeConfirmed, OPTIONS_CATALOG]);

  return null;
}
