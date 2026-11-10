<p align="center">
  <img src="assets/stoom.png" alt="STOOM Pwh 로고" width="84" height="84">
</p>

<h1 align="center">Pwh</h1>

<p align="center"><strong>AI와 함께 작성하고 편집하는 한글 문서 도구</strong></p>

<p align="center">
  <a href="https://tools.stoom.win/pwh/">제품 소개</a> ·
  <a href="https://github.com/wansucong-stoom/stoom-pwh/releases/latest">최신 릴리스</a> ·
  <a href="docs/USER-GUIDE.md">사용 안내</a> ·
  <a href="docs/README.md">문서 모음</a>
</p>

HWP·HWPX 문서를 열고, 글과 표를 직접 편집하거나 선택한 부분의 수정을 AI에게 요청할 수 있습니다. 작업한 문서는 편집 가능한 **HWPX**로 저장합니다. HWP에서 시작하면 원본을 보존하고 HWPX 작업본을 만듭니다.

## 시작하기

| 환경 | 사용 방법 |
| --- | --- |
| **Pwh Desktop** · Windows x64 | GitHub 릴리스에서 **MSI**를 내려받아 설치합니다. 업데이트할 때도 최신 MSI를 실행합니다. 앱에서 ChatGPT 계정을 연결할 수 있으며, 별도 Codex 설치 없이도 실행됩니다. [Desktop 설치와 사용](docs/PWH-DESKTOP.md#설치와-사용) |
| **Pwh 플러그인** · Codex 데스크톱 | Codex 대화와 나란히 한글 편집기를 엽니다. GitHub에서 소스와 플러그인 **ZIP**을 받을 수 있습니다. [Codex 플러그인 설치](docs/USER-GUIDE.md#codex-plugin) |

**최신 정식 릴리스**는 Pwh **0.6.48**, Desktop **0.1.29**, 공통 코어 **r22**입니다. 버전별 다운로드, 변경 이력, SHA-256과 MSI 검증 범위는 [GitHub 릴리스](https://github.com/wansucong-stoom/stoom-pwh/releases/tag/v0.6.48)에서 확인할 수 있습니다.

## 할 수 있는 일

| 작업 | 예시 |
| --- | --- |
| **작성과 수정** | 기존 양식으로 초안 작성, 선택한 문단 다듬기, 본문과 중첩 셀에서 특정 문구 수정 |
| **표와 그림 편집** | 셀 복사·붙여넣기, 표 서식 통일, 셀 테두리·배경 설정, 지원되는 그림 교체 |
| **용지와 인쇄** | 용지 그림에서 여백 위치 확인, 인쇄 미리보기 확대·축소, 쪽 범위 인쇄 및 그림 저장 |
| **Desktop 작업 공간** | 최근 문서, 여러 문서 탭과 문서별 AI 대화 |

1. 새 문서를 만들거나 HWP·HWPX 파일을 엽니다.
2. 글이나 셀을 선택한 뒤 **AI 수정 요청**을 누르거나 편집기에서 직접 고칩니다.
3. 결과를 확인한 뒤 **HWPX**로 저장합니다.

[요청 예시와 표 단축키](docs/USER-GUIDE.md) · [기능 범위와 제한](docs/PWH-COMPATIBILITY-LIMITS.md)

## 이번 릴리스에서 달라진 점

- **표 편집** — 셀 폭을 바꾸면 새 줄 높이와 문단 간격을 다시 계산해 글줄이 겹치지 않게 합니다. 긴 중첩 표를 편집할 때 줄 단위 나눔이 허용되면 현재 쪽의 남은 본문 공간을 사용합니다.
- **편집 반응** — 셀 크기 변경에 필요한 행·열 정보를 문서 모델에서 읽고, 셀 선택 표시는 보이는 쪽만 갱신합니다. 같은 서식의 글자 폭 표도 재사용합니다. 큰 표에서 쪽을 다시 나누는 지연은 남아 있습니다.
- **단축키** — 셀 블록에서 `W`로 너비, `H`로 높이를 맞춥니다. `Ctrl+F10`은 문자표 입력을 엽니다. 새 탭·닫기·전환, 찾기 등 이번에 추가한 키는 [변경 이력](docs/CHANGELOG.md)에서 확인할 수 있습니다.

## 조판 엔진과 검증

Pwh와 Pwh Desktop은 [rhwp](https://github.com/edwardkim/rhwp) 0.8.7 기반 공통 WASM 코어를 사용합니다. r22의 [코어 변경 기록](docs/RHWP-DIFFERENCES.md)에서 표 편집, 쪽 나눔, 글꼴 계산의 수정 범위를 확인할 수 있습니다.

r22 정식 빌드는 편집하지 않은 익명 시험 문서 3개의 150쪽과 편집 사례 5건에서 검증용 빌드와 동일한 조판 결과를 냈습니다. 아래 표는 앞선 공통 코어 개선에서 동일한 원본을 한컴 PDF와 비교한 결과입니다.

| 익명 시험 문서 | 출력 쪽 수 전후 | 일반 잉크 F1 전후 |
| --- | ---: | ---: |
| TEST 문서 A | 48 → 46쪽 | 60.4097% → **97.8304%** |
| TEST 문서 B | 65 → 65쪽 | 97.4459% → **99.2010%** |

두 시험 문서 **111쪽**을 한컴 기준 PDF와 비교했습니다. 같은 물리 쪽을 150dpi, 위치 오차 2픽셀 허용 조건에서 대조한 잉크 겹침 점수입니다. 문서 B의 전체 전후에는 인쇄용 기준 글꼴의 효과도 포함됩니다. [검증 결과와 한계](docs/LAYOUT-FIDELITY.md#test-document-update) · [공통 코어와 원본의 차이](docs/RHWP-DIFFERENCES.md)

## 문서 바로가기

| 찾는 내용 | 문서 |
| --- | --- |
| **설치와 사용** | [사용 안내](docs/USER-GUIDE.md) · [Desktop](docs/PWH-DESKTOP.md) · [설정과 글꼴](docs/CONFIGURATION.md) |
| **조판과 검증** | [PDF 비교 및 쪽별 판정](docs/RENDER-COMPARISON.md) · [검증 결과](docs/LAYOUT-FIDELITY.md) · [코어 패치](docs/engine-patches/README.md) |
| **개발과 기여** | [전체 문서 모음](docs/README.md) · [아키텍처](docs/ARCHITECTURE.md) · [기여 안내](CONTRIBUTING.md) · [변경 이력](docs/CHANGELOG.md) |

## 데이터와 라이선스

문서 편집과 저장은 로컬에서 처리합니다. AI 요청에 포함한 본문과 문맥은 연결한 AI 제공자가 해당 서비스의 정책에 따라 처리합니다.

Pwh는 STOOM이 운영하는 독립 프로젝트입니다. [MIT 라이선스](LICENSE) · [외부 구성 요소 고지](THIRD_PARTY_NOTICES.md) · [보안 문제 신고](SECURITY.md)
