# Microsoft Store / MSIX

[Desktop](PWH-DESKTOP.md) · [문서 모음](README.md)

MSIX는 Desktop의 별도 포장 경로입니다. 조판 코어·공통 편집기·AI 실행 파일은 MSI와 같은 고정 입력으로 준비하며, 빌드가 크기·SHA-256과 공통/전용 편집기 manifest를 대조합니다. Store 등록·인증서 발급·심사 완료와 MSIX 파일 생성은 서로 다른 단계입니다.

## 배포 구분

| 채널 | 식별자와 서명 | 업데이트와 설정 |
|---|---|---|
| MSI | 기존 실행기·설치기 | 기존 파일 보존, 신규 MSI 업데이트 중단. Store판으로 별도 설치 |
| MSIX 시험판 | 별도 `STOOM.PwhDesktop.Preview`, Windows 11 시험 전용 unsigned OID | MSI 업데이트 차단, 별도 시험 데이터 폴더 |
| Store 제출용 MSIX | Partner Center의 정확한 제품 식별자, Store가 심사 과정에서 서명 | MSI 업데이트 차단, Store에서 업데이트 |

시험판의 이름은 **Pwh Desktop 시험판**입니다. 기존 MSI 앱을 제거하거나 덮어쓰지 않으며, 기존 설정·로그인 정보를 자동 복사하지 않습니다. Windows의 기본 문서 앱도 강제로 바꾸지 않습니다. 정식 Store판으로 전환할 때 설정·최근 문서·로그인 정보의 이전 범위는 별도 검증해야 합니다.

MSIX의 시작 메뉴·작업 표시줄·문서 연결은 Windows 패키지 식별자를 사용합니다. 실행기가 OS에서 실제 AppUserModelID를 읽어 자식 Electron 창으로 전달합니다. 아이콘은 저장소에 복사한 승인된 STOOM Pwh 제품 자산에서 생성합니다.

## 앱 안의 업데이트 확인

Desktop 0.1.37부터 정식 Store 패키지의 신원으로 Windows Store API를 조회합니다. 결과가 실제로 제공되는 업데이트일 때만 알림을 표시하고 버튼으로 해당 제품의 Store 페이지를 엽니다. GitHub 공개 버전과 Store 설치 가능 버전은 구분합니다. 조회 실패는 최신 상태로 표시하지 않으며 시험 MSIX와 MSI의 채널 차단을 유지합니다. [사용 안내](PWH-DESKTOP.md#store-update-notice) · [실제 패키지 조회와 모형 UI 시험의 구분](verification/CORE-R29.md)

보조 실행 파일은 저장소의 C# 소스로 .NET Framework 컴파일러에서 빌드해 패키지에 포함합니다. 런타임에 PowerShell 실행 정책을 완화하지 않습니다. Store 서명과 게시 완료는 별도 심사 단계이며, 기능이 없는 이전 설치판은 Store에서 한 번 갱신해야 합니다.

## 빌드

MSI 빌드와 같은 Windows x64 입력에 Windows SDK의 `makeappx.exe`를 추가로 준비합니다. 자산 변환에는 Windows PowerShell/System.Drawing을 사용하며, 실행 정책 옵션은 해당 빌드 자식 프로세스에만 적용하고 시스템 설정을 바꾸지 않습니다.

```powershell
node scripts/build-desktop.mjs --format msix --channel preview --output C:\build\PwhDesktop-preview.msix --sdk-dir "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64" --runtime-archive C:\build\pwh-runtime.zip --codex-runtime C:\build\codex-app-server --electron-archive C:\build\electron.zip
```

Store 제출용은 `--channel store --identity C:\build\store-identity.json`을 사용합니다. 이 JSON의 `name`, `publisher`, `publisherDisplayName`은 Partner Center의 **제품 ID**에 표시된 값을 그대로 사용합니다. 계정별 값을 소스에 넣지 않습니다. 등록 전 임의 값으로 제출용 제품 ID를 만들지 않습니다. Store판은 예약한 이름·ID와 심사 요건 확인 후 생성합니다.

Windows SDK는 패키징 과정에서 manifest 스키마와 필요한 파일을 검사합니다. 패키지 생성 후 별도 폴더로 풀어 내용·엔진 SHA-256·그림 자산·공통/전용 번들을 다시 확인합니다. 빌드 로그와 패키지 SHA-256을 릴리스 기록에 보존합니다.

## GitHub 정식 릴리스에서 Store 업데이트

첫 Store 공개는 Partner Center에서 완료해야 합니다. 이후 Microsoft Entra 애플리케이션을 Partner Center에 연결하고 GitHub의 `microsoft-store` 환경에 아래 Secrets를 설정하면 정식 릴리스에서 Store 업데이트를 제출할 수 있습니다. 개인 Microsoft 계정 로그인만으로 CI가 인증되지는 않습니다.

| Secret | 내용 |
|---|---|
| `MSSTORE_TENANT_ID` | 연결된 Microsoft Entra tenant ID |
| `MSSTORE_CLIENT_ID` | 자동 제출용 애플리케이션 client ID |
| `MSSTORE_CLIENT_SECRET` | 해당 애플리케이션의 client secret |
| `MSSTORE_SELLER_ID` | Partner Center의 seller ID |
| `MSSTORE_IDENTITY_JSON` | 제품 ID 페이지의 `name`, `publisher`, `publisherDisplayName` JSON |

인증 정보는 소스·릴리스·로그에 넣지 않습니다. Entra 애플리케이션의 Store 관리 권한과 secret 만료를 관리해야 합니다. 연결 시험과 첫 공개 확인을 마친 뒤 저장소의 Actions **Variable** `MSSTORE_AUTOPUBLISH`를 `true`로 설정합니다. 설정 전에는 자동 제출이 활성화되지 않습니다.

1. 같은 정식 소스에서 플러그인과 Store용 MSIX를 생성하고 검증합니다. Store MSIX 파일명은 `PwhDesktop-<Desktop 버전>-store-x64.msix`입니다. 신규 MSI 배포는 유지하지 않습니다.
2. GitHub의 `v<Pwh 버전>` 릴리스 **초안**에 MSIX 및 나머지 정식 배포물을 모두 올린 다음 공개합니다. 업로드 중에 먼저 공개하지 않습니다.
3. 기존 `Test` 워크플로가 소스·브라우저·실엔진·편집기 재빌드·정적 검사·PDF 비교 도구 검사를 실행합니다. 어느 작업이든 실패하거나 건너뛰면 Store 제출도 진행하지 않습니다.
4. `store-submit` 작업이 GitHub 자산 크기·SHA-256, Store 신원·버전·기능 선언, 배포 채널, 공통/전용 편집기·호스트, 고정 코어와 공식 AI 실행 파일을 확인합니다. 시험판이나 다른 소스의 번들을 제출하지 않습니다.
5. 고정한 Microsoft 공식 Action/CLI로 검증한 MSIX를 기존 Store 제품에 제출합니다. 인증과 게시 완료는 Microsoft가 별도로 처리합니다. 기존 소개·이미지 변경이 필요하면 함께 검토합니다.

일반 push, PR, 초안, prerelease와 엔진 보존용 릴리스는 Store 제출 대상이 아닙니다. Store 작업은 직렬로 실행하고 진행 중인 제출을 새 실행으로 취소하지 않습니다. 실패하면 Actions 로그와 `store-package-verification` 결과를 확인합니다. 업로드 후 실패했을 수 있으므로 Partner Center의 진행 중인 제출을 먼저 확인하고 재실행합니다. 제출 중에는 같은 제품의 초안을 수동으로 편집하지 않습니다.

Store용 MSIX가 릴리스에서 빠지거나 연결 정보가 없으면 명확히 실패하며 다른 설치 파일로 대체하지 않습니다. GitHub 릴리스만으로 최초 Store 등록·Entra 연결·Microsoft 인증을 대신할 수는 없습니다.

근거: [Microsoft의 GitHub Actions 연결](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/github-actions), [첫 공개와 CLI 요건](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/overview).

## 시험 설치와 제거

시험판은 Microsoft가 서명한 정식 배포물이 아닙니다. Microsoft가 안내하는 Windows 11의 `-AllowUnsigned` 경로를 사용하며, 실행 파일이 포함되어 관리자 권한이 필요합니다. 신뢰할 루트 인증서를 설치하거나 Smart App Control을 끄는 절차를 포함하지 않습니다.

```powershell
# Windows PowerShell, 관리자 권한. 직접 만든 시험 패키지에만 사용합니다.
Add-AppxPackage -Path C:\build\PwhDesktop-preview.msix -AllowUnsigned
Get-AppxPackage -Name STOOM.PwhDesktop.Preview

# 시험판만 제거합니다. 기존 MSI 앱과 사용자 원본 문서는 유지합니다.
Get-AppxPackage -Name STOOM.PwhDesktop.Preview | Remove-AppxPackage
```

관리자 권한의 실제 설치·등록 검증과 패키지를 풀어 수행하는 실행 검증을 보고서에서 구분합니다. Store 서명 이후에도 깨끗한 Windows 사용자 환경에서 문서 열기·저장·실행 취소·인쇄·파일 연결·AI 로그인·업데이트·제거를 확인해야 합니다. 인쇄 검증은 사용자 승인 없이 실제 프린터에 작업을 보내지 않습니다.

## 제출 준비

1. [Store 개발자 계정](https://storedeveloper.microsoft.com/)을 만들고 적절한 계정 유형으로 신원 확인을 완료합니다.
2. Pwh 제품 이름을 예약하고 제품 ID를 확인합니다.
3. 패키지·앱 설명·개인정보 처리방침·스크린샷·연령 등급과 full-trust 사용 사유를 준비합니다.
4. 파일/하위 프로세스/AI 연결과 Store 정책의 적합성을 확인하고 심사에 제출합니다.
5. 심사를 통과한 뒤 Store 설치 링크를 운영 사이트에 게시합니다. 기존 GitHub MSI에 Store의 서명이 자동 적용되지는 않습니다.

근거: [Microsoft MSIX 서명](https://learn.microsoft.com/windows/msix/package/signing-package-overview), [unsigned 시험 패키지](https://learn.microsoft.com/windows/msix/package/unsigned-package), [Desktop 패키징 준비](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-prepare).
