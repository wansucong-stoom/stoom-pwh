# Microsoft Store / MSIX

[Desktop](PWH-DESKTOP.md) · [문서 모음](README.md)

MSIX는 Desktop의 별도 포장 경로입니다. 조판 코어·공통 편집기·AI 실행 파일은 MSI와 같은 고정 입력으로 준비하며, 빌드가 크기·SHA-256과 공통/전용 편집기 manifest를 대조합니다. Store 등록·인증서 발급·심사 완료와 MSIX 파일 생성은 서로 다른 단계입니다.

## 배포 구분

| 채널 | 식별자와 서명 | 업데이트와 설정 |
|---|---|---|
| MSI | 기존 실행기·설치기 | 기존 GitHub MSI 업데이트 |
| MSIX 시험판 | 별도 `STOOM.PwhDesktop.Preview`, Windows 11 시험 전용 unsigned OID | MSI 업데이트 차단, 별도 시험 데이터 폴더 |
| Store 제출용 MSIX | Partner Center의 정확한 제품 식별자, Store가 심사 과정에서 서명 | MSI 업데이트 차단, Store에서 업데이트 |

시험판의 이름은 **Pwh Desktop 시험판**입니다. 기존 MSI 앱을 제거하거나 덮어쓰지 않으며, 기존 설정·로그인 정보를 자동 복사하지 않습니다. Windows의 기본 문서 앱도 강제로 바꾸지 않습니다. 정식 Store판으로 전환할 때 설정·최근 문서·로그인 정보의 이전 범위는 별도 검증해야 합니다.

MSIX의 시작 메뉴·작업 표시줄·문서 연결은 Windows 패키지 식별자를 사용합니다. 실행기가 OS에서 실제 AppUserModelID를 읽어 자식 Electron 창으로 전달합니다. 아이콘은 저장소에 복사한 승인된 STOOM Pwh 제품 자산에서 생성합니다.

## 빌드

MSI 빌드와 같은 Windows x64 입력에 Windows SDK의 `makeappx.exe`를 추가로 준비합니다. 자산 변환에는 Windows PowerShell/System.Drawing을 사용하며, 실행 정책 옵션은 해당 빌드 자식 프로세스에만 적용하고 시스템 설정을 바꾸지 않습니다.

```powershell
node scripts/build-desktop.mjs --format msix --channel preview --output C:\build\PwhDesktop-preview.msix --sdk-dir "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64" --runtime-archive C:\build\pwh-runtime.zip --codex-runtime C:\build\codex-app-server --electron-archive C:\build\electron.zip
```

Store 제출용은 `--channel store --identity C:\build\store-identity.json`을 사용합니다. 이 JSON의 `name`, `publisher`, `publisherDisplayName`은 Partner Center의 **제품 ID**에 표시된 값을 그대로 사용합니다. 계정별 값을 소스에 넣지 않습니다. 등록 전 임의 값으로 제출용 제품 ID를 만들지 않습니다. Store판은 예약한 이름·ID와 심사 요건 확인 후 생성합니다.

Windows SDK는 패키징 과정에서 manifest 스키마와 필요한 파일을 검사합니다. 패키지 생성 후 별도 폴더로 풀어 내용·엔진 SHA-256·그림 자산·공통/전용 번들을 다시 확인합니다. 빌드 로그와 패키지 SHA-256을 릴리스 기록에 보존합니다.

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
