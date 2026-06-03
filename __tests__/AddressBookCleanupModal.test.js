// 렌더 인프라(react-test-renderer) 미설치 — import-only 스모크.
// jest-expo 가 모달 파일을 import 하면 JSX 트랜스폼 + import 체인 + 모듈 평가까지
// 수행되므로, 문법 오류 / 잘못된 import 는 여기서 잡힌다. (실제 렌더는 폰/PC 검증)
import AddressBookCleanupModal from '../components/AddressBookCleanupModal';
import * as cleanup from '../utils/addressBookCleanup';

describe('AddressBookCleanupModal import 스모크', () => {
  test('모달 컴포넌트 + 정리 함수 import OK (문법/import 체인 검증)', () => {
    expect(typeof AddressBookCleanupModal).toBe('function');
    expect(typeof cleanup.findPhoneDuplicates).toBe('function');
    expect(typeof cleanup.findSimilarAliasPairs).toBe('function');
    expect(typeof cleanup.applyMerges).toBe('function');
  });
});
