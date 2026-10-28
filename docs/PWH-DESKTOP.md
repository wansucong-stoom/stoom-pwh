# Pwh Desktop

Pwh Desktop은 AI 대화와 한글 문서 편집기를 한 창에서 사용하는 Windows 앱입니다. 문서 조판 코어와 텍스트·표 편집 코드는 Pwh 플러그인과 공유합니다. Desktop 호스트는 파일 창, AI 연결 설정, 설치·제거와 Windows 아이콘을 담당합니다.

## 설치와 사용

[GitHub Releases](https://github.com/wansucong-stoom/stoom-pwh/releases)에서 `PwhDesktop` MSI를 내려받아 설치합니다. 제어판의 프로그램 제거 또는 Windows 설정의 설치된 앱에서 제거할 수 있습니다. HWP·HWPX의 연결 프로그램에서도 Pwh Desktop을 선택할 수 있습니다.

- 문서 편집과 HWPX 저장은 로컬에서 처리합니다. 파일 메뉴에 새 문서·열기·저장·다른 이름으로 저장이 있습니다.
- Codex 연결은 PC에 설치되고 로그인된 Codex의 공식 app-server를 사용합니다. OpenAI 앱 소스나 로그인 화면을 복제하지 않습니다.
- AI 설정에서 Codex 또는 로컬 AI를 선택합니다. 로컬 AI는 Ollama 등 OpenAI 호환 서버 주소와 모델을 지정합니다. Codex 모델과 추론 강도는 대화 입력창에서도 선택합니다.
- AI 대화와 문서 사이의 경계를 드래그해 너비를 조절합니다. STOOM 원본 마크와 색상을 앱·설치·바로가기·파일 연결 아이콘에 사용합니다.

AI에 보낸 내용은 선택한 제공자가 처리합니다. Codex 연결에는 네트워크가 필요하며, 로컬 AI도 사용 전에 별도로 모델과 서버를 준비해야 합니다.

## 공통 편집 기능

텍스트 수정은 문구를 검색해 원래 본문·셀·중첩 셀의 글자 범위에 적용합니다. 같은 셀에 내부 표나 그림이 있어도 주변 개체를 교체하지 않습니다. 혼합 글자 서식의 변경하지 않은 문자는 서식을 유지하고 새 글자는 변경 위치의 서식을 이어받습니다. 여러 범위를 한 번에 수정한 작업은 실행 취소 한 번으로 복원합니다.

표 구조·디자인을 바꾸는 작업과 텍스트 부분 수정은 별도 도구를 사용합니다. 표 서식 분석의 제한이 있다는 이유로 텍스트 검색·수정을 생략하지 않습니다. 검색 후 문서가 변경됐거나 원문이 여러 곳에 있으면 현재 원문과 셀 주소를 확인합니다.

배포 파일의 런타임 manifest와 빌드 기록은 사용한 Pwh 버전, 코어 SHA256 및 패치를 기록합니다. 소스 배포 ZIP은 Desktop 호스트와 공통 Pwh 소스를 함께 보존하며 사용자 문서·복구본·설정·로그인 정보는 포함하지 않습니다.

## 소스와 빌드

저장소의 `desktop/standalone-pwh`는 Desktop 호스트·화면·Windows 실행 파일·설치기 소스입니다. `desktop/bridge`에는 STOOM이 작성한 공식 Codex app-server 연결 코드가 있습니다. 공통 편집기 코드는 저장소의 `src`, `client`, `runtime-lock.json`을 사용합니다. Desktop이 별도의 기본 rhwp 복사본에서 빌드되지 않도록 설치기 빌드가 Pwh 버전과 편집기 SHA256 일치를 검사합니다.

Windows x64의 Node.js와 WiX 3.14 도구, 고정된 보존 런타임 ZIP을 준비한 뒤 실행합니다.

```powershell
node scripts/build-desktop.mjs --output C:\build\PwhDesktop.msi --runtime-archive C:\build\pwh-runtime.zip --wix-dir C:\build\wix314
```

이 명령은 검증된 공통 플러그인 패키지와 Desktop 소스를 새 임시 빌드 폴더에 모아 MSI를 생성합니다. 재빌드용 임시 폴더는 결과 확인을 위해 보존하며, 사용자의 설치판이나 문서를 바꾸지 않습니다. 설치기에 들어가는 Node.js와 각 런타임 구성요소의 라이선스 고지도 함께 포함됩니다.

## 공개 소스 보존과 검사

[`desktop/source-manifest.json`](../desktop/source-manifest.json)은 Desktop 공개 파일의 상대 경로·크기·SHA256과 원본 소스 상대 경로를 기록합니다. 공개 소스는 원본 바이트를 그대로 보존하며, 빌드 작업 공간에 배치하기 전 저장소의 기본 테스트 탐색에 섞이지 않도록 JavaScript 검사 파일의 `.test.mjs` 이름만 `.check.mjs`로 바꿨습니다.

저장소 루트에서 다음 명령으로 파일 무결성, 예상하지 않은 파일·폴더 부재, 편집기 번들 manifest 일치와 사용자 홈 경로 부재를 확인합니다.

```powershell
node desktop/verify-source.mjs
```

원본 개발 작업 공간과의 바이트 대조 및 빌드 작업 공간에 배치한 Desktop 검사 실행법은 [`desktop/README.md`](../desktop/README.md)에 있습니다. 공개 mirror에는 사용자 문서·복구본·로그·프로필·설정·로그인 정보나 `node_modules`를 포함하지 않습니다.

GitHub 저장소와 GitHub 소스 아카이브는 이 Desktop 폴더를 포함합니다. 기본 MCP 플러그인 ZIP은 작은 설치 패키지로 유지하기 위해 Desktop 소스를 제외합니다. Desktop 재빌드는 전체 저장소를 내려받아 실행하며, 별도 Desktop 소스 ZIP과 MSI는 플러그인 ZIP과 구분합니다.
