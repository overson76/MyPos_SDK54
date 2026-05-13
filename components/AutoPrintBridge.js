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
import { useStore } from '../utils/StoreContext';
import { loadAutoOn, loadAutoTypes } from '../utils/printPolicy';
import { buildReceiptText } from '../utils/escposBuilder';
import { printReceipt, isPrinterAvailable } from '../utils/printReceipt';
import { resolveAnyTable } from '../utils/tableData';
import { addBreadcrumb, reportError } from '../utils/sentry';

export default function AutoPrintBridge() {
  const { subscribeConfirmed } = useOrders();
  const { optionsList: OPTIONS_CATALOG } = useMenu();
  const { storeInfo } = useStore();

  useEffect(() => {
    if (typeof subscribeConfirmed !== 'function') return undefined;

    const unsubscribe = subscribeConfirmed(async (info) => {
      // 1.0.32: 모든 출력 영수증 빌더(buildReceiptText) 통일 — 사장님 의도 "모든 곳에서
      // 같은 출력물". 카테고리/정책 분리 없이 메뉴 / 수량 / 가격 / 옵션 / 메모 / 합계 모두.
      try {
        const {
          tableId,
          items,
          total,
          isDelivery,
          deliveryAddress,
          tableLabel,
          // 1.0.44: OrderContext 가 미리 계산한 orderType (resolveTableForAlert 기반).
          // 아래 1.0.41 분기에서 자체 계산하므로 alias 로 받음 — 두 값이 같지만 fallback 안전.
          orderType: emittedOrderType,
          scheduledTime,
          scheduledTimeIsPM,
          customerPhone,
          customerAlias,
          drivingDistanceM,
          drivingDurationSec,
        } = info;
        addBreadcrumb('autoprint.received', {
          tableId,
          isDelivery,
          orderType: emittedOrderType,
          itemsCount: Array.isArray(items) ? items.length : 0,
          total,
          hasAddress: !!deliveryAddress,
        });

        if (!isPrinterAvailable()) {
          addBreadcrumb('autoprint.skip.no-printer', { tableId });
          return;
        }

        const autoOn = await loadAutoOn();
        if (!autoOn) {
          addBreadcrumb('autoprint.skip.toggle-off', { tableId });
          return;
        }

        // 1.0.41: 주문 종류별 자동 출력 분기 — 사장님 신고 "배달만 체크했는데
        // 테이블 주문도 인쇄됨" fix. tableId 의 type 으로 판단. 분할/단체(#) 는
        // parent ID 로 분해 후 type 추출.
        // 1.0.44: OrderContext 가 emit 시 이미 계산해 보내주지만, fallback 으로 자체 계산.
        const baseId = String(tableId || '').split('#')[0];
        const tbl = resolveAnyTable(baseId);
        const orderType = emittedOrderType || tbl?.type || 'regular';
        const autoTypes = await loadAutoTypes();
        if (!autoTypes.includes(orderType)) {
          addBreadcrumb('autoprint.skip.type-off', {
            tableId,
            orderType,
            autoTypes: autoTypes.join(','),
          });
          return;
        }

        // 옵션 라벨 resolve
        const itemsWithLabels = (items || []).map((it) => ({
          ...it,
          optionLabels: (it.options || [])
            .map((oid) => OPTIONS_CATALOG.find((opt) => opt.id === oid)?.label)
            .filter(Boolean),
        }));

        const receiptText = buildReceiptText({
          storeName: storeInfo?.name || 'MyPos',
          storePhone: storeInfo?.phone || '',
          storeAddress: storeInfo?.address || '',
          businessNumber: storeInfo?.businessNumber || '',
          receiptFooter: storeInfo?.receiptFooter || '',
          tableId,
          tableLabel,
          items: itemsWithLabels,
          total,
          // 주문 확정 시점 = 결제 전. paymentMethod 없음 / paymentStatus = 'pending'.
          paymentMethod: null,
          paymentStatus: 'pending',
          deliveryAddress: isDelivery ? deliveryAddress : '',
          printedAt: Date.now(),
          // 1.0.44: 상황별 영수증 — orderType + 예약/포장 시각 + 배달 손님 정보.
          orderType,
          scheduledTime,
          scheduledTimeIsPM,
          customerPhone,
          customerAlias,
          drivingDistanceM,
          drivingDurationSec,
        });

        addBreadcrumb('autoprint.building', {
          tableId,
          itemsCount: itemsWithLabels.length,
          receiptLen: receiptText?.length || 0,
        });

        const result = await printReceipt({ rawText: receiptText });
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
