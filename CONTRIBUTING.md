# Pwh에 기여하기

기관의 HWPX 양식을 최대한 보존하고, 미리보기 주석으로 문서를 고치는 작업을 개선하는 기여를 환영합니다.

## 개발 환경

Node.js 22.12+ LTS 또는 24 이상과 Python 3.11 이상을 사용합니다. 기본 테스트에는 외부 Node 패키지 설치나 기관 원본 문서가 필요하지 않습니다.

```sh
node --test
```

기본 시험의 건너뜀은 통과로 계산하지 않습니다. 실제 엔진·화면 시험은 **전체 저장소 checkout**에서 별도 실행합니다. Python이 여러 개이면 `PWH_PYTHON_PATH`를 지정합니다.

```powershell
$env:PWH_RUNTIME_ROOT = Join-Path $env:TEMP 'pwh-test-runtime'
node scripts/setup.mjs --runtime-root $env:PWH_RUNTIME_ROOT
node scripts/run-ci-tests.mjs core
```

브라우저 시험은 Playwright 1.62.1과 Chromium을 준비하고 `PWH_PLAYWRIGHT_MODULE`에 `playwright/index.mjs`의 file URL을 지정한 뒤 `node scripts/run-ci-tests.mjs browser`로 실행합니다. 정확한 설치 명령은 [CI 설정](.github/workflows/test.yml)에 있습니다. 실행기는 합성 HWP와 별도 Desktop 프로필을 만들고 전체 시험을 자동 발견합니다. 계정·실문서·운영체제 클립보드·네이티브 창 시험은 일괄 활성화하지 않으며, 그 시험의 제외 이유를 출력합니다. CI가 준비한 엔진·브라우저 조건이 빠져 시험을 건너뛰면 실패로 처리합니다.

### 편집기 재빌드와 입력 검사

```powershell
node scripts/verify-editor-build.mjs --write
node scripts/verify-editor-build.mjs
node scripts/verify-editor-build.mjs --check-inputs
node desktop/verify-source.mjs
```

Windows x64의 고정 입력·의존성 ZIP을 해시로 확인하고 서로 다른 두 폴더에서 공통·Desktop을 빌드합니다. `--write`만 저장소의 두 번들과 manifest를 갱신하며, 기본 실행은 커밋된 산출물과 비교합니다. `--check-inputs`는 다운로드 없이 현재 소스 지문과 산출물 해시를 확인합니다. `--cache-dir`로 검증된 다운로드 캐시를 재사용할 수 있습니다. Desktop 소스 변경 후에는 `desktop/source-manifest.json`의 해당 파일 크기·SHA256도 갱신합니다.

소스 지문은 `src`의 JavaScript·TypeScript·CSS와 빌드 스크립트를 보수적으로 포함합니다. Desktop은 전용 어댑터와 빌더도 포함합니다. 생성한 `editor.js`나 해시만 손으로 고쳐 검사를 통과시키지 않습니다. `.editorconfig`와 `.gitattributes`를 따르며, 보존 패치와 Desktop 파일의 문맥·바이트를 일괄 포맷하지 않습니다.

기존 네이티브 CLI 통합 시험은 `PWH_ENGINE_TESTS=1`, 승인한 개인 문서 조회는 `PWH_TEMPLATE_TEST_FILE`로 별도 실행합니다. 시험 문서는 Git에 추가하지 않습니다.

## 변경 기준

- 원본·기존 출력 파일을 덮어쓰지 않습니다. 예상 원본 해시와 편집 상태 충돌 방지를 유지합니다.
- 빈 문단, 조판부호, 알 수 없는 XML 노드를 내용이 없다는 이유로 제거하지 않습니다.
- XML 원문 패치와 엔진의 전체 재직렬화는 구분합니다.
- 화면을 보고 확인한 결과와 파서·저장 테스트 결과를 구분해서 보고합니다.
- 글꼴 대체, 서식 지원의 제한이나 좌표 변환의 불확실성을 숨기지 않습니다.
- stdout은 MCP 프로토콜에만 사용하고 진단은 stderr에 씁니다.
- 오류의 발생 위치를 rhwp 원천 코어, Pwh 공통 편집기·연결, Pwh Desktop 전용 호스트로 구분합니다. 원본 Studio에서 이어받은 코드의 문제와 Pwh에서 추가한 코드의 문제도 구별하고, 확인한 사실과 추정은 따로 보고합니다.
- rhwp 코어·Studio 변경이나 기준 버전 업데이트에는 README의 엔진 보완 요약, [원본 대비 차이](docs/RHWP-DIFFERENCES.md), 관련 패치 README와 변경 이력을 함께 갱신합니다. 고정 원본·런타임·적용 경로·회귀 검증 범위를 기록하고, 상세 계측 자료는 별도 기술 문서로 연결합니다.

버그를 제보할 때에는 버전·운영체제·재현 순서와 기대 결과를 적어 주세요. 가능하면 개인정보와 기관 자료를 제거한 최소 합성 HWPX를 사용합니다. 외부 문서·로고·상용 글꼴을 허가 없이 올리지 않습니다. 편집 세션 토큰, 로컬 개인 경로, live-session.json도 공개하지 않습니다.

조판·HWP/HWPX 파서 자체의 문제는 rhwp upstream의 문제일 수 있습니다. pwh의 양식 보존 패치·호스트 연결·주석 처리 문제와 구분해서 분석하고, upstream 수정이 필요하면 해당 프로젝트의 기여 지침을 따릅니다.
