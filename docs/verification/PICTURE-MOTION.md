# 그림 이동의 응답과 실행 취소

적용 버전: **Pwh 0.6.60 / Desktop 0.1.41**. 정식 기준 Pwh 0.6.59 / Desktop 0.1.40과 비교했습니다. GitHub 공개와 Store 제출·심사·게시 상태는 구분하며 Store 설치판에는 게시 이후 반영됩니다. WASM 코어 r29와 폰트 자산은 같은 파일을 사용합니다.

## 확인한 원인

Desktop의 반복 탭 상태 조회가 전체 HWPX 내보내기와 해시 계산을 유발했습니다. 시험 문서에서 불필요한 내보내기 한 번에 약 200~709ms의 동기 처리가 발생했습니다. 문서와 측정 환경에 따른 관측값입니다.

rhwp Studio에서 유래한 공통 마우스 처리는 프레임 예약 뒤 도착한 좌표를 버리고 첫 이벤트를 사용했습니다. mouseup도 예약된 마지막 입력을 적용하지 않고 기록을 닫았습니다. 기존 이동 기록은 좌표 역연산만 저장하므로 문서에 저장된 행 높이·글줄 정보까지 원본으로 보존한다는 계약이 없었습니다.

## 변경한 경로

- 공통 `status()`와 `getPresentationDocumentRevision()`은 준비 상태·문서 세대·수정 순서·쪽 수·dirty만 반환합니다. Desktop의 탭 상태 보고와 최초 초점 확인은 전체 내보내기 없이 이 정보를 읽습니다. 해시가 없음을 API로 구분하며, 전체 문서 충돌 검증과 명시적 저장을 이 값으로 대체하지 않습니다.
- [포인터 모듈](../../src/latest-pointer-frame.mjs)은 프레임 내 최신 이벤트를 유지하고 mouseup에서 최종 좌표를 적용합니다. 문서·드래그 상태가 달라지거나 종료되면 남은 콜백을 적용하지 않습니다.
- [이동 기록](../../src/picture-move-history.ts)은 첫 실제 이동 직전에 네이티브 체크포인트를 한 번 생성합니다. 종료 시 기존 SnapshotCommand에 소유권을 넘기고, 기존 히스토리 예산·지연 redo 보관·discard를 사용합니다. 매 프레임 저장·재열기나 전체 HWPX 직렬화를 하지 않습니다. 원점 복귀·Esc 취소는 원본을 복원하고 기록을 추가하지 않습니다.
- 드래그 중 표 높이와 그림 배치는 기존 공통 조판 경로로 계속 갱신합니다. 특정 문서·쪽·표 번호나 원문 내용에 따른 분기는 없습니다.

## 검증 범위

| 검사 | 기준판 | 수정판 |
| --- | --- | --- |
| Ctrl+Z 후 문서 전체 글자·개체 좌표 | 편집 전과 다름 | 편집 전과 일치 |
| Ctrl+Z 후 해당 쪽의 실제 캔버스 픽셀 | 표가 줄어든 채 남음 | 편집 전과 일치 |
| 다시 실행 후 배치·화면 | 이동 후와 일치 | 이동 후와 일치 |
| Ctrl+Z 후 저장·재열기 | 원본과 배치가 다름 | 문서 전체 배치·원문 XML 일치 |
| 드래그 중 상태 조회의 전체 내보내기 | 반복 발생 | 0회 |

평면·중첩 표와 여러 쪽의 시험 사본에서 실제 마우스·키보드로 이동·실행 취소·다시 실행·저장·재열기를 확인했습니다. mouseup의 최종 좌표, 한 드래그의 한 기록, Esc 복원도 확인했습니다. 관련 자동 시험은 실제 r29 코어를 지정해 **38건 통과·실패 0·생략 0**입니다.

두 독립 빌드의 공통·Desktop 파일 6개가 일치하고 TypeScript, Desktop 소스·해시 검증과 정적 검사를 통과했습니다. 합성 시험은 원문·배치·인쇄 SVG 복원, 반복 redo, 오래된 포인터 차단과 상태 조회의 전체 내보내기 금지를 검사합니다.

백그라운드 시험 화면의 requestAnimationFrame이 약 1초 간격으로 제한되어 전체 드래그 벽시계 시간이나 FPS를 실제 활성 앱의 성능으로 환산하지 않습니다. 위 측정은 동기 처리 시간과 불필요한 작업 횟수입니다. 기존 245쪽의 PDF 일치도 재측정이나 새 조판 개선 수치를 뜻하지 않습니다.

## 재현

```text
node --test tests/latest-pointer-frame.test.mjs tests/desktop-workspace-status.test.mjs tests/document-state-cache.test.mjs
node --test tests/picture-move-layout-history.test.mjs tests/cell-text-layout-history.test.mjs tests/continued-flow-picture.test.mjs tests/inline-picture-frame.test.mjs
node scripts/verify-editor-build.mjs --write --typecheck --cache-dir <preserved-input-cache> --work-root <new-empty-stage>
node desktop/verify-source.mjs
```

코어 시험에는 `PWH_CORE_JS`와 `PWH_CORE_WASM`으로 실제 r29 파일을 지정합니다. 미설정으로 생략된 시험은 통과 수에 포함하지 않습니다. 사용자 원본·이미지·개인 경로는 저장소와 배포물에 포함하지 않습니다.
