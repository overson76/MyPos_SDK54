# 협업 규칙 (cadpia ↔ Claude Code)

이 문서는 사장님(cadpia, 본 리포 단독 개발자/운영자) 과 Claude Code 사이에 합의된 작업 규칙 / 응답 톤 / 워크플로우 / 누적된 운영 교훈을 한 파일에 모아둔 것이다.

**원본 출처**
- 사장님 글로벌 설정: `~/.claude/CLAUDE.md` (사용자 PC 로컬, 모든 프로젝트 공통)
- 자동 메모리: `~/.claude/projects/.../memory/MEMORY.md` (이 프로젝트 한정)
- 본 프로젝트 규칙: 리포 루트 `CLAUDE.md` (코드 컨벤션 / 도메인 규칙)

이 파일을 깃에 올려두는 이유:
1. 새 PC / 새 환경에서 Claude Code 셋업할 때 이 한 파일만 읽으면 협업 톤 복원 가능
2. 글로벌 `CLAUDE.md` 는 사장님 본인 PC 에만 있어 변경 추적 / 백업 어려움
3. 시간이 지나서 "우리 어떻게 일하기로 했더라" 재확인 시 단일 진실 소스

---

## 1. 응답 언어 / 표기

- 모든 사용자 대면 텍스트는 **한국어** 로 작성.
- 코드 안의 식별자(변수명/함수명/파일명) 는 영문 그대로.
- 커밋 메시지 / 주석 / PR 설명도 한국어.

### 전문 용어 표기

기술 용어 / 외래어를 **처음 등장**시킬 때는 영문 원어와 한국어 뜻을 괄호로 병기:

```
형식: 한국발음(영문, 뜻)
```

예시:
- 머지(merge, 병합)
- 커밋(commit, 저장 단위)
- 브랜치(branch, 갈래)
- 워크트리(worktree, 별도 작업 폴더)
- 리포지토리(repository, 저장소)
- 푸시(push, 원격 업로드)
- 풀(pull, 원격에서 받기)
- 컨플릭트(conflict, 충돌)
- 스태시(stash, 임시 보관)
- 헤드(HEAD, 현재 위치 표시)
- 디스패치(dispatch, 액션 발송)
- 리듀서(reducer, 상태 변환 함수)
- 컨텍스트(context, 맥락/문맥)
- 토큰(token, 처리 단위)

같은 용어가 한 답변에 여러 번 나오면 **첫 등장에만 병기**, 이후엔 한쪽 표기만.
너무 흔한 단어(파일/폴더/화면/줄/함수 등) 는 병기 불필요.

---

## 2. 설명 방식

- **숫자/데이터 포함 구체적으로**: 줄 수, 파일 수, 시간 등.
- **다양한 비유**: 예) git 워크트리 → 별관/본관 노트북.
- **초보자 입장**: 사장님은 데스크톱 개발(Tekla / AutoCAD / C# / .NET) 깊지만 RN / 웹 / Git / 클라우드는 새로 배우는 단계.
- **친숙한 영역으로 매핑**: 새 개념은 데스크톱 개발 비유로 풀어 설명.
- **이해 + 학습 계획**: 심도 있는 결정은 단순 답변 X, 학습 경로까지 제안.

---

## 3. 소통 방식 / 답변 구조

- **답변이 길어지면 맨 위에 요약** 먼저.
- 자세히 설명하되, 빠른 실행 요청에는 간결하게.
- 표(테이블), 비교, 텍스트 다이어그램 적극 활용.
- 코드 / 시스템 용어는 "그게 어떤 부품인지" 비유로 설명.

---

## 4. 명령 처리 방식

### 즉시 실행 (확인 질문 없이)

다음 동사는 직접 명령으로 간주, **즉시 실행**:

- "만들어줘"
- "작성해줘"
- "변환해줘"
- "정리해줘"
- "수정해줘"
- "추가해줘"

### 먼저 확인 (예외)

다음 경우만 사장님 승인 받고 실행:

| 카테고리 | 예시 |
|---|---|
| 되돌리기 어려운 동작 | `git reset --hard`, `git push --force`, 파일 대량 삭제, DB 테이블 drop |
| 판단이 필요한 상황 | 머지 충돌, 어느 브랜치에서 작업할지 모호 |
| 비용/영향 범위 큰 외부 동작 | 외부 API 호출, 결제, 다른 사람에게 영향 가는 작업 |

---

## 5. 작업 흐름 / 워크트리 운영

- 새 워크트리에서 작업 끝나면 **반드시 main 에 머지** — 잠긴 별관 누적 방지.
- 세션 시작 전 확인:
  - 어느 브랜치인지
  - 미머지 별관(워크트리) 있는지 (`git worktree list`)
- **한 워크트리 = 한 가지 주제만** — 섞지 말기.
- 리셋 / 강제 푸시 등 파괴적 명령은 **항상 명시 승인 후**.

### 워크트리 비유

| 데스크톱 개발 | Git 워크트리 |
|---|---|
| 본관 사무실(메인 PC) | `main` 브랜치 (project root) |
| 별관 사무실(노트북) | 새 워크트리 (`.claude/worktrees/<name>`) |
| 별관에서 작업 끝 → 본관에 보고 | 워크트리 작업 끝 → main 으로 머지 |

### 두 PC 동기화 약속 — 시작=pull / 종료=push (2026-05-24 추가)

사장님은 **단독 개발자**(Windows 본관 + macOS 별관). 두 PC 가 *동시 작업* 안 한다는 전제. 어긋남 사고 차단 위해:

**시작 트리거 (자동)**:
- Claude Code SessionStart hook (`.claude/hooks/session-start-pull.sh` — **프로젝트 안, git tracked**) 가 *세션 시작 시* 자동 `git fetch + pull --rebase` 실행
- *분기 감지* (다른 PC 에서 push 한 commit + 내 local commit) 시 ⚠ 경고 + 사장님 결정 대기
- 사장님 *수동 명령 불필요* — Claude 가 자동 시작

**종료 트리거 (자동)**:
- Claude Code Stop hook (`~/.claude/hooks/git-status-warn.sh` — 글로벌, 모든 프로젝트 일반 적용) 가 *응답 마무리 시점* 미커밋 / 미푸시 한 줄 경고
- 별관 워크트리 미머지도 같이 알림
- 사장님 *깜빡 push 안 한 채* PC 끄는 사고 차단

**push 직전 검증 (자동)**:
- Claude Code PreToolUse hook (`.claude/hooks/pre-push-check.sh` — **프로젝트 안, git tracked**) 가 `git push` 명령 직전 자동 `git fetch` + non-fast-forward 검증
- 분기 시 push 차단 (exit 2) + 해결 순서 안내
- 사장님 의도적 force 면 `--force` / `--force-with-lease` 명시 → 통과

**hook 두 PC 자동 적용**:
- 프로젝트 안 `.claude/hooks/` + `.claude/settings.json` 이 *git tracked* — 사장님 맥북에서 `git pull` 만 하면 자동 동일 hook 적용
- `~/.claude/settings.json` 에는 *Stop hook 만* 등록 (다른 프로젝트에 일반 적용)
- 프로젝트 settings 가 *프로젝트 cwd 기준* SessionStart + PreToolUse 단일 진실 — 두 PC 환경 완전 일치

**remote 정책**:
- `origin` = GitHub 단일 push (단일 진실 소스)
- `nas` = Z:/git/MyPos_SDK54.git (수동 백업 — 자동 sync 안 함)
- NAS 는 *secrets/EAS state 동기화* 만 의도된 역할 — git mirror 는 부수효과로 제거 (2026-05-24)

---

## 6. 세션 마무리 챙김

작업 단위가 마무리되거나 사장님이 다음 주제로 넘어갈 때 다음을 챙긴다.

| # | 항목 | 트리거 / 방법 |
|---|---|---|
| 1 | **깃 저장 확인** | `git status` 로 미커밋/미푸시 체크 → "이거 깃허브에 올릴까요?" 한 줄 |
| 2 | **머지 확인** | `git worktree list` 결과가 1개 초과면 "별관 N개 남아있는데 머지하실 건가요?" |
| 3 | **학습 노트 제안** | 새 개념/환경 셋업/큰 마일스톤/디버깅 흐름 끝났으면 "오늘 학습 노트 만들까요?" |
| 4 | **용어 정리 제안** | 처음 접한 용어 3개 이상이거나 새 시스템 배웠으면 "용어 정리해드릴까요?" |
| 5 | **세션 Q&A 정리** | 사장님이 **"세션 정리"** 라고 말하면 자동 실행 (아래 참조) |

### "세션 정리" 명령 자동 동작

사장님이 다음 마무리 표현 중 하나를 쓰면 (또는 기술 결정 3개 이상 + 세션 마무리 시):

- "세션 정리"
- "세션 종료"
- "모두 저장"
- "오늘 끝" / "오늘 정리"
- 비슷한 마무리 표현 (의도가 명확하면 동의어로 인정)

**장소(PC) 무관 동일 동작** — 매장 맥북이든 집 윈도우 PC든 동일하게 진행. 푸시까지 반드시 완료해서 다음 PC 가 풀로 자연스럽게 이어받게. (사장님 동선이 매장 ↔ 집 양쪽이라 한쪽에서 푸시 안 하면 다음 PC 미동기화.)

1. 오늘 다룬 이슈/작업 목록 한 줄씩 나열 + 추천 세션 이름 제공
2. `docs/sessions/YYYY-MM-DD-<주제>.md` 생성:
   - **상단**: 질문 번호 + 핵심 답/결정 한 줄 (Q&A 페어)
   - **하단**: 단계별 진행 흐름 (커밋 포함) + 다음 체크리스트
3. `docs/sessions/README.md` 없으면 자동 생성, 있으면 "세션 목록" 표에 한 줄 추가
4. `git add + commit + push` — 워크트리면 main 머지 포함. **푸시 단계 빼먹지 말 것** (커밋만 하고 끝내면 다른 PC 가 못 받아감).

### "종료" 명령 자동 동작 — 풀세트 (모든 기기 정상 작동까지)

사장님이 **"종료"** 라고 하면 위 "세션 정리" 4단계의 **상위 집합** 실행. 단순 git sync 가 아니라 **사장님이 만지는 모든 기기 (매장 카운터 PC / 매장 폰 웹 / 사장님 PC / 폰 네이티브 / Electron .exe) 가 새 코드로 정상 동작하는 상태까지** 보장.

#### 8단계 (앞 4단계는 "세션 정리" 와 동일)

1. 오늘 다룬 이슈/작업 + 추천 세션 이름
2. `docs/sessions/YYYY-MM-DD-<주제>.md` 생성
3. `docs/sessions/README.md` 갱신
4. `git pull --rebase` (충돌 발견 시 사장님 알림 + abort) → `git add + commit + push` (워크트리면 main 머지 포함)
5. **`npm test`** — 1개라도 실패하면 다음 단계 abort, 사장님 보고
6. **`npm run deploy:web`** — Cloudflare 라이브 URL 즉시 갱신. 매장 카운터 PC + 사장님 폰 웹 + PWA 모두 새 코드. (스크립트가 firebase API key inline 자동 검증.)
7. **`eas update --branch production --message "<주제>"`** — 네이티브 폰(iOS/Android) OTA. **단, native 변경 감지 시 skip + 사장님 안내** ("새 EAS 빌드 필요").
   - native 변경 감지 기준: `app.json` plugins / runtimeVersion / version, `package.json` 의 native dep (expo-*, react-native-*, @sentry/react-native 등), `ios/` `android/` 폴더, `metro.config.js` 의 native 분기.
8. **`npx electron-builder --config electron/builder.config.js --publish always`** — Electron .exe GitHub Releases 자동 업로드, 매장 PC 자동 업데이트. **단, `package.json` 의 version 이 직전 release 와 같으면 skip + 사장님 안내** ("version 올려야 publish 가능"). `GH_TOKEN` 미설정 시도 skip + 안내.

#### 안전 정책

- **각 단계 실패 시 다음 자동 진행 X** — 사장님 보고 후 결정. 운영 중 매장에 망가진 코드 배포되는 사고 방지.
- **단계 5–8 은 사장님이 명시적으로 "종료" 라고 했을 때만**. 일반 "세션 종료" / "모두 저장" 은 4단계로 끝.
- **장소(PC) 무관 동일** — 맥북이든 윈도우든 같은 8단계. 단 EAS / Electron publish 는 환경변수(EXPO_TOKEN, GH_TOKEN) 가 있는 PC 에서만 가능 → 없으면 skip + 안내.
- **deploy:web 의 grep 검증** 은 절대 우회 X (firebase API key inline 누락 사고 방지).

### 저장 위치 패턴

| 종류 | 위치 |
|---|---|
| 학습 노트 | `docs/learning/YYYY-MM-DD-<주제>.md` |
| 세션 Q&A | `docs/sessions/YYYY-MM-DD-<주제>.md` |
| 협업 규칙 (이 파일) | `docs/collaboration-rules.md` |
| 운영 매뉴얼 | `docs/operations-manual.md` |

---

## 7. 새 프로젝트 / 새 분야 받았을 때 — 가이드 응답 프로토콜

사장님이 새 프로젝트나 새 분야 계획을 알려주면 (예: "Tekla 플러그인 만들거야", "AutoCAD 자동화 도구"), **유능한 선생님 모드** 로 다음 7항목을 한 번에 정리해서 제안한다.

### 7항목 체크리스트

| # | 항목 | 내용 |
|---|---|---|
| 1 | **권장 스택 + 근거** | 도메인에 가장 자연스러운 언어/프레임워크/도구. 후보 비교 짧게. |
| 2 | **환경 셋업** | IDE, SDK / 런타임 설치, 환경변수 / 라이센스 주의사항 |
| 3 | **추천 확장 / 도구** | IDE 확장, 디버깅/포맷터/프로파일러/자동완성 |
| 4 | **도메인 특유의 함정** | 처음 사람이 발 빠지는 곳 (Tekla PluginDLL 경로, AutoCAD NETLOAD, RN Metro 캐시, 웹 CORS 등) |
| 5 | **첫 단계 (Hello World)** | 30분~1시간 안에 손에 잡히는 결과물. "빈 폼 + 버튼 한 개" 수준 |
| 6 | **버전관리 / 협업 / 배포** | 깃허브 패턴, `.gitignore` 필수 항목, 배포·설치 패턴 |
| 7 | **학습 경로 (단계 분할)** | 4~6 단계. 각 단계마다 "끝났다는 기준" 명확히 |

### 응답 톤

- **선생님 모드**: 익숙한 분야는 짧게, 새 분야는 데스크톱 개발 비유로 풀어서.
- 권유 X, 강요 X. "이게 정답" 보다 "이게 가장 자연스러운 출발점, 이유는 이거" 식.
- 사장님 본인 강점 (Tekla / AutoCAD / C# / .NET / COM Interop) 은 자산으로 인정 + 새 영역을 그 위에 얹는 식.

### 도메인별 빠른 참고

#### Tekla Structures 플러그인
- 스택: **C# / .NET Framework 4.8** (Tekla 버전에 맞춤)
- IDE: Visual Studio Community / Rider
- SDK: Tekla Open API (`Tekla.Structures.Model`, `Tekla.Structures.Drawing`)
- 함정:
  - PluginDLL 경로 (`~/Tekla/<version>/PluginDLL`)
  - Tekla 버전별 어셈블리 차이
  - Catalog item / 매크로 등록 누락
- `.gitignore`: `bin/`, `obj/`, `.vs/`, `*.user`, `packages/`

#### AutoCAD 자동화
- 본격 → **C# / .NET (AutoCAD .NET API)**
- 단발 → **Python + pyautocad / pythoncom**
- 함정:
  - `NETLOAD` 명령으로 DLL 로드
  - 32비트 vs 64비트 AutoCAD 일치
  - `acmgd.dll` 의 `Copy Local = False`

#### React Native / Expo (모바일)
- 함정: Metro 캐시, native 모듈 web 미지원, EAS 빌드 secret 관리, 화면 방향 / SafeArea
- 자세한 가이드: 각 프로젝트의 `CLAUDE.md`

#### 웹 (React / Next.js / Vite)
- 함정: CORS, 환경변수 client/server 분리, 빌드 산출물 ↔ 정적 호스팅 매핑

---

## 8. 초보자 대응 (잊을만한 것 미리 짚기)

사장님 직접 요청: "정말 아무것도 모르는 수준이니 잊을 만한 것 미리 짚어줘"

매 응답 작성 시 다음을 한 줄로 선제 안내(상황에 해당될 때만):

- **add → commit → push 3단계** — commit 만 하고 push 안 한 채 "끝났다" 고 생각하기 쉬움.
- **워크트리 머지** — 별관 작업 끝내고 본관에 머지 안 하면 별관 누적.
- **현재 위치 확인** — 새 작업 시작 시 어느 브랜치 / 워크트리 / 폴더에 있는지 먼저.
- **로컬 빌드 vs 라이브 갱신** — 코드 수정 후 라이브 URL 보려면 빌드 + 배포까지. 깃 푸시만으론 부족.
- **학습 노트 누적** — 의미 있는 작업 끝마다 한 페이지씩 누적이 복습에 가장 효과적.

### 안내 방식

- 강요 X — "이거 안 하면 큰일나요" 톤 X.
- 짧게 한 줄 — 본 작업 답변에 끼워넣거나 끝에 한 줄 덧붙임.
- 비유 활용 — Tekla / AutoCAD / C# 데스크톱 개념으로 매핑.
- 사장님이 거부하면 즉시 수용.
- **같은 세션 안에서 반복 안내 금지** — 한 번 짚었으면 그 세션엔 충분.

---

## 9. 사장님 프로필 (참고)

- **본업**: Tekla Structures 의 Third-party 개발 + AutoCAD 자동화 (C# / .NET / COM Interop)
- **MyPos 프로젝트 역할**: 매장 사장 = 개발자 = 운영자 = 사용자 본인 (모두 같은 사람)
- **Claude Code 와 협업 시 새로 배우는 영역**: React Native, 웹, Git, 클라우드 호스팅(Firebase / Cloudflare), Electron

---

## 10. 누적된 운영 교훈 (이 프로젝트 = MyPos_SDK54 한정)

매장 운영 + 배포 + 진단 과정에서 사고를 통해 배운 것들. 메모리에 누적되어 있음.

### 배포 / 운영

#### `deploy:web` 마다 PC 연동 풀림 사고 — 절대 반복 금지
- Cloudflare 배포 시 Service Worker 갱신이 매장 세션 끊은 적 있음
- 영업 중단으로 이어진 사고
- **다음 세션 최우선 조사 항목** (만약 재발 시)

#### 매장 배포 흐름 — 2단계 표준 명령
- **"테스트해볼게"** → 모든 준비 끝난 후에만 (사장님이 직접 라이브 URL 검증)
- **"테스트하세요"** 또는 **"정식 배포"** → main 머지 + publish 자동 실행

### 진단 우선순위

#### PC 동기화 신고 받으면 — 콘솔/번들 해시 먼저
- 자기 복구 안내 전, 무조건:
  1. F12 콘솔 확인
  2. script 해시 비교
- 그 후에 처방

#### 폰 크래시 진단 — 메모리 / CLAUDE.md 먼저
- Sentry 스택은 결과만 보여줌 (원인 X)
- 기존 처방 패턴부터 grep
- **대표폰 데이터 초기화는 절대 권하지 말 것** (사장님 데이터 날아감)

### 미리보기

- 미리보기 사이즈 **항상 iPhone 15 Pro Max 가로 932×430 으로 고정**
- 세션 시작 시 expo-web preview 서버 자동 띄움 (첫 응답 전)

### 외부 작업 자동화

- **GitHub 토큰 발급 / 클라우드 콘솔 / OAuth** 같이 사용자 웹 작업 필요할 때:
  - "제가 Chrome 자동화로 할까요?" 먼저 묻기
  - 자동화 가능하면 사장님 시간 절약

### 세션 종료 시

- 다룬 이슈 짧게 나열 + 추천 세션 이름 제공
- "세션 정리" 명령 받으면 위 6번 자동 동작 실행

### 비밀값 / 환경 셋업 — NAS 공유 (윈도우 ↔ 맥북)

`.env` (Firebase / 카카오 / Azure TTS 키) 와 EAS 로그인 토큰은 `.gitignore` 로 깃에서 빠진다 — 의도된 동작 (비밀값 외부 노출 방지). 두 PC 가 같은 비밀값을 보도록 NAS(Network Attached Storage, 사장님 본인 저장소) 를 단일 진실 소스(single source of truth)로 사용한다.

#### 구조

```
<NAS 마운트 경로>/secrets/mypos/
  ├─ .env              ← 두 PC 의 프로젝트 루트 .env 와 동기화
  ├─ expo-state.json   ← 두 PC 의 ~/.expo/state.json 과 동기화 (EAS 로그인)
  └─ README.txt        ← 첫 동기화 시 자동 생성
```

#### 신규 PC 셋업 절차

1. NAS 의 `secrets/mypos/` 폴더를 PC 에 마운트 (네트워크 드라이브 / SMB / AFP).
2. 환경변수 `MYPOS_NAS_SECRETS` 에 그 경로 등록.
   - 윈도우: `setx MYPOS_NAS_SECRETS "Z:\secrets\mypos"` 후 PowerShell 재시작
   - 맥북: `~/.zshrc` 에 `export MYPOS_NAS_SECRETS="/Volumes/secrets/mypos"` 추가 후 `source ~/.zshrc`
3. `git clone <repo>` + `npm install`
4. `npm run secrets:sync` → NAS 의 `.env` / EAS state 자동 pull
5. `npm start` 또는 `npm run deploy:web` — 이후 자동 sync

#### 자동 동기화 트리거

| 명령 | 동작 |
|---|---|
| `npm start` | prestart hook 으로 자동 sync (NAS ↔ 로컬 mtime 비교) |
| `npm run deploy:web` | deploy-web.sh 0/4 단계에서 자동 sync (배포 직전 NAS 최신 반영) |
| `npm run secrets:sync` | 수동 양방향 sync |
| `npm run secrets:push` | 로컬 → NAS 강제 push (키 회전 직후 즉시 다른 PC 반영하고 싶을 때) |

#### 키 회전 (Kakao / Firebase / Azure 키 갱신) 워크플로우

1. 발급 콘솔(카카오/Firebase/Azure) 에서 새 키 발급
2. 어느 한 PC 의 로컬 `.env` 수정
3. `npm run secrets:push` — NAS 즉시 갱신
4. 다른 PC 는 다음 `npm start` 또는 `npm run secrets:sync` 시 자동 pull

#### 안전 정책 (영업 안 멎게)

- NAS 미마운트 / 환경변수 미설정 → **silent skip**. 로컬 `.env` 만 있어도 모든 명령 정상.
- mtime 차이 1초 이내 + 내용 다름 → 안전상 skip (사용자가 명시적 push/sync 결정)
- NAS 가 더 최신이라 로컬 덮어쓸 때 → `.env.bak.<timestamp>` 백업 자동 생성
- NAS 는 절대 깃에 안 올라감 (NAS 폴더 자체가 리포 밖)

#### 트러블슈팅

- **"NAS 미설정 — skip" 메시지**: 환경변수 안 박혔거나 마운트 끊김. 위 셋업 2번 다시 확인.
- **카카오 / Firebase 키 없다는 에러**: NAS 의 `.env` 가 비어있거나 sync 안 됨. `npm run secrets:sync` 수동 실행 후 출력 확인.
- **EAS "토큰 없음"**: `eas login` 후 `npm run secrets:push` 한 번 — 다른 PC 가 다음 sync 때 받음.
- **NAS 외부 노출 위험**: Synology QuickConnect / QNAP myQNAPcloud 등 외부 접근 활성화돼 있고 NAS 관리자 비번이 약하면 비밀값 유출. 강력한 비번 + 2FA 필수.

---

## 11. 메모리 시스템 운영 원칙

Claude 의 메모리는 `~/.claude/projects/<프로젝트>/memory/` 에 저장됨. 다음 원칙 따른다.

### 저장하는 것

| 타입 | 언제 저장 | 예시 |
|---|---|---|
| `user` | 사장님의 역할/선호/지식 알게 됐을 때 | "사용자 = 매장 사장 = 개발자 본인" |
| `feedback` | 사장님이 교정/확인 줬을 때 | "deploy:web 마다 PC 연동 풀림 — 절대 반복 금지" |
| `project` | 진행 중 의사결정/계획/제약 | "KIS 카드 단말기 연동 보류" |
| `reference` | 외부 시스템 위치 | "Cloudflare 라이브 URL, GitHub 리포 URL" |

### 저장하지 않는 것

- 코드 패턴 / 컨벤션 / 아키텍처 (코드 읽으면 알 수 있음)
- Git 히스토리 / 누가 뭐 바꿨는지 (`git log` / `git blame` 이 진실)
- 디버깅 해결책 / 픽스 레시피 (코드와 커밋 메시지에 있음)
- `CLAUDE.md` 에 이미 문서화된 것

### 인덱스 파일

- `MEMORY.md` 가 인덱스. 한 줄 = 한 메모리 (`- [제목](파일.md) — 한줄 훅`)
- 200줄 넘으면 잘리니까 간결하게 유지

---

## 12. 이 문서 갱신 정책

- 새 협업 규칙 / 톤 / 워크플로우가 합의되면 이 파일에 반영
- 변경 시 커밋 메시지: `docs(collab): <변경 내용>` 패턴
- 글로벌 `~/.claude/CLAUDE.md` 와 이 문서가 어긋나면 **글로벌 CLAUDE.md 가 진실** (실제 Claude 가 읽는 파일이라서). 이 문서는 백업 / 공유용.
