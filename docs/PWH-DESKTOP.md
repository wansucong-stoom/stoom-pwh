# Pwh Desktop

Pwh Desktop은 AI 대화와 한글 문서 편집기를 한 창에서 사용하는 Windows 앱입니다. 문서 조판 코어와 텍스트·표 편집 코드는 Pwh 플러그인과 공유합니다. Desktop 호스트는 파일 창, AI 연결 설정, 설치·제거와 Windows 아이콘을 담당합니다.

[문서 모음](README.md) · [설치와 업데이트](#설치와-사용) · [편집과 인쇄](#공통-편집-기능) · [빌드](#소스와-빌드)

## 설치와 사용

Windows 10/11 x64에서 **[Microsoft Store의 Pwh Desktop](https://apps.microsoft.com/detail/9NXGD60MHMT2)**을 설치합니다. 이후 업데이트는 Microsoft Store가 배포합니다. 기본 문서 편집에는 AI 로그인이나 별도 Codex 설치가 필요하지 않습니다. HWP·HWPX의 연결 프로그램에서도 Pwh Desktop을 선택할 수 있습니다.

Desktop 신규 배포는 Store로 통일합니다. GitHub 릴리스는 Codex 플러그인·소스·고정 코어·검증 자료를 계속 제공하며, 기존 MSI 설치 파일은 보존하되 이후 MSI 업데이트는 배포하지 않습니다.

기존 MSI에서 이전하려면 먼저 문서를 저장하고 앱을 닫은 뒤 Store판을 설치하세요. MSI 설치본이 Store판으로 자동 전환되지는 않습니다. 문서는 원래 저장한 위치에서 다시 열 수 있습니다. 최근 문서·설정·AI 로그인 정보의 자동 이전은 보장하지 않으므로 필요한 AI 연결은 Store판에서 다시 설정합니다. 기존 MSI 제거는 사용자가 Windows 설정의 설치된 앱에서 진행할 수 있습니다.

Electron 실행 환경을 앱에 포함합니다. 설치된 Edge나 브라우저 프로필을 사용하지 않으며 별도 브라우저 설치도 필요하지 않습니다. OpenAI 계정 로그인 때는 시스템의 기본 브라우저를 엽니다. Store판은 GitHub MSI 업데이트를 실행하지 않습니다.

<a id="store-update-notice"></a>
### 앱 안의 Store 업데이트 알림

Desktop 0.1.37부터 앱 시작·화면 복귀와 사용 중 정기 확인으로 Microsoft Store가 제공하는 업데이트를 조회합니다. 새 버전이 있으면 상단의 **새 업데이트 · Store에서 업데이트**를 표시합니다. 버튼은 해당 제품의 Store 페이지를 열며 열린 문서나 미저장 변경을 닫지 않습니다. 설치 전에는 문서를 저장하세요.

Store 조회에 실패하면 ‘최신 버전’으로 단정하지 않고 수동 확인 버튼을 유지합니다. 동일 조회의 동시 실행을 합치고 정상 결과는 5분, 실패는 1분 동안 재사용합니다. 시험 MSIX는 정식 Store 알림 대상으로 취급하지 않으며 GitHub MSI 설치로 전환하지 않습니다. GitHub에만 게시된 버전은 Store의 설치 가능 업데이트와 구분합니다.

업데이트 조회는 패키지 신원을 유지한 작은 네이티브 보조 실행 파일에서 Windows Store API로 수행합니다. 별도 Edge 로그인이나 PowerShell 실행 정책 변경은 필요하지 않습니다. 기존 0.1.36 이하 설치판에는 이 버튼을 소급해서 추가할 수 없으므로 먼저 Store에서 기능을 포함한 새 버전을 설치해야 합니다. [빌드와 검증 범위](verification/CORE-R29.md)

Codex 플러그인은 Desktop 설치와 별도로 [플러그인 설치 안내](USER-GUIDE.md#codex-plugin)에 따라 연결합니다.

- 시작 화면에서 새 문서를 만들거나 PC의 HWP·HWPX를 엽니다. 이 버전부터 열거나 저장한 문서는 최근 문서에 표시되며, 목록에서 제거해도 원본 파일은 삭제되지 않습니다. 문서에서 시작 화면으로 돌아가도 열린 탭과 AI 대화는 유지됩니다.
- 문서 편집과 HWPX 저장은 로컬에서 처리합니다. 파일 메뉴에 새 문서·열기·저장·다른 이름으로 저장이 있습니다.
- 파일 → 인쇄 또는 Alt+P로 프린터 설정과 미리보기를 한 창에서 엽니다. 쪽 범위, 용지, 방향, 매수, 흑백·컬러, 모아 찍기와 양면을 설정하고 인쇄하면 선택한 프린터에 바로 전송합니다. Windows 기본 인쇄 설정창을 다시 띄우지 않습니다. 실제 양면·용지 지원 여부는 선택한 프린터에 따릅니다. 별도의 인쇄 미리보기 메뉴와 PNG·JPEG·BMP·TIFF·GIF 그림 저장 메뉴도 제공합니다.
- 새 설치의 기본 AI 연결은 OpenAI의 공식 **ChatGPT로 계속**입니다. 로그인과 요금제 사용 승인은 시스템 브라우저의 OpenAI 화면에서 진행하며, 별도 Codex 설치는 필요하지 않습니다. 기존에 저장한 AI 연결 선택은 유지합니다.
- 공식 오픈소스 Codex app-server를 설치기에 포함해 문서 도구와 연결합니다. 선택적으로 기존에 설치된 Codex나 로컬 AI도 사용할 수 있습니다. 로컬 AI는 Ollama 등 OpenAI 호환 서버 주소와 모델을 지정합니다. 지원되는 모델과 추론 강도는 대화 입력창에서도 선택합니다.
- ChatGPT 연결은 OpenAI의 미리보기 기능이며, 계정·모델별로 사용 가능 범위가 다를 수 있습니다. [OpenAI의 현재 미리보기 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)에 따라 이 직접 연결은 이미지 생성 도구를 지원하지 않습니다. 같은 계정으로 로그인된 Codex가 설치되고 해당 계정·모델이 이미지 생성을 지원하면 기존 Codex 이미지 도구로 그림을 생성해 문서에 삽입할 수 있습니다. 사용량은 [ChatGPT 설정](https://chatgpt.com/settings/usage)에서 확인합니다.
- 로그인 토큰은 Windows 사용자 계정에 묶어 암호화합니다. 실행 중 인증을 갱신할 때 대화를 이어가기 위한 기록은 이 PC에 저장됩니다. 앱을 다시 열었을 때 이전 대화가 화면에 자동 복원되지는 않습니다. 다른 프로그램의 ChatGPT 또는 Codex 로그인 정보를 복사하지 않습니다.
- AI 대화와 문서 사이의 경계를 드래그해 너비를 조절합니다. STOOM 원본 마크와 색상을 앱·설치·바로가기·파일 연결 아이콘에 사용합니다.
- Pwh와 SST는 동일한 STOOM 제품 로고 규격을 사용합니다. 작은 Windows 아이콘에서는 청록색 후광을 축소하고, 특히 16px에서는 Pwh 글자의 가독성이 제한될 수 있습니다.

AI에 보낸 내용은 선택한 제공자가 처리합니다. Codex 연결에는 네트워크가 필요하며, 로컬 AI도 사용 전에 별도로 모델과 서버를 준비해야 합니다.

## 공통 편집 기능

편집 용지(F7)의 여백 입력은 중앙 용지 그림의 실제 방향에 맞춰 배치됩니다. 입력 칸 또는 그림의 영역을 선택하면 같은 위치가 강조되며, 용지 크기·방향을 바꾸면 그림도 갱신됩니다. 기존 적용·취소·실행 취소 경로를 사용합니다.

인쇄 미리보기에서 확대·축소, 배율 선택, 쪽 너비 맞춤과 한 쪽 전체 보기를 사용할 수 있습니다. Ctrl+휠, Ctrl++/−와 Ctrl+0도 지원합니다. 배율은 화면에만 적용되며 실제 인쇄 크기와 그림 저장 크기는 바뀌지 않습니다. 긴 문서의 준비된 쪽은 나누어 표시하고 화면 밖 쪽은 그리기를 미룹니다. 인쇄용 SVG를 처음 준비하는 시간까지 없어지는 것은 아닙니다.

텍스트 수정은 문구를 검색해 원래 본문·셀·중첩 셀의 글자 범위에 적용합니다. 같은 셀에 내부 표나 그림이 있어도 주변 개체를 교체하지 않습니다. 혼합 글자 서식의 변경하지 않은 문자는 서식을 유지하고 새 글자는 변경 위치의 서식을 이어받습니다. 여러 범위를 한 번에 수정한 작업은 실행 취소 한 번으로 복원합니다.

표 구조·디자인을 바꾸는 작업과 텍스트 부분 수정은 별도 도구를 사용합니다. 표 서식 분석의 제한이 있다는 이유로 텍스트 검색·수정을 생략하지 않습니다. 검색 후 문서가 변경됐거나 원문이 여러 곳에 있으면 현재 원문과 셀 주소를 확인합니다.

배포 파일의 런타임 manifest와 빌드 기록은 사용한 Pwh 버전, 코어 SHA256 및 패치를 기록합니다. 소스 배포 ZIP은 Desktop 호스트와 공통 Pwh 소스를 함께 보존하며 사용자 문서·복구본·설정·로그인 정보는 포함하지 않습니다.

## PDF 편집 계획

현재 PDF 기능은 인쇄·내보내기입니다. 향후에는 PDF를 Pwh에서 열어 텍스트·그림·표를 편집하고 다시 PDF로 저장하는 흐름까지 확장합니다. 이 계획을 현재 버전의 지원 기능으로 표시하지 않습니다.

- 가져오기는 원래 쪽 크기·위치·글꼴 자원·그림·선을 기준으로 삼고, 수정하지 않은 쪽과 개체의 표현을 보존합니다. PDF에 없는 원래 HWP 문단·셀 구조는 복원이 필요한 정보로 취급합니다.
- 스캔 PDF의 문자 인식과 표 구조 추정은 사용자가 결과를 확인할 수 있게 구성합니다. 직접 PDF 편집과 편집 가능한 HWPX 구조로 복원하는 작업의 보존 범위를 명시합니다.
- 기존 AI 문서 도구와 선택·실행 취소 흐름을 활용하되, PDF의 쪽·개체 주소를 HWP 원문 주소로 간주하지 않습니다. 같은 렌더러·해상도·쪽 원점의 비교 체계로 가져오기 전후와 변경하지 않은 영역을 검증합니다.

## 소스와 빌드

Microsoft Store용 MSIX를 빌드해 정식 배포합니다. GitHub의 제출용 패키지 생성·공개와 Store의 심사·게시 완료는 각각 구분합니다. [MSIX 배포 구분·빌드·검증](MSIX.md)을 참고하세요.

저장소의 `desktop/standalone-pwh`는 Desktop 호스트·화면·Windows 실행 파일·설치기 소스입니다. `desktop/bridge`에는 STOOM이 작성한 공식 Codex app-server 연결 코드가 있습니다. 공통 편집기 코드는 저장소의 `src`, `client`, `runtime-lock.json`을 사용합니다. Desktop이 별도의 기본 rhwp 복사본에서 빌드되지 않도록 설치기 빌드가 Pwh 버전과 편집기 SHA256 일치를 검사합니다.

Windows x64의 Node.js와 WiX 3.14 도구, 고정된 Pwh 보존 런타임 ZIP, [공식 Codex app-server Windows x64 패키지](https://github.com/openai/codex/releases/tag/rust-v0.165.0)와 [공식 Electron 45.1.0 Windows x64 ZIP](https://github.com/electron/electron/releases/tag/v45.1.0)을 준비한 뒤 실행합니다. `--codex-runtime`에는 공식 `codex-app-server-package-x86_64-pc-windows-msvc.tar.gz`를 안전하게 푼 디렉터리를 지정합니다. 빌드는 각 입력의 크기와 SHA256을 확인한 뒤 설치기에 복사합니다. Electron 실행 파일은 `PwhDesktopShell.exe`로 제품명과 아이콘을 적용하며 빌드 기록에 결과 해시를 남깁니다.

```powershell
node scripts/build-desktop.mjs --output C:\build\PwhDesktop.msi --runtime-archive C:\build\pwh-runtime.zip --wix-dir C:\build\wix314 --codex-runtime C:\build\codex-app-server --electron-archive C:\build\electron-v45.1.0-win32-x64.zip
```

이 명령은 검증된 공통 플러그인 패키지와 Desktop 소스를 새 임시 빌드 폴더에 모아 MSI를 생성합니다. 재빌드용 임시 폴더는 결과 확인을 위해 보존하며, 사용자의 설치판이나 문서를 바꾸지 않습니다. 설치기에 들어가는 Node.js와 각 런타임 구성요소의 라이선스 고지도 함께 포함됩니다.

Windows 실행 파일의 제품 리소스에는 Electron의 공식 `rcedit` 2.0.0을 빌드 도구로 사용합니다. 고정된 배포 URL·크기·SHA256을 확인하며, 빌드할 때만 내려받고 설치기에는 넣지 않습니다. 인터넷 없는 빌드에서는 미리 받은 도구의 절대 경로를 `PWH_RCEDIT_PATH`로 지정합니다. 앱 창은 샌드박스와 context isolation을 사용하며 문서 프레임에 Node.js 권한을 제공하지 않습니다.

이전 MSI의 GitHub 업데이트 코드는 과거 배포물 재현을 위해 보존합니다. 신규 Desktop 배포는 Store용 MSIX를 사용하며, [Store 빌드와 제출](MSIX.md)을 참고하세요. GitHub 릴리스에 올린 MSIX는 Store 제출용이며, Microsoft 인증을 거친 Store 설치와 구분합니다.

## 공개 소스 보존과 검사

[`desktop/source-manifest.json`](../desktop/source-manifest.json)은 Desktop 공개 파일의 상대 경로·크기·SHA256과 원본 소스 상대 경로를 기록합니다. 공개 소스는 원본 바이트를 그대로 보존하며, 빌드 작업 공간에 배치하기 전 저장소의 기본 테스트 탐색에 섞이지 않도록 JavaScript 검사 파일의 `.test.mjs` 이름만 `.check.mjs`로 바꿨습니다.

저장소 루트에서 다음 명령으로 파일 무결성, 예상하지 않은 파일·폴더 부재, 편집기 번들 manifest 일치와 사용자 홈 경로 부재를 확인합니다.

```powershell
node desktop/verify-source.mjs
```

원본 개발 작업 공간과의 바이트 대조 및 빌드 작업 공간에 배치한 Desktop 검사 실행법은 [`desktop/README.md`](../desktop/README.md)에 있습니다. 공개 mirror에는 사용자 문서·복구본·로그·프로필·설정·로그인 정보나 `node_modules`를 포함하지 않습니다.

GitHub 저장소와 GitHub 소스 아카이브는 이 Desktop 폴더를 포함합니다. 기본 MCP 플러그인 ZIP은 작은 설치 패키지로 유지하기 위해 Desktop 소스를 제외합니다. Desktop 재빌드는 전체 저장소를 내려받아 실행하며, Desktop용 Store MSIX와 플러그인 ZIP을 구분합니다.
