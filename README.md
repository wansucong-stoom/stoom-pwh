<p align="center">
  <img src="assets/stoom.png" alt="STOOM Pwh 로고" width="84" height="84">
</p>

<h1 align="center">Pwh</h1>

<p align="center"><strong>AI와 함께 작성하고 편집하는 한글 문서 도구</strong></p>

<p align="center">
  <a href="https://tools.stoom.win/pwh/">제품 소개</a> ·
  <a href="https://github.com/wansucong-stoom/stoom-pwh/releases">다운로드</a> ·
  <a href="docs/USER-GUIDE.md">사용 안내</a> ·
  <a href="docs/README.md">문서 모음</a>
</p>

HWP·HWPX 문서를 열고, 글과 표를 직접 편집하거나 선택한 부분의 수정을 AI에게 요청할 수 있습니다. 작업한 문서는 편집 가능한 **HWPX**로 저장합니다. HWP에서 시작하면 원본을 보존하고 HWPX 작업본을 만듭니다.

## 시작하기

| 환경 | 사용 방법 |
| --- | --- |
| **Pwh Desktop** · Windows x64 | 제품 사이트 또는 GitHub 릴리스에서 **MSI**를 내려받아 설치합니다. 앱에서 ChatGPT 계정을 연결할 수 있으며, 별도 Codex 설치 없이도 실행됩니다. [Desktop 설치와 사용](docs/PWH-DESKTOP.md#설치와-사용) |
| **Pwh 플러그인** · Codex 데스크톱 | Codex 대화와 나란히 한글 편집기를 엽니다. GitHub에서 소스와 플러그인 **ZIP**을 받을 수 있습니다. [Codex 플러그인 설치](docs/USER-GUIDE.md#codex-plugin) |

**최신 정식 릴리스**는 Pwh **0.6.47**, Desktop **0.1.28**, 공통 코어 **r21**입니다. 버전별 다운로드, 변경 이력, SHA-256과 MSI 검증 범위는 [GitHub 릴리스](https://github.com/wansucong-stoom/stoom-pwh/releases/tag/v0.6.47)에서 확인할 수 있습니다.

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

## 조판 엔진과 검증

Pwh와 Pwh Desktop은 [rhwp](https://github.com/edwardkim/rhwp) 0.8.7 기반 공통 WASM 코어를 공유합니다. r21에서는 긴 중첩 표의 쪽 나눔과 테두리 위치를 보완하고, 쪽을 넘긴 인라인 표 뒤에서 빠지던 본문을 복원했습니다.

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
