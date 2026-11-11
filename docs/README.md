# Pwh 문서 모음

[프로젝트 소개와 다운로드](../README.md) · [변경 이력](CHANGELOG.md)

## 설치와 사용

- [빠른 시작과 편집 안내](USER-GUIDE.md)에서 Desktop과 Codex 플러그인의 차이, 설치 방법, AI 요청 예시와 표 단축키를 확인할 수 있습니다.
- [Pwh Desktop](PWH-DESKTOP.md)에는 Windows 설치·업데이트, AI 연결, 미리보기와 인쇄를 정리했습니다.
- [MSIX와 Store 준비](MSIX.md)에는 시험 패키지, 정식 제출용 식별자와 설치 검증 범위를 정리했습니다.
- [설정과 글꼴](CONFIGURATION.md)에는 런타임 위치, 환경 변수, 시스템·인쇄 글꼴을 정리했습니다.
- [기능 범위와 제한](PWH-COMPATIBILITY-LIMITS.md)에는 붙여넣기, AI 편집, 서식과 화면 표시의 지원 범위를 정리했습니다.

## 조판과 검증

- [검증 결과](LAYOUT-FIDELITY.md#test-document-update)에는 TEST 문서 A/B의 전후 수치와 버전별 결과가 있습니다.
- [PDF 비교 및 쪽별 판정](RENDER-COMPARISON.md)에는 비교 명령, F1 해석, 쪽별 통과 조건과 SVG 글자 잘림 검사가 함께 있습니다.
- [rhwp 원본 대비 차이](RHWP-DIFFERENCES.md)에는 원천 코어, 공통 편집기, Desktop의 변경이 계층별로 나뉘어 있습니다.
- [공통 코어 패치](engine-patches/README.md)에서 각 패치의 변경 근거와 [표·문단 배치 규칙](engine-patches/LAYOUT-OWNERSHIP-RULES.md)을 확인할 수 있습니다.

## 개발과 유지보수

- [기여 안내](../CONTRIBUTING.md) · [아키텍처](ARCHITECTURE.md) · [정적 검사](STATIC-CHECKS.md)
- [편집 성능 측정](EDITOR-PERFORMANCE.md) · [개체 속성 동작](OBJECT-PROPERTIES.md)
- [오프라인 설치와 런타임 보존](engine-preservation.md) · [Pwh 스킬](../skills/pwh/SKILL.md)

## 릴리스와 보안

- [GitHub 릴리스](https://github.com/wansucong-stoom/stoom-pwh/releases)에서 배포 파일과 검증 기록을 받을 수 있습니다.
- [개인정보 처리방침](PRIVACY.md) · [보안 신고](../SECURITY.md) · [라이선스](../LICENSE) · [외부 구성 요소 고지](../THIRD_PARTY_NOTICES.md)
