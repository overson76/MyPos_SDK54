import { encodeMenuRows, decodeMenuRows } from '../utils/menuRowsCodec';
import { defaultCategoryRows } from '../utils/menuData';

describe('menuRowsCodec', () => {
  describe('encode', () => {
    test('빈 입력 → 빈 객체', () => {
      expect(encodeMenuRows(null)).toEqual({});
      expect(encodeMenuRows(undefined)).toEqual({});
      expect(encodeMenuRows({})).toEqual({});
      expect(encodeMenuRows([])).toEqual({});
    });

    test('정상 격자 → 카테고리별 { v: 1, rows: flat[24] }', () => {
      const input = {
        '즐겨찾기': [
          [1, 2, 3, null, null, null],
          [null, null, null, null, null, null],
          [null, null, null, null, null, null],
          [null, null, null, null, null, null],
        ],
      };
      const out = encodeMenuRows(input);
      expect(out['즐겨찾기'].v).toBe(1);
      expect(out['즐겨찾기'].rows).toHaveLength(24);
      expect(out['즐겨찾기'].rows.slice(0, 6)).toEqual([1, 2, 3, null, null, null]);
      expect(out['즐겨찾기'].rows.slice(6)).toEqual(new Array(18).fill(null));
    });

    test('defaultCategoryRows 전체 round-trip', () => {
      const encoded = encodeMenuRows(defaultCategoryRows);
      const decoded = decodeMenuRows(encoded);
      // 모든 카테고리 동일 구조
      for (const cat of Object.keys(defaultCategoryRows)) {
        expect(decoded[cat]).toEqual(defaultCategoryRows[cat]);
      }
    });

    test('nested array 가 *Firestore reject 안 받게* — value 안에 array of array 없음', () => {
      const encoded = encodeMenuRows(defaultCategoryRows);
      // 모든 value 가 { v, rows: array of int|null } — nested array 아님.
      for (const cat of Object.keys(encoded)) {
        const v = encoded[cat];
        expect(typeof v).toBe('object');
        expect(Array.isArray(v.rows)).toBe(true);
        // rows 의 각 원소는 number 또는 null — array 아님 (nested 아님)
        for (const cell of v.rows) {
          expect(cell == null || typeof cell === 'number').toBe(true);
        }
      }
    });
  });

  describe('decode', () => {
    test('빈/잘못된 입력 → null', () => {
      expect(decodeMenuRows(null)).toBeNull();
      expect(decodeMenuRows(undefined)).toBeNull();
      expect(decodeMenuRows('string')).toBeNull();
      expect(decodeMenuRows([1, 2, 3])).toBeNull();
    });

    test('신규 codec 형식 → nested array 복원 (6×4)', () => {
      const input = {
        '즐겨찾기': {
          v: 1,
          rows: [
            1, 2, 3, null, null, null,
            5, 6, 7, 8, 9, 10,
            null, null, null, null, null, null,
            null, null, null, null, null, null,
          ],
        },
      };
      const out = decodeMenuRows(input);
      expect(out['즐겨찾기']).toEqual([
        [1, 2, 3, null, null, null],
        [5, 6, 7, 8, 9, 10],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ]);
    });

    test('옛 nested array 형식 호환 (혹시 우회로 저장된 매장)', () => {
      const input = {
        '즐겨찾기': [
          [1, 2, 3, null, null, null],
          [null, null, null, null, null, null],
          [null, null, null, null, null, null],
          [null, null, null, null, null, null],
        ],
      };
      const out = decodeMenuRows(input);
      expect(out['즐겨찾기'][0]).toEqual([1, 2, 3, null, null, null]);
    });

    test('짧은 rows 배열 → null 로 padding', () => {
      const input = { 'X': { v: 1, rows: [1, 2, 3] } };
      const out = decodeMenuRows(input);
      expect(out['X']).toHaveLength(4);
      expect(out['X'][0]).toEqual([1, 2, 3, null, null, null]);
    });

    test('인식 불가 카테고리 값 → 빈 격자', () => {
      const input = { 'X': { weird: true } };
      const out = decodeMenuRows(input);
      expect(out['X']).toEqual([
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ]);
    });
  });

  describe('회귀 시나리오 — 2026-05-26 영업 마비 사고 재발 방지', () => {
    test('들깨칼제비 같은 새 메뉴 추가 시 nested array 가 Firestore 호환 형식으로 encode', () => {
      // 사장님 매장의 원래 격자 (default + 들깨칼제비 추가됨)
      const rows = JSON.parse(JSON.stringify(defaultCategoryRows));
      // 국수/만백 카테고리의 빈 슬롯에 들깨칼제비 (ID 26) 추가
      const flat = [].concat(...rows['국수/만백']);
      const emptyIdx = flat.indexOf(null);
      flat[emptyIdx] = 26;
      const rebuilt = [];
      for (let r = 0; r < 4; r++) rebuilt.push(flat.slice(r * 6, (r + 1) * 6));
      rows['국수/만백'] = rebuilt;

      const encoded = encodeMenuRows(rows);
      // 들깨칼제비 ID 가 국수/만백 의 flat rows 안에 있어야
      expect(encoded['국수/만백'].rows).toContain(26);

      // round-trip 으로 원형 복원
      const decoded = decodeMenuRows(encoded);
      expect(decoded).toEqual(rows);
    });

    test('빈 객체 menu_rows (옛 사고 데이터) → decode 가 빈 카테고리 객체 반환', () => {
      // 사고 당시 사장님 매장 cache 가 받았던 형식 추정
      const corrupted = {};
      const decoded = decodeMenuRows(corrupted);
      expect(decoded).toEqual({});
      // reconcile 가드에서 default 로 채워질 것
    });
  });
});
