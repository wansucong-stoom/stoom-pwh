# Pwh Desktop Linux 시험판

Pwh Desktop은 Windows와 Linux에서 같은 편집기와 WebAssembly 조판 코어를 사용합니다. 메뉴·한글 호환 단축키·표·그림·도형·자동 채우기와 HWPX 저장은 공통 구현입니다. Linux판은 x64 데스크톱용 시험판입니다.

[실제 검증 범위와 남은 확인 항목](verification/LINUX-DESKTOP.md)

## 설치와 실행

GitHub 정식 릴리스에서 `PwhDesktop-버전-linux-x64.tar.gz`를 받고 압축을 풉니다. 패키지에는 Node, Electron, rhwp 문서 변환기와 선택적 AI 실행 환경이 포함됩니다. 별도로 npm을 설치하거나 소스를 빌드할 필요가 없습니다.

```sh
tar -xzf PwhDesktop-버전-linux-x64.tar.gz
cd PwhDesktop
./pwh-desktop --install
~/.local/bin/pwh-desktop
```

앱 메뉴에도 Pwh Desktop이 등록됩니다. HWP·HWPX를 앱으로 열거나 앱의 파일 열기 창에서 선택할 수 있습니다. 시험판 검증은 Ubuntu 26.04 LTS의 WSL2·WSLg 환경을 기준으로 진행합니다. 다른 배포판과 네이티브 데스크톱은 별도 확인이 필요합니다.

Ubuntu에서 데스크톱 라이브러리가 없는 최소 설치 환경이라면 다음 의존성이 필요합니다.

```sh
sudo apt-get install libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 \
  libsecret-tools gnome-keyring zenity imagemagick fonts-noto-cjk
```

문서에 사용된 글꼴이 다르면 줄바꿈과 쪽 나눔이 달라질 수 있습니다. Windows 글꼴을 패키지에 재배포하지 않습니다. 같은 라이선스가 허용하는 글꼴을 설치하면 두 운영체제에서 같은 글꼴 목록과 조판 규칙으로 편집할 수 있습니다. 한글 입력은 Linux 데스크톱의 IBus·Fcitx 등 입력기를 사용합니다.

## 업데이트

Windows와 Linux는 같은 Pwh·Desktop 버전을 기준으로 배포합니다. Linux판은 GitHub 정식 릴리스에 있는 Linux x64 패키지를 확인하며, 새 버전이 있으면 앱 상단에 **새 업데이트가 있습니다.** 버튼을 표시합니다.

열린 문서를 저장한 뒤 버튼을 누르면 패키지를 내려받아 파일 크기·SHA-256·배포 주소를 검증합니다. 앱이 종료된 뒤 새 버전을 설치하고 다시 실행합니다. 문서와 설정은 설치 버전 디렉터리 밖에 보관합니다. 앱이 닫히지 않으면 강제 종료하거나 설치하지 않습니다. 업데이트에는 위 설치 명령으로 등록한 사용자 설치판이 필요합니다.

Windows Store판은 Microsoft Store에서 업데이트합니다. 같은 수정 소스를 공유하지만 Store 심사와 GitHub 공개 시점은 다를 수 있습니다.

## Linux 연결

- 파일 선택은 Linux 기본 대화상자를 사용합니다. 문서 저장과 다른 이름 저장은 공통 저장 검증을 거칩니다.
- 설치 글꼴은 앱의 로컬 목록을 사용합니다. 브라우저 글꼴 접근 권한이 필요하지 않습니다.
- 선택적 ChatGPT 연결은 Secret Service 키 모음으로 암호화 키를 보관합니다. 키 모음이 없거나 잠겨 있으면 계정을 평문으로 저장하지 않으며, 기본 문서 편집은 로그인 없이 사용할 수 있습니다.
- ChatGPT 로그인이 기본입니다. 별도 Codex 연결은 설치된 CLI가 있을 때 제공하는 실험 기능이며 자동으로 설치하거나 로그인하지 않습니다. 실제 계정과 모델 호출의 검증은 별도로 필요합니다.
- 인쇄는 Electron과 운영체제의 프린터 목록을 사용합니다. 실제 프린터·입력기·그래픽 환경별 검증은 추가로 필요합니다.

## 공통 배포 빌드

`packaging/linux/runtime-lock.json`이 Linux 실행 환경의 버전·크기·SHA-256을 고정합니다. `runtime-lock.json`이 지정한 공통 코어를 그대로 사용하고 Windows 실행 파일만 Linux 실행 파일로 교체합니다. 편집기와 WASM은 다시 구현하거나 운영체제별로 분기하지 않습니다.

```sh
node scripts/build-desktop-linux.mjs \
  --output /absolute/output/PwhDesktop-버전-linux-x64.tar.gz \
  --cache /absolute/download-cache
```

정식 릴리스의 게시 이벤트는 Linux 패키지 빌드 작업도 실행합니다. Windows MSIX와 Linux 패키지의 Desktop 버전·Pwh 버전·WASM 및 편집기 해시를 배포 기록에서 대조할 수 있습니다. Linux 빌드 실패는 별도로 표시되며 성공하지 않은 패키지는 업로드하지 않습니다.
