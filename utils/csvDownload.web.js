// 웹 빌드용 CSV 다운로드. Blob → a 태그 클릭 → 브라우저 다운로드 폴더로 저장.
// BOM(﻿) 선두 추가 — Excel 이 한국어를 깨지 않게 하기 위한 표준 트릭.

export function downloadCsv(text, filename = 'mypos-revenue.csv') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const bom = '﻿';
  const blob = new Blob([bom + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 브라우저가 다운로드 시작 후 URL 해제
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
