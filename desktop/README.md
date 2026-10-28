# Pwh Desktop 공개 소스

이 폴더는 Desktop 호스트, AI 연결, Windows 실행기·설치기와 편집기 번들의 공개 소스를 보존합니다. 문서 조판 코어와 공통 편집 기능은 저장소 상위의 `src`, `client`, `runtime-lock.json`을 함께 사용합니다. Node.js 라이선스는 `standalone-pwh/NODE-LICENSE.txt`에 포함되어 있습니다.

Desktop 소스는 GitHub 저장소와 GitHub 소스 아카이브에 포함됩니다. 기본 MCP 플러그인 ZIP에는 Desktop 폴더를 넣지 않습니다. Desktop을 다시 빌드할 때는 전체 저장소를 내려받아 사용하며, Desktop 설치판과 별도 소스 배포물은 플러그인 패키지와 구분합니다.

`source-manifest.json`은 각 파일의 저장소 상대 경로, 개발 소스 상대 경로, 바이트 크기와 SHA256을 기록합니다. 복사한 파일 내용은 원본과 같습니다. Node.js가 아직 빌드 작업 공간에 배치하지 않은 Desktop 검사를 자동 실행하지 않도록 `.test.mjs` 파일 이름만 `.check.mjs`로 바꿨습니다. C# 검사는 `.test.cs` 이름을 유지합니다.

사용자 문서, 복구본, 대화·실행 로그, 설정·로그인 정보, 브라우저 프로필, 설치된 실행 파일, `node_modules`와 임시 빌드 폴더는 이 공개 소스에 포함하지 않습니다. `client/editor.js`와 `client/manifest.json`은 검증된 Desktop 편집기 배포 번들입니다.

## 무결성 확인

저장소 루트에서 실행합니다. 원래 개발 작업 공간 없이도 파일 목록, SHA256, 클라이언트 manifest, 사용자 홈 경로와 중첩 Git 저장소 부재를 검사합니다.

```powershell
node desktop/verify-source.mjs
```

선택적으로 원본 개발 작업 공간을 지정하면 파일 내용이 바이트 단위로 동일한지도 확인합니다. 이 경로는 manifest에 저장되지 않습니다.

```powershell
node desktop/verify-source.mjs --source-root C:\work\pwh-development
```

## 설치기 빌드와 검사 배치

Windows 설치기 빌드는 저장소의 [`scripts/build-desktop.mjs`](../scripts/build-desktop.mjs)를 사용합니다. 명령과 필요한 도구는 [`docs/PWH-DESKTOP.md`](../docs/PWH-DESKTOP.md)에 설명되어 있습니다. 빌드는 새 임시 작업 공간에 아래의 형제 폴더를 준비하여 원본 소스의 상대 import를 그대로 유지합니다.

```text
<build-workspace>/
  standalone-pwh/   # 이 폴더의 Desktop 소스와 .check.mjs 검사
  bridge/           # hwp-codex-host.mjs
  release-source/   # 동일 버전의 공통 Pwh 플러그인 소스
```

빌드가 마지막에 출력한 작업 공간으로 이동한 뒤 공개 검사를 명시적으로 실행합니다. 아직 배치하지 않은 `desktop/standalone-pwh`에서 직접 실행하지 마세요. 검사에 필요한 환경 변수가 없으면 해당 브라우저·엔진·실제 AI 검사는 건너뜁니다.

```powershell
Set-Location <build-workspace>
$desktopChecks = Get-ChildItem -LiteralPath standalone-pwh -Filter *.check.mjs | ForEach-Object FullName
node --test @desktopChecks
```

텍스트 편집 연결 검사에는 공통 엔진 회귀 테스트와 같은 `PWH_CORE_JS`, `PWH_CORE_WASM`을 설정합니다. 별도 시험 서버 주소 `PWH_STANDALONE_URL`, Playwright ESM 경로 `PWH_PLAYWRIGHT_MODULE`과 필요한 경우 `PWH_BROWSER_EXECUTABLE`을 지정합니다. 실제 Codex 연결은 설치·로그인이 되어 있는 PC에서 `PWH_CODEX_LIVE=1`을 명시했을 때만 사용합니다. 합성 문서만 만들며 기존 설치판이나 사용자 문서를 시험 대상으로 삼지 않습니다.

```powershell
node --test standalone-pwh/text-edit-smoke.check.mjs
```

모든 공개 소스는 저장소의 라이선스와 각 구성요소의 라이선스 고지를 따릅니다. 무결성 확인은 소스 보존 검사이며, Windows 설치·제거와 실제 문서 편집 검증을 대신하지 않습니다.
