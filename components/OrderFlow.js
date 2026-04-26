import { useEffect } from 'react';
import OrderScreen from '../screens/OrderScreen';
import TableScreen from '../screens/TableScreen';

export default function OrderFlow({
  resetSignal,
  selectedTable,
  setSelectedTable,
  lastSelectedTableId,
  autoConfirmIntent,
  clearAutoConfirmIntent,
}) {
  // 상단 '테이블' 탭을 다시 누르면 OrderScreen에서 목록으로 자동 복귀
  useEffect(() => {
    setSelectedTable?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (selectedTable) {
    return (
      <OrderScreen
        table={selectedTable}
        onBack={() => setSelectedTable?.(null)}
        autoConfirmIntent={autoConfirmIntent}
        clearAutoConfirmIntent={clearAutoConfirmIntent}
      />
    );
  }
  return (
    <TableScreen
      onSelectTable={setSelectedTable}
      highlightTableId={lastSelectedTableId}
    />
  );
}
