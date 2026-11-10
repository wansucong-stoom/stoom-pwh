# Pwh 사용 안내

[프로젝트 소개와 다운로드](../README.md) · [문서 모음](README.md)

## Pwh Desktop

Windows x64에서 [제품 사이트](https://tools.stoom.win/pwh/) 또는 [GitHub 릴리스](https://github.com/wansucong-stoom/stoom-pwh/releases)의 MSI를 사용합니다. 설치 후 **AI 설정 → ChatGPT로 계속**으로 계정을 연결하거나, 설치된 Codex 또는 준비한 로컬 AI 서버를 선택할 수 있습니다. 설치·업데이트와 Windows 인쇄는 [Desktop 안내](PWH-DESKTOP.md#설치와-사용)에 정리되어 있습니다.

<a id="codex-plugin"></a>

## Codex 플러그인

저장소에서 설치하려면 Windows x64, Node.js 22.12 이상(22 계열) 또는 24 이상, Python 3.11 이상, Git, 로컬 플러그인과 MCP 실행을 지원하는 Codex가 필요합니다.

```powershell
git clone https://github.com/wansucong-stoom/stoom-pwh.git
cd stoom-pwh
node scripts/setup.mjs
codex plugin marketplace add .
codex plugin add pwh@pwh
```

새 Codex 대화에서 Pwh를 선택합니다. 설치 명령은 해시로 고정된 런타임을 준비합니다. [오프라인 설치와 런타임 갱신](engine-preservation.md)

## 문서 열기부터 저장까지

1. 새 문서를 만들거나 HWP·HWPX 파일을 엽니다. Codex에서 “빈 한글 편집기를 열어 줘”라고 요청할 수도 있습니다.
2. 글이나 셀을 선택해 **AI 수정 요청**을 엽니다. 우클릭 메뉴에서도 요청할 수 있고 **Ctrl+Enter**로 보냅니다.
3. 결과를 확인합니다. 요청을 기다리는 동안 다른 영역을 편집할 수 있습니다. 요청한 영역을 바꿨다면 충돌을 확인하고 다시 요청합니다.
4. Codex 편집기에서는 **새 수정본 저장**, Desktop에서는 **파일 → 저장** 또는 **다른 이름으로 저장**을 사용합니다.

> 선택한 문단을 의미는 유지하면서 간결하게 다듬어 줘.
>
> 이 표의 디자인을 다른 표에도 적용해 줘.
>
> 용지를 A4 가로 방향으로 바꾸고 좌우 여백을 20mm로 설정해 줘.

## 표와 개체 편집

| 동작 | 방법 |
| --- | --- |
| 표 만들기 | **Ctrl+N**을 누른 뒤 **T** |
| 셀 속성 | 셀 선택 후 **C** |
| 셀 테두리·배경 | 셀 선택 후 **L** 또는 우클릭 메뉴 |
| 셀 내용 지우기 | 셀 선택 후 **Delete**. 줄이나 칸 전체를 선택했다면 해당 줄이나 칸을 삭제할 수도 있습니다. |
| 그림·표 속성 | 개체를 선택하거나 표 안에 커서를 둔 뒤 **개체 속성** |

셀에 표를 붙일 때 **셀 안에 표로 넣기**와 **기존 셀에 붙이기**를 선택할 수 있습니다. 기존 셀에 붙일 때는 범위와 병합 구조가 맞아야 하며 대상 셀의 서식을 유지합니다. 한글에서 복사한 표가 일반 붙여넣기로 들어오지 않으면 Codex 편집기의 **한글 표·셀 가져오기**를 사용합니다. [복사 형식별 지원 범위](PWH-COMPATIBILITY-LIMITS.md#편집기-복사붙여넣기)

## 인쇄와 버전 확인

Desktop에서는 **Alt+P** 또는 **파일 → 인쇄**로 쪽 범위, 프린터와 미리보기를 확인합니다. 별도 인쇄 미리보기에서도 확대·축소할 수 있습니다. [인쇄와 미리보기](PWH-DESKTOP.md#공통-편집-기능)

편집기 상단에서 Pwh 버전을 확인합니다. 업데이트 직후 이전 버전이 보이면 미저장 작업을 저장하고 앱을 다시 엽니다. Codex 플러그인은 새 대화에서 확인합니다.

문서 열기·저장의 한도는 **64 MiB**, AI 표 삽입·셀 채우기는 **256칸·24,000자**입니다. 처리 시간과 지원 범위는 문서 구조와 작업에 따라 다릅니다. [기능 범위와 제한](PWH-COMPATIBILITY-LIMITS.md)
