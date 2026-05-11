import {
  CMD,
  pad2col,
  visualWidth,
  divider,
  buildReceiptText,
  buildReceiptBytes,
} from '../utils/escposBuilder';

describe('visualWidth', () => {
  test('ASCII 1칼럼', () => {
    expect(visualWidth('hello')).toBe(5);
    expect(visualWidth('123')).toBe(3);
  });
  test('한글 2칼럼', () => {
    expect(visualWidth('가나다')).toBe(6);
    expect(visualWidth('치킨')).toBe(4);
  });
  test('혼합', () => {
    expect(visualWidth('치킨 x2')).toBe(7); // 4 + 3 = 7
  });
  test('null/undefined', () => {
    expect(visualWidth(null)).toBe(0);
    expect(visualWidth(undefined)).toBe(0);
  });
});

describe('pad2col', () => {
  test('좌우 정렬 — 32칼럼 기본', () => {
    const line = pad2col('치킨 x2', '20,000원');
    expect(visualWidth(line)).toBe(32);
    expect(line.startsWith('치킨 x2')).toBe(true);
    expect(line.endsWith('20,000원')).toBe(true);
  });
  test('너비 옵션', () => {
    const line = pad2col('a', 'b', 5);
    expect(line).toBe('a   b'); // 5 폭에 맞춰 3 공백
  });
  test('컨텐츠가 너비보다 크면 1칸만 띄움', () => {
    const line = pad2col('아주긴메뉴이름입니다', '999,999,999원', 32);
    expect(line).toContain(' '); // 적어도 1 공백
  });
});

describe('divider', () => {
  test('기본 32 dash', () => {
    expect(divider()).toBe('-'.repeat(32));
  });
  test('문자/너비 옵션', () => {
    expect(divider('=', 5)).toBe('=====');
  });
});

describe('buildReceiptText', () => {
  // 1.0.33 영수증 간결화: storeName/매장정보/부가세/결제수단/푸터 모두 제거.
  // "주문지 / 테이블명/배달지 / 메뉴+수량+가격 / 합계" 만 남음.
  const sample = {
    storeName: '마이포스 매장', // 빌더 무시 — 출력 안 됨
    tableId: '1',
    items: [
      { name: '치킨', qty: 2, price: 10000 },
      { name: '콜라', qty: 1, price: 2000 },
    ],
    total: 22000,
    paymentMethod: 'card', // 빌더 무시
    paymentStatus: 'paid', // 빌더 무시
    printedAt: new Date('2026-04-29T14:30:00').getTime(),
  };

  test('필수 섹션 — 주문지 + 테이블 + 메뉴 + 합계', () => {
    const text = buildReceiptText(sample);
    expect(text).toContain('주  문  지');
    expect(text).toContain('테이블: 1');
    expect(text).toContain('치킨 x2');
    expect(text).toContain('콜라 x1');
    expect(text).toContain('20,000원');
    expect(text).toContain('2,000원');
    expect(text).toContain('합계');
    expect(text).toContain('22,000원');
  });

  test('1.0.33 — 매장정보/부가세/결제수단/푸터 제거 확인', () => {
    const text = buildReceiptText(sample);
    expect(text).not.toContain('마이포스 매장');
    expect(text).not.toContain('공급가액');
    expect(text).not.toContain('부가세');
    expect(text).not.toContain('카드');
    expect(text).not.toContain('결제완료');
    expect(text).not.toContain('감사합니다');
  });

  test('1.0.39 — 이모지 제거 (EUC-KR 프린터 호환). ■/● 안전 문자만', () => {
    const text = buildReceiptText({
      ...sample,
      deliveryAddress: '서울시 종로구 ...',
      isSplit: true,
      sourceTableLabel: '02',
      items: [
        {
          name: '치킨',
          qty: 1,
          price: 10000,
          optionLabels: ['매운맛'],
          memo: '소스 따로',
        },
      ],
    });
    expect(text).not.toContain('📋');
    expect(text).not.toContain('👤');
    expect(text).not.toContain('🛵');
    expect(text).not.toContain('📝');
    expect(text).not.toContain('▸');
    expect(text).toContain('■ 테이블');
    expect(text).toContain('● 분리 결제 손님');
    expect(text).toContain('■ 배달');
    expect(text).toContain('- 매운맛');
    expect(text).toContain('메모: 소스 따로');
  });

  test('배달 주소 있으면 "■ 배달:" 라벨로 표시', () => {
    const text = buildReceiptText({
      ...sample,
      deliveryAddress: '서울시 종로구 ...',
    });
    expect(text).toContain('■ 배달');
    expect(text).toContain('서울시 종로구');
  });

  test('1.0.38 — 분리 결제 영수증은 "👤 분리 결제 손님: <라벨>" 라인 포함', () => {
    const text = buildReceiptText({
      ...sample,
      isSplit: true,
      sourceTableId: 't02',
      sourceTableLabel: '02',
    });
    expect(text).toContain('분리 결제 손님');
    expect(text).toContain('02');
  });

  test('1.0.38 — sourceTableLabel 없으면 sourceTableId fallback', () => {
    const text = buildReceiptText({
      ...sample,
      isSplit: true,
      sourceTableId: 't03',
    });
    expect(text).toContain('분리 결제 손님');
    expect(text).toContain('t03');
  });

  test('1.0.38 — isSplit 이 false 면 분리 결제 라인 없음', () => {
    const text = buildReceiptText({ ...sample, isSplit: false });
    expect(text).not.toContain('분리 결제 손님');
  });

  test('대 사이즈 — 보통/대 분리 한 줄씩', () => {
    const text = buildReceiptText({
      ...sample,
      items: [
        { name: '치킨', qty: 2, largeQty: 1, price: 10000, sizeUpcharge: 2000 },
      ],
    });
    // qty=2, largeQty=1 → 보통 1, 대 1 분리
    expect(text).toContain('치킨 보통 x1');
    expect(text).toContain('치킨 대 x1');
  });

  test('빈 receipt 안전', () => {
    const text = buildReceiptText({});
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  test('null 안전', () => {
    expect(typeof buildReceiptText(null)).toBe('string');
  });
});

describe('buildReceiptBytes', () => {
  const sample = {
    storeName: 'X',
    items: [{ name: '치킨', qty: 1, price: 10000 }],
    total: 10000,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
  };

  test('명령 바이트 + 텍스트 합친 Uint8Array', () => {
    const bytes = buildReceiptBytes(sample);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(50); // 텍스트 + 명령
  });

  test('init 명령으로 시작', () => {
    const bytes = buildReceiptBytes(sample);
    // ESC @ = 0x1B 0x40
    expect(bytes[0]).toBe(0x1B);
    expect(bytes[1]).toBe(0x40);
  });

  test('cut 명령으로 종료', () => {
    const bytes = buildReceiptBytes(sample);
    // GS V 1 = 0x1D 0x56 0x01 (partial cut)
    expect(bytes[bytes.length - 3]).toBe(0x1D);
    expect(bytes[bytes.length - 2]).toBe(0x56);
    expect(bytes[bytes.length - 1]).toBe(0x01);
  });

  test('커스텀 인코더 주입 가능 (EUC-KR 등)', () => {
    const fakeEncoder = (s) => new Uint8Array([0xAA, 0xBB]); // 가짜 2바이트
    const bytes = buildReceiptBytes(sample, fakeEncoder);
    // 텍스트 자리에 0xAA 0xBB 들어감
    let foundFake = false;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xAA && bytes[i + 1] === 0xBB) {
        foundFake = true;
        break;
      }
    }
    expect(foundFake).toBe(true);
  });
});

describe('CMD 명령 상수', () => {
  test('표준 ESC/POS 바이트', () => {
    expect(Array.from(CMD.init)).toEqual([0x1B, 0x40]);
    expect(Array.from(CMD.alignCenter)).toEqual([0x1B, 0x61, 0x01]);
    expect(Array.from(CMD.cutPartial)).toEqual([0x1D, 0x56, 0x01]);
    expect(Array.from(CMD.boldOn)).toEqual([0x1B, 0x45, 0x01]);
  });
});
