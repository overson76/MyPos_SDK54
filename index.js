import { registerRootComponent } from 'expo';

// Sentry 는 가능한 한 빨리 초기화 — App 모듈이 import 되기 전에 호출되어
// 초기 import 단계의 에러도 캡처할 수 있도록.
import { initSentry } from './utils/sentry';
initSentry();

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
