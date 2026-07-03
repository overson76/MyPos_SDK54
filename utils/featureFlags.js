// 성능 옵션 — 무거울 수 있는 기능의 온/오프. 기기별(AsyncStorage) 영속.
//
// 2026-07-03 사장님 요청: 카운터 PC(저사양) 가 "응답 없는 페이지" 로 멈추는
// 사고. 웹·EXE 동일 → Electron 이 아니라 앱 작업량 문제. 영업에 당장 필수가
// 아닌 무거운 기능을 하나씩 끄고 켜며 범인을 좁힐 수 있게(이분 탐색) 토글화.
//
// 패턴: notify.js 의 _volume 처럼 모듈 싱글톤 + 구독. React 컴포넌트/훅뿐 아니라
// 비-React 경로(useAddressBook effect 등)에서도 getFeatureFlag 로 읽을 수 있음.
// 기본값은 전부 ON — 켜둔 상태가 지금까지의 동작. 사장님이 필요한 것만 끔.

import { useEffect, useState } from 'react';
import { loadJSON, saveJSON } from './persistence';

// 순서 = 관리자 화면 표시 순서. 무거운(부하 큰) 것부터.
export const FEATURE_FLAGS = [
  {
    key: 'deliveryDrivingDistance',
    label: '배달 도로거리 자동계산',
    default: true,
    help: '매장↔배달지 도로 실거리를 카카오로 계산해 저장. 주소록이 많을수록 화면 열 때 부하가 큼. 끄면 거리만 안 뜨고 주문·결제는 정상.',
  },
  {
    key: 'addressAutoGeocode',
    label: '주소 자동 좌표변환',
    default: true,
    help: '새 배달 주소를 카카오로 좌표 변환(지도·거리의 전제). 주소록 순회 부하. 끄면 지도/거리 계산이 멈춤. 주문·결제는 정상.',
  },
  {
    key: 'deliveryMap',
    label: '배달 지도 표시',
    default: true,
    help: '테이블/주방 카드의 지도 미리보기 + 전체 배달지도. 지도 이미지 로딩 부하. 끄면 지도만 사라짐.',
  },
  {
    key: 'routeOptimize',
    label: '배달 경로 최적화',
    default: true,
    help: '동시 배달 2건 이상일 때 최적 순서 카드. 끄면 카드가 안 뜸(주문·배달은 정상).',
  },
  {
    key: 'deliveryDistanceLabel',
    label: '테이블 거리 표시',
    default: true,
    help: '배달 카드에 "1.2 km" 같은 거리 라벨 표시. 끄면 라벨만 사라짐.',
  },
  {
    key: 'aiRecommend',
    label: 'AI 메뉴 추천',
    default: true,
    help: '주문 화면의 "추천" 탭(판매 통계 계산). 끄면 추천 탭만 사라짐.',
  },
];

const _defaults = Object.fromEntries(FEATURE_FLAGS.map((f) => [f.key, f.default]));
let _flags = { ..._defaults };
const _subs = new Set();

function _emit() {
  for (const cb of _subs) {
    try {
      cb(_flags);
    } catch (_) {}
  }
}

// 비-React 경로용 즉시 읽기 (기본 ON). 미정의 키는 안전하게 true.
export function getFeatureFlag(key) {
  const v = _flags[key];
  return v === undefined ? true : v;
}

export function getAllFeatureFlags() {
  return { ..._flags };
}

export function setFeatureFlag(key, value) {
  _flags = { ..._flags, [key]: !!value };
  saveJSON('featureFlags', _flags); // 기기별 영속 (호출부 책임 아님 — 여기서)
  _emit();
}

export function subscribeFeatureFlags(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

// 부팅 1회 — App.js 가 호출해 AsyncStorage 에서 복원.
export async function loadFeatureFlags() {
  const saved = await loadJSON('featureFlags', null);
  if (saved && typeof saved === 'object') {
    _flags = { ..._defaults, ...saved };
    _emit();
  }
  return _flags;
}

// 테스트/리셋용 — 저장 없이 메모리만 초기화.
export function _resetFeatureFlagsForTest() {
  _flags = { ..._defaults };
}

// React 훅 — 플래그 변경 시 컴포넌트 리렌더 + effect deps 재평가.
export function useFeatureFlags() {
  const [flags, setFlags] = useState(getAllFeatureFlags);
  useEffect(() => subscribeFeatureFlags(setFlags), []);
  return flags;
}

export function useFeatureFlag(key) {
  return useFeatureFlags()[key];
}
