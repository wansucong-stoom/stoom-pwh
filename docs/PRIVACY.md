# Pwh 개인정보 처리방침

적용일: 2026년 11월 11일 · 운영: **STOOM Lab**

이 방침은 Pwh Desktop과 Pwh 문서 편집 도구에 적용됩니다. Microsoft Store, 연결한 AI 제공자, GitHub 및 운영 웹사이트는 각 서비스의 방침에 따라 데이터를 처리합니다.

## 문서와 로컬 저장

문서 열기, 조판, 직접 편집, HWPX 저장과 인쇄 준비는 사용자 PC에서 처리합니다. 기능에 따라 문서 작업본, 변환 파일, 미저장 복구본, 문서 이력과 생성 그림이 로컬 앱 데이터에 저장될 수 있습니다. 최근 문서 목록에는 파일 이름·경로·연 시각이, 설정에는 선택한 AI 제공자·모델·서버 주소 등이 저장될 수 있습니다. 문서에는 사용자가 입력한 개인정보가 포함될 수 있습니다.

로컬 작업 파일과 복구본은 사용자가 저장한 원본 문서와 별개입니다. 앱을 제거해도 모든 사용자 파일이나 설정이 삭제된다고 보장하지 않습니다. 원본과 작업본을 보관할 필요가 있는지 확인한 후, 앱의 최근 문서·이력 관리 기능 또는 Windows의 앱 데이터 관리 기능을 사용해 정리할 수 있습니다. 공유 PC에서는 Windows 계정과 파일 접근 권한도 함께 관리해 주세요.

## 선택적 AI 연결

AI 연결은 선택 사항입니다. 기본 문서 편집에는 AI 계정 연결이 필요하지 않습니다. AI를 사용하면 요청문, 제공한 대화 문맥, 첨부 그림, 선택한 본문과 서식, 문서 도구가 작업 중 조회한 내용 및 작업 결과가 연결한 제공자에게 전달될 수 있습니다. 요청한 작업에 따라 선택 영역 외의 문서 문맥을 조회할 수 있으므로, 선택한 글만 전송된다고 가정하지 마세요.

ChatGPT를 연결하면 OpenAI가 로그인·계정·사용량 및 AI 요청을 처리합니다. 기존 Codex를 사용하는 연결은 해당 프로그램의 계정과 설정을 사용합니다. 로컬 AI 연결은 사용자가 지정한 서버로 요청을 보냅니다. 서버가 다른 PC나 외부 주소라면 데이터도 그 주소로 전달됩니다. AI 제공자의 보관 기간, 학습 사용 여부와 삭제 절차는 선택한 서비스·계정·설정에 따라 다릅니다.

- [OpenAI 개인정보 처리방침](https://openai.com/policies/privacy-policy/)
- [Microsoft 개인정보처리방침](https://privacy.microsoft.com/privacystatement)

AI에 보내기 전에 개인정보·기밀·제3자 자료의 포함 여부를 확인해 주세요. AI 기능을 사용하지 않거나, 계정 연결을 해제하거나, 적절히 관리되는 로컬 AI 서버를 선택할 수 있습니다. 연결 해제만으로 제공자가 이미 보관한 요청이나 기록까지 삭제되지는 않습니다.

## 계정 정보 보호

Pwh Desktop의 직접 ChatGPT 연결은 Windows 계정에 연결된 DPAPI 보호 저장소에 인증 토큰을 저장합니다. 이 보호는 Pwh의 모든 문서·작업본·로그가 암호화된다는 뜻은 아닙니다. 별도로 설치된 Codex와 로컬 AI 서버의 자격증명·기록은 해당 프로그램이 관리합니다.

Pwh 설정에서 계정을 연결 해제할 수 있습니다. 제공자 쪽의 접근 허용·대화 기록·계정 데이터 관리도 필요하면 해당 서비스에서 별도로 진행해 주세요.

## 네트워크, 배포와 지원

선택적 AI 연결과 로그인, 사용자가 여는 외부 링크, 사용한 외부 서비스에는 네트워크 연결이 필요할 수 있습니다. Store 배포판의 설치·업데이트와 Store 이용 정보는 Microsoft가 처리합니다. MSI 배포판의 릴리스 확인·다운로드는 GitHub 등의 배포 서비스를 사용합니다. 외부 웹사이트에 접속하면 해당 서비스에 IP 주소 등 통상적인 접속 정보가 전달될 수 있습니다.

문의나 오류 신고에 사용자가 첨부한 정보는 문제 확인과 지원에 사용됩니다. 공개 GitHub 이슈에는 신분증·전화번호·주소·실제 업무 문서·계정 토큰·개인 경로·복구본을 올리지 마세요. 재현 자료에는 개인정보를 제거한 TEST 문서를 사용해 주세요. 보안 문제는 [비공개 신고 안내](../SECURITY.md)를 따릅니다.

## 문의와 변경

- 일반 문의: [Pwh GitHub 이슈](https://github.com/wansucong-stoom/stoom-pwh/issues)
- 보안 문의: [보안 문제 신고](https://github.com/wansucong-stoom/stoom-pwh/security/advisories/new)
- 운영 사이트: [STOOM Tools](https://tools.stoom.win/pwh/)

직접 제공한 지원 정보의 정정·삭제 요청은 개인정보 원문을 공개하지 않고 위 경로로 먼저 문의해 주세요. 운영자가 접근할 수 없는 사용자 PC의 파일이나 외부 제공자의 보관 데이터는 해당 위치 또는 서비스에서 관리해야 합니다. 데이터 처리 방식이 변경되면 이 문서의 적용일과 내용을 갱신합니다.

## English summary

Pwh Desktop is operated by STOOM Lab. Document editing and saving are performed locally. Working copies, recovery drafts, document history, recent file paths, settings and generated images may remain in local application data. Uninstalling does not guarantee removal of every user file.

AI is optional. When enabled, prompts, conversation context, attachments and document content read by the editing tools may be sent to the selected AI provider. Access may extend beyond the selected text when the requested task needs other document context. OpenAI, separately installed Codex and user-configured AI servers apply their own account, retention and deletion rules. Direct ChatGPT credentials are protected with Windows DPAPI; this does not encrypt all document or application data.

Store installation and updates are handled by Microsoft. External services may receive ordinary connection information when used. For privacy questions, correction or deletion requests relating to information supplied for support, contact us through the project links above without posting sensitive data publicly. Manage local files and third-party account data in their respective locations or services.
