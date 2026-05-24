# 2026-05-24 — NAS wrangler sync + RaiDrive 마운트 자동 탐지

## 한 줄 요약

노트북 셋업이 매번 `npx wrangler login` + `setx MYPOS_NAS_SECRETS` 2회 수동 단계 필요했던 문제를 (1) wrangler config 도 NAS 동기화 대상에 추가 + (2) RaiDrive 의 사용자 폴더 prefix(`Z:\캐드피아\`) 도 자동 탐지하도록 일원화하여 *NAS 의 `setup-laptop-env.cmd` 더블클릭 1회로 영구 셋업 종료*.

## 무엇이 바뀌었는가

| Q | A |
|---|---|
| 노트북 답변 "wrangler 인증 ❌ / MYPOS_NAS_SECRETS 경로 다름" 의 정체 | wrangler config 는 NAS sync 대상 아니었음 + 노트북은 RaiDrive 마운트라 `Z:\캐드피아\secrets\mypos` (메인 PC 는 `Z:\secrets\mypos`). 두 PC 의 마운트 패턴 차이를 cmd 가 모름 |
| 메인 PC 의 실제 인증 상태 (확인 결과) | wrangler ✅ overson76@naver.com OAuth + eas ✅ cadpia(EXPO_TOKEN 40자). state.json 은 53B 빈 상태 — EAS 인증은 EXPO_TOKEN 환경변수가 담당 |
| 동시 작업 충돌 처리 | 메인 PC 가 4791105 commit 만든 사이 노트북이 2cf75f1 + 머지커밋 a59ebf1 push. 메인 PC commit reset 후 노트북 commit 위에 Windows 경로 분기 fix(f1f87fa) 얹어 history 보존 |
| RaiDrive 분기를 어떻게 안전하게 처리했나 | cmd 파일에 한글 path 박지 않고 `for /D %%D in (Z:\*)` 런타임 탐색 — *어떤 한글/영문 사용자 폴더 prefix* 든 `secrets\mypos\.env` 발견 시 그 경로를 setx. ASCII only — 인코딩 함정 0 |
| wrangler config 의 플랫폼별 경로 | Windows 4.x = `%APPDATA%\xdg.config\.wrangler\config\default.toml`, macOS/Linux = `~/.config/.wrangler/config/default.toml`. `resolveWranglerConfigPath()` 헬퍼가 후보 검색 |
| 잔재 별관/워크트리 정리 | 12개 별관 브랜치 + 18개 워크트리 폴더(eager-hellman 1개 남음) 일괄 삭제. 11개는 -d(safe), admiring-fermat 만 -D(옛 baseline + 같은 의도 commit 이미 main 머지됨) |

## 신규/변경 파일

| 파일 | 변경 |
|---|---|
| [scripts/sync-secrets.js](../../scripts/sync-secrets.js) | +`resolveWranglerConfigPath()` 헬퍼 (Windows %APPDATA%\xdg.config + macOS/Linux ~/.config 분기) + FILES 배열에 wrangler config 추가 + `resolveNasDir()` Windows 후보 5개로 확장 (RaiDrive 한글 사용자 폴더 포함) |
| NAS `setup-laptop-env.cmd` (1,690B) | 동적 NAS 탐색 (`for /D %%D in (Z:\*)`) + EXPO_TOKEN/GH_TOKEN/MYPOS_NAS_SECRETS 자동 setx — 더블클릭 1회로 완료. ASCII only |
| NAS `README.txt` (1,353B) | 동기화 3종 + RaiDrive 탐지 흐름 문서화 |
| NAS `wrangler-config.toml` (750B) | 메인 PC OAuth 토큰 (oauth_token / refresh_token / scopes) — 다른 PC 가 sync 로 받음 |

## 알려진 문제 / 미해결 이슈

- **eager-hellman-b0b674 워크트리 폴더** 1개가 cwd 잠금으로 미제거. 다음 세션에서 다른 위치에서 명령 시 `rmdir /S /Q C:\MyProjects\MyPos_SDK54\.claude\worktrees\eager-hellman-b0b674` 한 줄로 정리.
- **expo-state.json 53B** = EAS 인증을 *EXPO_TOKEN 환경변수* 가 담당. state.json 자체는 빈 채로 NAS sync — 다른 PC 가 받아도 무의미. setup-laptop-env.cmd 가 EXPO_TOKEN 을 setx 해주므로 노트북에서도 환경변수 인증 동일 패턴.
- **노트북 실제 검증 대기** — 사장님이 노트북에서 새 setup-laptop-env.cmd 더블클릭 + `npm start` + `npx eas whoami` / `npx wrangler whoami` 결과 미확인.

## 다음 세션 진입 가이드

```bash
# 현재 main 헤드
git -C C:/MyProjects/MyPos_SDK54 log --oneline -5
# d81626a feat(secrets): RaiDrive 마운트도 자동 탐지
# f1f87fa fix(secrets): wrangler config 경로 Windows 분기 추가
# a59ebf1 Merge branch 'main' of ...
# 2cf75f1 feat(secrets): wrangler OAuth config 도 NAS 동기화 대상에 추가
# a1998ad docs(sessions): 2026-05-23 2부 사후 기록

# jest 회귀
npx jest    # 2,709/2,709 통과

# NAS 상태
ls Z:\secrets\mypos\
# .env  expo-state.json  wrangler-config.toml  setup-laptop-env.cmd  README.txt

# 노트북 셋업 (사장님이 노트북에서 1회):
# 1) Z:\캐드피아\secrets\mypos\setup-laptop-env.cmd 더블클릭
# 2) 새 cmd 창: cd C:\MyProjects\MyPos_SDK54 && git pull && npm start
# 3) 검증: npx eas whoami / npx wrangler whoami

# 별관 잔재 정리 (eager-hellman 폴더 — 다음 세션에서):
rmdir /S /Q C:\MyProjects\MyPos_SDK54\.claude\worktrees\eager-hellman-b0b674
```

## 핵심 기술 결정

### 1. **cmd 파일은 ASCII only + 런타임 동적 탐색**

`set "CAND=Z:\캐드피아\secrets\mypos"` 같이 한글 path 박으면 .cmd 파일 인코딩 문제 (cp949 vs UTF-8 BOM vs ASCII) 가 매번 함정. 대신 `for /D %%D in (Z:\*) do (if exist "%%D\secrets\mypos\.env" set "NAS=%%D\secrets\mypos")` 로 시스템 파일 시스템 호출이 한글을 자동 처리. cmd 파일 본문은 ASCII 만 — 인코딩 함정 0.

### 2. **NAS git mirror force-update**

`Z:/git/MyPos_SDK54.git` 가 옛 history (메인 PC 의 4791105 잘못 push 잔재) 에 묶여 일반 push 거부. 사장님 본인 백업 미러라 destructive 위험 0 → `git push --force` 로 GitHub origin 과 일치(d81626a) 시킴.

### 3. **EAS 인증은 EXPO_TOKEN 환경변수 우선 + state.json fallback**

eas CLI 가 EXPO_TOKEN 있으면 우선 사용. state.json 은 fallback. 두 PC 모두 환경변수 라우트 사용(노트북도 setup-laptop-env.cmd 가 setx) → state.json sync 는 *환경변수 미설정 PC* 를 위한 안전망.

### 4. **별관 워크트리/브랜치 일괄 정리**

12개 브랜치 (`main..<branch>` = 0 unmerged 11개 + 옛 baseline 1개) + 18개 워크트리 폴더 잔재. CLAUDE.md 정책 "별관 작업 끝나면 본관 머지 — 잠긴 브랜치 누적 방지" 에 따라 일괄 처리. admiring-fermat 만 -D (force) — 같은 의도 commit (`91acdc4 / dea4bc4 / f3966d5`) 이 이미 main 에 들어가 있음 (cherry-pick 또는 별도 작업으로 머지된 흔적).

## 빌드/실행 명령

```bash
# 로컬 검증
npm test                   # jest 2,709/2,709

# NAS 동기화 수동
npm run secrets:sync       # 양방향 sync (mtime 더 최신 쪽이 이김)
npm run secrets:push       # 로컬 → NAS 강제

# 정식 배포 (사장님 명령 후)
npm run deploy:web         # PC 카운터
eas update --branch production --message "..."  # 폰 OTA
```

## 커밋

- `2cf75f1` feat(secrets): wrangler OAuth config 도 NAS 동기화 대상에 추가 (노트북에서 push)
- `a59ebf1` Merge branch 'main' (노트북 머지)
- `f1f87fa` fix(secrets): wrangler config 경로 Windows 분기 추가 (메인 PC f1f87fa = 이 세션)
- `d81626a` feat(secrets): RaiDrive 마운트 (Z:\<사용자>\secrets\mypos) 도 자동 탐지 (이 세션)
- `(세션 노트 commit — 4단계)` (이 파일)

## 다음 체크리스트

- [ ] 노트북에서 새 setup-laptop-env.cmd 더블클릭 검증 → MYPOS_NAS_SECRETS 가 `Z:\캐드피아\secrets\mypos` 로 영구 등록되는지
- [ ] 노트북에서 `npm start` 후 prestart sync 로그 확인 — `wrangler config: NAS → 로컬` 메시지 보여야
- [ ] 노트북 `npx wrangler whoami` 가 `overson76@naver.com` 나오는지
- [ ] eager-hellman 워크트리 폴더 잔재 제거 (다음 세션 시작 시점)
