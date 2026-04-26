import OrderScreen from '../screens/OrderScreen';

export default function OrderTab({
  selectedTable,
  setSelectedTable,
  onGoToTables,
  onRequestOrderWithTable,
}) {
  // 주문 탭 진입 즉시 즐겨찾기/메뉴 화면만 표시. 테이블은 '테이블' 탭에서 선택.
  return (
    <OrderScreen
      table={selectedTable || null}
      onBack={() => setSelectedTable?.(null)}
      onGoToTables={onGoToTables}
      onRequestOrderWithTable={onRequestOrderWithTable}
    />
  );
}
