# pwh

**rhwp 기반 HWPX 양식 작성·수정용 AI 플러그인.**

pwh의 목적은 두 가지입니다.

1. **미리보기의 주석으로 협업하기** — 문서를 보며 수정할 곳을 가리키고 요청하면, AI가 실제 HWPX를 수정한 뒤 새 미리보기로 확인합니다.
2. **기관의 한글 문서 양식을 최대한 보존하고 활용하기** — 기존 글자·문단 서식, 표·병합 셀, 여백과 조판 개체를 읽고, 그 편집틀에 맞춰 내용을 작성합니다.

프로젝트·플러그인·스킬·MCP 서비스 이름은 모두 **pwh**입니다. GitHub 저장소 이름은 `stoom-pwh`입니다.

> **개발 중인 0.2.0 버전입니다.** 문서를 생성하고 다시 여는 것과 한컴 한글 화면에 정확히 일치하는 것은 다릅니다. 글꼴, 줄간격, 개체 배치와 쪽 나눔의 시각적 일치는 별도 검수가 필요합니다. 모든 기관 양식의 자동 완성을 보장하지 않습니다.

## 무엇을 연결하나요?

| 구성 | 역할 |
| --- | --- |
| Codex의 AI와 브라우저 | 자연어 요청 해석, 문서 검토, 지원되는 브라우저의 영역 주석 전달 |
| pwh 스킬·MCP·로컬 서비스 | 양식 구조 분석, 원본을 보존하는 편집, 현재 문서 상태 확인, 수정본 저장과 미리보기 연결 |
| [rhwp](https://github.com/edwardkim/rhwp) 0.8.7 | HWP/HWPX 읽기·쓰기, 조판, Studio 편집기와 편집 API |

pwh는 rhwp에 의존합니다. rhwp도 자체 MCP와 편집 API를 제공하므로, AI가 rhwp를 직접 사용해 문서를 만드는 작업도 가능합니다. pwh는 그 위에 **양식 보존과 주석 수정의 반복 작업 흐름**을 묶습니다. HOP는 초기 조사에서 참고한 rhwp 기반 앱이며 설치 필수 구성요소가 아닙니다.

별도 AI 모델이나 API 키를 포함하지 않습니다. 연결한 AI 호스트가 내용 작성과 양식의 의미 판단을 담당합니다. ChatGPT 웹이나 모바일만으로 로컬 프로세스를 실행하는 패키지가 아닙니다.

## 주석으로 협업하는 방법

1. 기관의 HWPX 양식과 작성할 자료를 AI에 제공합니다.
2. AI가 문단·표·서식을 분석하고, 기존 양식을 활용한 **새 HWPX**를 만듭니다.
3. 실제 저장 파일을 조판한 미리보기를 브라우저 패널에서 확인합니다.
4. 호스트가 지원하면 영역에 주석을 달아 “이 위치에 로고를 넣어 줘”, “이 문단을 두 줄로 줄여 줘”처럼 요청합니다.
5. AI가 주석의 화면 위치와 문서 구조를 대조해 수정한 뒤, 새 HWPX와 미리보기를 제공합니다.

주석을 그려 채팅으로 보내는 기능은 **호스트 브라우저의 기능**입니다. pwh가 독립 주석 서비스를 제공하는 것은 아닙니다. 주석을 받은 AI가 pwh 도구로 수정 작업을 수행합니다. 주석 좌표에서 모든 HWPX 개체 주소를 자동 확정하는 기능은 아직 구현되지 않았습니다.

편집기에서 직접 고쳐야 할 때에는 로컬 rhwp Studio를 사용할 수 있습니다. AI는 같은 Studio의 미저장 본문·선택·상태를 읽고 수정할 수 있습니다. 공유 문서는 하나의 로컬 편집 인스턴스이며, 여러 사용자가 동시에 접속하는 공동 편집 서비스는 아닙니다.

## 양식을 어떻게 보존하나요?

HWPX는 ZIP 안의 XML·이미지·서식 정의로 구성됩니다. 텍스트뿐 아니라 구역, 단, 표, 그림, 앵커, 글자처럼 취급 여부, 셀 병합과 쪽 나눔을 함께 다뤄야 합니다. 화면의 `[표]` 조판부호는 표 개체의 표식입니다.

pwh의 양식 분석 도구는 글자·문단 서식 ID, 스타일, 용지·여백, 중첩 표와 셀 주소를 읽습니다. 평문 작성란을 채우는 경로는 원본 XML의 필요한 부분만 바꾸며, 다른 ZIP 항목과 기존 서식 정의를 보존합니다. 조판 개체가 섞인 문단·셀 전체를 평문으로 덮는 변경은 거절합니다. 안전한 텍스트 말단만 수정하는 경로도 제공합니다.

원본 SHA256과 선택적으로 수정 전 텍스트를 대조하고, 기존 출력 파일을 덮어쓰지 않습니다. 저장된 줄 배치 캐시를 제거할 수 있지만, 그것만으로 올바른 재조판을 보장하지는 않습니다. 네이티브 엔진으로 전체 문서를 다시 저장하는 경로는 원본 XML의 바이트 보존 경로와 구분해야 합니다.

“어느 기관의 자료든 양식에 맞춰 완성한다”는 목표를 향해 개발 중이며, 현재 구현 범위와 검수 결과를 넘어서 충실도를 보장하지 않습니다.

## 설치

**권장 설치 방법은 아래의 Git clone → 런타임 준비 → 마켓플레이스 등록입니다.**

별도로 **[pwh 0.2.0 플러그인 소스 ZIP](https://github.com/wansucong-stoom/stoom-pwh/raw/refs/heads/main/releases/pwh-0.2.0.zip)**도 제공합니다. 압축 안의 `pwh/`가 플러그인 루트이며 패키지 직접 등록·개발용입니다. 이 ZIP은 플러그인 단독 패키지 규칙에 따라 마켓플레이스 카탈로그와 실행 엔진을 포함하지 않습니다. 아래의 `marketplace add .` 설치를 하려면 ZIP 대신 Git clone으로 받은 저장소를 사용하세요.

### 요구사항

- **Windows x64**: 설치 스크립트가 지원하는 플랫폼
- Node.js **22.12 이상**과 npm, Git
- Python **3.11 이상**: HWPX XML 분석과 양식 보존 편집에 사용
- 로컬 플러그인·MCP 실행을 지원하는 Codex 호스트

저장소에는 문서, 글꼴 바이너리, rhwp 실행파일과 Studio 배포물을 포함하지 않습니다. 최초 준비 과정에는 공식 GitHub·npm 다운로드가 필요합니다. 설치 후 로컬 문서 처리는 외부 문서 업로드 없이 수행됩니다. 연결된 AI 호스트에 전달하는 본문·이미지·주석은 해당 호스트의 데이터 처리 정책을 따릅니다.

### 1. 엔진과 편집기 준비

```powershell
git clone https://github.com/wansucong-stoom/stoom-pwh.git
cd stoom-pwh
node scripts/setup.mjs
```

setup은 고정한 rhwp 0.8.7과 공식 core/editor 패키지로 로컬 편집기를 준비합니다. Windows 실행파일 ZIP의 SHA256과 npm 패키지 무결성을 확인하며, 기존 파일을 임의로 덮어쓰지 않습니다. GitHub와 npm의 설치 의존성은 내려받아 빌드합니다.

선택적으로 네이버 나눔 글꼴을 함께 준비할 수 있습니다. 공식 전체 ZIP 다운로드가 약 131MB입니다.

```powershell
node scripts/setup.mjs --with-nanum
```

설치 계획만 확인하려면 `node scripts/setup.mjs --dry-run`을 사용합니다. 상세 옵션은 `--help`로 확인합니다. 기본 런타임과 생성 문서는 `~/.stoom-pwh/`에 보관되며, `PWH_RUNTIME_ROOT`로 변경할 수 있습니다.

### 2. pwh 플러그인 설치

이 저장소에는 pwh 한 개를 제공하는 로컬 마켓플레이스 선언이 있습니다.

```powershell
codex plugin marketplace add .
codex plugin add pwh@pwh
```

호스트의 Plugins 화면에서 해당 로컬 소스의 **pwh**를 설치하는 방식도 사용할 수 있습니다. 설치 후 새 채팅에서 pwh를 선택하고 “조판 엔진 상태를 확인해 줘”로 연결을 확인하세요. 설치된 Codex 버전에 따라 CLI·화면 지원이 다를 수 있습니다. [공식 플러그인 패키징·설치 안내](https://developers.openai.com/plugins/build/plugins)를 참고하세요.

플러그인에 스킬과 MCP 설정이 함께 들어 있습니다. 각각 별도 설치할 필요는 없습니다. 단, 현재 버전은 **최초 런타임 준비 단계가 별도로 필요한 개발 배포본**입니다.

### 설정

공개 기본값은 `engine.config.json`, 예제는 `engine.config.example.json`입니다. 개인 설정은 Git에서 제외되는 `engine.config.local.json` 또는 `PWH_CONFIG`로 지정한 JSON 파일에 둡니다. 런타임의 `config.json`도 사용할 수 있습니다.

| 환경 변수 | 용도 |
| --- | --- |
| `PWH_RUNTIME_ROOT` | 실행파일·편집기·글꼴·출력의 기본 루트 |
| `PWH_CONFIG` | 명시적으로 사용할 개인 설정 JSON |
| `PWH_RHWP_PATH` | 기존 rhwp 실행파일 사용 |
| `PWH_PYTHON_PATH` | Python 실행파일 또는 명령 |
| `PWH_OUTPUT_ROOT` | 출력 문서·공유 세션 기록 위치 |
| `PWH_STUDIO_PATH`, `PWH_EDITOR_SDK_PATH` | 이미 준비한 Studio·SDK 위치 |
| `PWH_FONT_ROOT` | 글꼴 폴더 |

이전 개발본의 `HWPXYZ_*` 환경 변수는 호환용으로 일부 지원합니다. 새 설정에는 `PWH_*`를 사용합니다.

## 글꼴과 미리보기 정확도

문서에 선언된 글꼴이 없으면 대체 글꼴로 인해 글자 폭·줄바꿈·줄간격·쪽 나눔이 달라질 수 있습니다. 같은 이름으로만 대체하는 것은 충실도 검증이 아닙니다.

pwh는 선택한 로컬 글꼴의 실제 바이트를 Studio의 공개 font provider에 공급합니다. 화면 표시와 글자 폭 측정에 같은 바이트를 사용하도록 연결하고 SHA256을 확인합니다. 설치된 운영체제 글꼴이나 상용 글꼴은 재배포하지 않습니다. 필요한 글꼴은 사용자가 적법하게 준비해야 합니다. 나눔 글꼴을 쓸 때에는 [라이선스 고지](licenses/naver-nanum-OFL-1.1.txt)를 함께 유지합니다.

네이티브 PNG/PDF 조판과 Studio Canvas2D 표시는 다른 렌더 경로입니다. 폰트 catalog 등록 성공, 파일 열기 성공, 원본 서식 유지와 한컴 화면 일치는 각각 별도의 확인 사항입니다. **현재 한컴 한글과의 픽셀 단위·페이지 단위 동일성은 검증되지 않았습니다.**

## 도구와 개발

pwh MCP는 `pwh_*` 이름으로 도구를 제공합니다. 이전 개발본의 `hop_*` 호출은 호환 별칭으로만 허용합니다.

| 도구 | 용도 |
| --- | --- |
| `pwh_status`, `pwh_info` | 엔진 상태와 저장 파일 정보 |
| `pwh_template_inspect` | 양식 서식·문단·중첩 표 구조 분석 |
| `pwh_fill_form` | 원본 XML을 최대한 보존하는 문단·셀·텍스트 말단 수정 |
| `pwh_create_document`, `pwh_edit_template` | 새 문서 생성과 네이티브 파일 편집 |
| `pwh_preview` | 쪽별 PNG·HTML과 레이아웃 생성 |
| `pwh_live_open/read/commands/apply/save/status` | 실제 Studio 문서 열기·읽기·편집·저장 |
| `pwh_live_request` | 편집기 선택 문맥으로 작성한 수정 요청 조회 |

`rhwp-core` MCP는 rhwp가 제공하는 네이티브 도구를 그대로 연결합니다. 해당 도구 이름과 지원 범위는 rhwp의 계약을 따릅니다.

```powershell
node --test
npm run package
node src/cli.mjs status
node src/cli.mjs create examples/demo.json
node src/live.mjs serve C:/work/template.hwpx
```

기본 테스트는 공개 가능한 합성 양식을 사용합니다. 실제 조판 통합시험은 준비된 엔진으로 `PWH_ENGINE_TESTS=1`, 개인 기관 문서 조회 시험은 `PWH_TEMPLATE_TEST_FILE`을 명시해 선택 실행합니다. Python 경로가 여러 개이면 `PWH_PYTHON_PATH`를 지정하세요.

자세한 구조·상태 충돌 방지·검수 한계는 [아키텍처](docs/ARCHITECTURE.md), 기여 방법은 [기여 지침](CONTRIBUTING.md)을 참고하세요.

## 라이선스와 출처

pwh 코드는 [MIT License](LICENSE)입니다. 이 라이선스가 외부 엔진·글꼴·사용자 문서의 권리까지 바꾸지는 않습니다.

- rhwp / rhwp Studio / core / editor: [edwardkim/rhwp](https://github.com/edwardkim/rhwp), MIT. 설치 시 고정 버전의 원 저작권 고지를 유지합니다.
- HOP: [golbin/hop](https://github.com/golbin/hop), MIT. 초기 조사 참고 대상이며 런타임 필수 의존성은 아닙니다.
- 선택 설치하는 나눔 글꼴: 네이버/NHN, SIL Open Font License 1.1.
- 한컴·Windows 등의 상용 글꼴, 기관 문서와 로고: 이 저장소에 포함하지 않습니다.

상세 목록은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요. pwh는 Hancom, rhwp, HOP 또는 OpenAI의 공식 제품이 아니며 각 프로젝트·상표의 소유권을 주장하지 않습니다.
