// 웹 빌드용 JSON 백업/복구 헬퍼.
// 주소록 export 시 Blob 다운로드, import 시 <input type="file"> 으로 파일 읽기.
// MIME application/json + 사장님 매장명/날짜 기반 파일명 권장.

export function downloadJson(data, filename = 'mypos-backup.json') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 파일 선택 → 텍스트 읽음 → JSON.parse → 반환 (Promise).
// 사장님이 선택 취소하면 null 반환 (throw X).
export function pickJsonFile() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('웹 환경에서만 사용 가능합니다.'));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';

    let settled = false;
    const finishCancel = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    // 파일 선택 후 change 이벤트 — 취소 시엔 change 가 안 일어남.
    // focus 이벤트로 dialog 닫힘 감지 (브라우저별 timing 차이 있어 500ms 여유).
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      setTimeout(finishCancel, 500);
    };
    window.addEventListener('focus', onFocus);

    input.onchange = (e) => {
      const f = e.target.files?.[0];
      if (!f) { finishCancel(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        settled = true;
        try {
          const parsed = JSON.parse(String(reader.result || ''));
          resolve(parsed);
        } catch (err) {
          reject(new Error('JSON 파싱 실패 — 손상된 파일이거나 형식이 다릅니다.'));
        }
      };
      reader.onerror = () => {
        settled = true;
        reject(reader.error || new Error('파일 읽기 실패'));
      };
      reader.readAsText(f, 'utf-8');
    };
    document.body.appendChild(input);
    input.click();
    setTimeout(() => {
      try { document.body.removeChild(input); } catch (_) {}
    }, 5000);
  });
}
