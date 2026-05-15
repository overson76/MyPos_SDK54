import {
  CMD,
  pad2col,
  visualWidth,
  divider,
  buildReceiptText,
  buildReceiptBytes,
  buildDeliveryReturnText,
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

  test('필수 섹션 — 매장 헤더 + 테이블 + 메뉴 + 합계 (1.0.44)', () => {
    const text = buildReceiptText(sample);
    // 1.0.44: 상황별 헤더 — orderType 미지정 + deliveryAddress 없음 → 매장
    expect(text).toContain('매 장 주 문 지');
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
    // 1.0.44: orderType 미지정 + deliveryAddress 있음 → 'delivery' 추정 → 새 형식
    expect(text).toContain('배달지');
    expect(text).toContain('- 매운맛');
    expect(text).toContain('메모: 소스 따로');
  });

  test('배달 주소만 있고 orderType 미지정 — 옛 호환 "■ 배달:" fallback', () => {
    const text = buildReceiptText({
      ...sample,
      deliveryAddress: '서울시 종로구 ...',
    });
    // 1.0.44: orderType 미지정 + deliveryAddress 만 있으면 'delivery' 로 추정
    expect(text).toContain('배 달 주 문 지');
    expect(text).toContain('배달지');
    expect(text).toContain('서울시 종로구');
  });

  // 1.0.44 신규 ───────────────────────────────────────────────
  test('1.0.44 — orderType=delivery + 손님 정보 + 도로거리 + 배달요청 시각', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'delivery',
      deliveryAddress: '부산 사하구 하신번영로 199',
      customerPhone: '01012345678',
      customerAlias: '김씨네 아파트',
      drivingDistanceM: 2300,
      drivingDurationSec: 720,
      scheduledTime: '420',
      scheduledTimeIsPM: true,
    });
    expect(text).toContain('배 달 주 문 지');
    expect(text).toContain('배달지 부산 사하구 하신번영로 199');
    expect(text).toContain('별칭   김씨네 아파트');
    expect(text).toContain('손님   010-1234-5678');
    expect(text).toContain('도로   2.3km');
    expect(text).toContain('12분');
    expect(text).toContain('출발   오후 4시 20분');
  });

  test('1.0.44 — orderType=reservation 헤더 + 예약시각', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'reservation',
      scheduledTime: '630',
      scheduledTimeIsPM: true,
    });
    expect(text).toContain('예 약 주 문 지');
    expect(text).toContain('예약시각 오후 6시 30분');
    expect(text).not.toContain('배달지');
  });

  test('1.0.44 — orderType=takeout 헤더 + 픽업시각', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'takeout',
      scheduledTime: '515',
      scheduledTimeIsPM: true,
    });
    expect(text).toContain('포 장 주 문 지');
    expect(text).toContain('픽업시각 오후 5시 15분');
  });

  test('단골요청 — orderType=delivery 에서만 표시 (주방·라이더용)', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'delivery',
      deliveryAddress: '부산 사하구 하신번영로 25',
      customerAlias: '진실보석',
      customerRequest: '다진고추, 김치많이',
    });
    expect(text).toContain('요청   다진고추, 김치많이');
  });

  test('단골요청 — delivery 외 orderType 에서는 표시 안 함', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'reservation',
      scheduledTime: '630',
      scheduledTimeIsPM: true,
      customerRequest: '다진고추, 김치많이',
    });
    expect(text).not.toContain('요청   ');
  });

  test('단골요청 없으면 줄 자체 표시 안 함', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'delivery',
      deliveryAddress: '부산 사하구 하신번영로 25',
    });
    expect(text).not.toContain('요청   ');
  });

  test('1.0.44 — 배달인데 손님 전화/거리 모두 null 이어도 안전', () => {
    const text = buildReceiptText({
      ...sample,
      orderType: 'delivery',
      deliveryAddress: '부산 사하구 ...',
      customerPhone: null,
      customerAlias: null,
      drivingDistanceM: null,
    });
    expect(text).toContain('배 달 주 문 지');
    expect(text).toContain('배달지');
    expect(text).not.toContain('별칭');
    expect(text).not.toContain('손님');
    expect(text).not.toContain('도로');
  });

  test('1.0.44 — 매장 전화번호 포맷 (02 지역번호 + 휴대전화)', () => {
    const t1 = buildReceiptText({
      ...sample,
      orderType: 'delivery',
      deliveryAddress: '서울 종로구 ...',
      customerPhone: '0212345678',
    });
    expect(t1).toContain('02-1234-5678');

    const t2 = buildReceiptText({
      ...sample,
      orderType: 'delivery',
      deliveryAddress: '서울 종로구 ...',
      customerPhone: '01098765432',
    });
    expect(t2).toContain('010-9876-5432');
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

describe('buildDeliveryReturnText', () => {
  const sample = {
    sortMode: 'far',
    ranked: [
      {
        rank: 1,
        label: '진실보석',
        address: '부산 사하구 하신번영로 25',
        alias: '진실보석',
        distanceM: 2300,
        menuSummary: [
          { name: '칼국수', qty: 2 },
          { name: '팥죽', qty: 1 },
        ],
        totalDishes: 3,
      },
      {
        rank: 2,
        label: '하나헤어',
        address: '부산 사하구 하신번영로 185',
        alias: '하나헤어',
        distanceM: 1800,
        menuSummary: [{ name: '만두', qty: 1 }],
        totalDishes: 1,
      },
    ],
    unknown: [
      {
        label: '하나자원',
        address: '하나자원',
        menuSummary: [{ name: '칼국수', qty: 1 }],
        totalDishes: 1,
      },
      {
        label: '불고기',
        address: '불고기',
        menuSummary: [{ name: '팥죽', qty: 2 }],
        totalDishes: 2,
      },
    ],
  };

  test('헤더 + 정렬 모드 + 건수 표시', () => {
    const text = buildDeliveryReturnText(sample, { printedAt: new Date(2026, 4, 15, 16, 30).getTime() });
    expect(text).toContain('배 달 회 수');
    expect(text).toContain('2026-05-15 16:30');
    expect(text).toContain('원거리 순');
    expect(text).toContain('4건'); // ranked 2 + unknown 2
  });

  test('주소불명 섹션 — 0. 번호 + 메뉴', () => {
    const text = buildDeliveryReturnText(sample);
    expect(text).toContain('[ 주소불명 2건 ]');
    expect(text).toContain(' 0. 하나자원');
    expect(text).toContain(' 0. 불고기');
    expect(text).toContain('칼국수 1');
  });

  test('근거리 순 정렬 표기', () => {
    const text = buildDeliveryReturnText({ ...sample, sortMode: 'near' });
    expect(text).toContain('근거리 순');
  });

  test('거리 km 표기', () => {
    const text = buildDeliveryReturnText(sample);
    expect(text).toContain('2.3km'); // ranked[0]
    expect(text).toContain('1.8km'); // ranked[1]
  });

  test('순위별 메뉴 + 총 그릇 수', () => {
    const text = buildDeliveryReturnText(sample);
    expect(text).toContain('1. 진실보석');
    expect(text).toContain('칼국수 2, 팥죽 1');
    expect(text).toContain('총 3 그릇');
    expect(text).toContain('2. 하나헤어');
    expect(text).toContain('만두 1');
  });

  test('회수 대상 0건 — 안내 메시지', () => {
    const text = buildDeliveryReturnText({ ranked: [], unknown: [], sortMode: 'far' });
    expect(text).toContain('회수할 그릇이 없습니다');
  });

  test('null / 빈 결과 안전', () => {
    expect(typeof buildDeliveryReturnText(null)).toBe('string');
    expect(typeof buildDeliveryReturnText({})).toBe('string');
  });

  test('주소불명만 있을 때 (ranked 비어있어도) — 안내 메시지 X', () => {
    const text = buildDeliveryReturnText({
      ranked: [],
      unknown: [{ label: '하나자원', menuSummary: [{ name: '칼국수', qty: 1 }], totalDishes: 1 }],
      sortMode: 'far',
    });
    expect(text).toContain('주소불명');
    expect(text).not.toContain('회수할 그릇이 없습니다');
  });
});
