// 웹 빌드용 no-op. OTA 는 네이티브(iOS/Android) 전용.
// 웹은 deploy:web 으로 즉시 갱신 (서비스 워커 + Cloudflare 배포) — 별도 OTA 메커니즘 불필요.

export async function checkForUpdates() {
  return { state: 'disabled' };
}

export function getOtaInfo() {
  return {
    enabled: false,
    runtimeVersion: null,
    updateId: null,
    channel: null,
    createdAt: null,
    isEmbeddedLaunch: null,
  };
}
