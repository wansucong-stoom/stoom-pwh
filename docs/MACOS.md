# Pwh Desktop Mac 시험판

Apple Silicon Mac용 시험판입니다. Windows·Linux와 같은 Pwh 편집기와 rhwp 기반 조판 코어로 HWP·HWPX를 엽니다. HWP를 열면 원본을 보존하고 HWPX 작업본으로 편집합니다.

## 설치

1. [GitHub 릴리스](https://github.com/wansucong-stoom/stoom-pwh/releases)에서 `PwhDesktop-버전-macos-arm64.zip`을 내려받습니다.
2. 압축을 풀고 `Pwh Desktop.app`을 응용 프로그램 폴더에 복사합니다.
3. 처음 실행할 때 개발자를 확인할 수 없다는 메시지가 뜨면, 공식 배포 파일인지 확인한 뒤 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**에서 이 앱을 허용합니다. 관리되는 Mac은 이 방법을 제한할 수 있습니다. [Apple 안내](https://support.apple.com/ko-kr/102445)

이 시험판은 Apple Developer ID 없이 임시 서명하며 Apple 공증을 받지 않았습니다. 지원 아키텍처는 Apple Silicon입니다. 문서에 사용된 글꼴의 설치 여부에 따라 줄바꿈과 쪽 나눔이 달라질 수 있습니다.

앱의 **문서 열기** 또는 Finder의 **다음으로 열기 → Pwh Desktop**으로 문서를 엽니다. `⌘N`은 새 탭, `⌘O`는 열기, `⌘S`는 저장, `⌘⇧S`는 다른 이름으로 저장입니다.

0.1.50부터 **AI 설정 → ChatGPT로 계속**을 누르고 기본 브라우저에서 로그인하면 AI 대화와 자주 쓰는 양식을 이용할 수 있습니다. Pwh로 돌아와 **설정 저장**을 누르세요. 로그인 정보는 macOS 키체인으로 보호됩니다. Mac 시험판을 업데이트한 뒤 키체인 접근 확인이 다시 나타날 수 있습니다. 기존에 설치한 Codex CLI도 AI 설정에서 선택할 수 있습니다.

**새 업데이트가 있습니다.** 버튼은 새 Mac 패키지가 있는 GitHub 릴리스를 엽니다. 열린 문서를 저장한 뒤 기존 앱을 종료하고 새 `.app`으로 바꾸면 됩니다.

## 빌드와 검증

GitHub Actions의 macOS 작업이 Apple Silicon에서 패키지를 만듭니다. 조판 코어와 편집기 번들, Electron·Node·문서 변환기·AI 실행 파일의 해시를 확인합니다. 배포용 ZIP을 풀어 서명, 새 문서와 기존 HWPX 시작, 텍스트 삽입·저장·HWPX 재열기·이전 HWP 열기, AI 실행 파일 시작, ChatGPT 로그인과 키체인 경로를 검증합니다. 자동 시험은 합성 문서와 시험용 브라우저 응답을 사용합니다.

Mac ZIP과 함께 배포한 JSON에서 ZIP·편집기·코어 해시와 검사 결과를 확인할 수 있습니다. 물리 키보드로 조합하는 한글 입력과 Finder·Gatekeeper 첫 실행은 실제 Mac에서 확인하는 항목입니다.
