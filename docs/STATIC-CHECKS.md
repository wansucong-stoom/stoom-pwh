# 정적 검사와 적용 범위

이 검사는 **Pwh 공통 편집기·연결 및 Desktop의 개발·빌드 계층**에 적용합니다. rhwp Rust 조판 알고리즘을 변경하는 작업과 구분합니다.

## 실행

개발 도구에는 Node.js 24 이상을 사용합니다. 일반 Pwh 실행과 기본 `node --test`에는 이 도구 설치가 필요하지 않습니다.

```sh
npm ci --prefix tools/quality --ignore-scripts --no-audit --no-fund
npm run lint
node tools/quality/check-rules.mjs
```

패치한 Studio 소스와 보존한 의존성이 준비되어 있으면 다음과 같이 검사합니다. 경로는 `src/main.ts`가 있는 `rhwp-studio` 폴더입니다.

```powershell
npm run typecheck -- --studio 'D:/build/pwh-build/rhwp-studio'
```

Windows x64에서 입력 복원·공통/전용 재빌드·타입 검사·산출물 비교를 함께 실행할 수 있습니다.

```sh
node scripts/verify-editor-build.mjs --typecheck
```

전체 저장소 checkout을 기준으로 합니다. 사용자 설치판의 파일이나 실문서를 검사·변경하지 않습니다. 검사 도구는 별도 `tools/quality/package-lock.json`으로 고정하며 앱의 실행 의존성이나 MSI에 포함하지 않습니다.

## 검사 대상

- **JavaScript:** Pwh 소스, 빌드 스크립트, Desktop·Electron 호스트, 테스트, 검사 도구의 작성 소스에 ESLint를 적용합니다. Node·브라우저·CommonJS 환경을 구분합니다. Playwright의 페이지 평가 함수는 브라우저 전역을 함께 허용합니다.
- **연결된 호스트:** `inline-host.js`가 사용하는 복구·글꼴·요청 상태 함수는 별도 허용 목록으로 숨기지 않습니다. 실제 HTML 조립 함수의 classic script를 추출해 선언과 사용을 함께 검사합니다.
- **TypeScript:** Pwh가 추가한 10개 어댑터를 포함해 **패치 적용 후 전체 Studio TypeScript 소스**를 `strict`·`noEmit`으로 검사합니다. 실제 Studio와 WASM 선언을 해석하며 별칭과 Chrome 확장 API 타입을 준비합니다. 비활성 HwpCtrl 플러그인에는 기존 `StudioPlugin` 인터페이스의 선언만 제공합니다.
- **검사기의 거부 확인:** 잘못된 Node/브라우저 전역, Electron의 미정의 함수와 실제 연결 호스트의 글꼴 함수 오타를 의도적으로 넣은 메모리 사본이 거부되는지 확인합니다.

브라우저 시험 실행기는 문서·서버를 만들기 전에 지정한 실행 파일 또는 Playwright의 기본 Chromium이 있는지 확인합니다. `PWH_BROWSER_EXECUTABLE`이 잘못되었거나 브라우저를 설치하지 않았다면 즉시 실패해, 초기화 실패 후 열린 시험 서버 때문에 대기하는 상황을 줄입니다.

생성된 편집기 번들, 보존한 vendor 및 과거 ZIP에는 작성 소스 린트를 적용하지 않습니다. 번들은 별도의 해시·재빌드 비교로 확인합니다.

## 기존 코드에 맞춘 기준

HWP·파일명 검증의 C0 제어문자 정규식과 공개 오류 메시지의 의도적인 번역·정제는 그대로 유지합니다. 비어 있는 `catch`는 허용하되 다른 빈 블록은 검사합니다. 정리 작업의 경로 검증은 `finally` 안에서도 실패해야 하므로 해당 세 줄에만 사유를 명시했습니다. 사용하지 않는 코드의 일괄 제거와 전체 포맷 변경은 이 검사에 포함하지 않습니다.

타입 불일치는 캐시 매개변수의 JSDoc, 일반 ArrayBuffer 이미지 바이트, 크기 확인 직후의 Map 첫 키, 검증된 색상 목록과 여백 키, 비활성 렌더러 및 호스트 로드 함수의 선언으로 보완했습니다. 이 항목을 사용자 화면에서 재현된 버그로 분류하지 않습니다.

## 한계

기존 `any` 경계는 남아 있으므로 엄격한 컴파일을 통과해도 모든 WASM 호출과 런타임 JSON의 형태가 증명되는 것은 아닙니다. JavaScript 전체의 타입 검사는 켜지 않으며, HTML 문자열 안의 모든 스크립트를 정적으로 해석하지도 않습니다. 이번 호스트 연결 검사 외의 생성 화면은 기존 브라우저 회귀 검사로 확인합니다.

검사 설정과 타입 선언을 변경하면 실제 재빌드 및 기존 동작 검증도 함께 수행합니다. 린트·컴파일 성공만으로 조판 일치나 실제 클립보드 동작이 검증되었다고 보고하지 않습니다.

규칙 동작은 [ESLint 환경 설정](https://eslint.org/docs/latest/use/configure/language-options), 컴파일 옵션은 [TypeScript TSConfig](https://www.typescriptlang.org/tsconfig/)를 참고하세요.
