# 조판 비교와 검증 범위

[문서 모음](README.md) · [비교 방법](RENDER-COMPARISON.md) · [공통 코어 변경](RHWP-DIFFERENCES.md)

같은 HWPX 원본을 한글의 PDF와 비교합니다. 원문·글꼴·여백·저장된 셀 크기를 임의로 바꾸지 않고 쪽 수, 글자 배정, 표·그림 경계를 확인합니다. 사용자 문서와 출력 이미지는 공개 배포물에 포함하지 않습니다.

<a id="test-document-update"></a>
## 조판 개선의 비교 결과

| 익명 시험 문서 | 한글 기준 / 개선 전 / 개선 후 쪽 수 | 일반 잉크 F1 | 진한 잉크 F1 |
| --- | ---: | ---: | ---: |
| TEST 문서 A | 46 / 48 / 46 | 60.4097% → 97.8304% | 50.7933% → 95.4884% |
| TEST 문서 B | 65 / 65 / 65 | 97.4459% → 99.2010% | 95.6450% → 98.3818% |

| 비교 조건 | 범위 |
| --- | --- |
| 해상도와 허용 오차 | 150dpi, 위치 오차 2픽셀 |
| 잉크 구분 | 명도 임계값 245·180 |
| 비교 단위 | 동일한 물리 쪽, 추가된 쪽도 점수에 포함 |
| 글꼴 | 문서 B의 전체 전후 결과에는 기준 글꼴 환경 적용이 포함 |
| 해석 | 두 시험 문서의 비교 결과이며 모든 문서의 완전한 호환을 뜻하지 않음 |

## 현재 편집 경로의 회귀 검사

| 검사 | 확인한 범위 | 기록 |
| --- | --- | --- |
| 공통 코어 r29 | 익명 문서 5개 245쪽의 기존 조판·저장·재열기 유지 | [코어 검증](verification/CORE-R29.md) |
| 그림 이동과 실행 취소 | 이동 전 표 높이·배치 복원, 화면 비교, 저장·재열기 | [편집 검증](verification/PICTURE-MOTION.md) |
| 메뉴·단축키 | 문서 선택 보존, 명령 단일 실행, 입력 충돌 | [입력 검증](verification/MENU-SHORTCUTS.md) |

새 편집 기능의 회귀 검사와 한글 PDF와의 일치도 측정은 구분합니다. 저장·재열기는 각 문서의 편집 전 상태와 비교하며, 글꼴이나 인쇄 환경이 다른 결과를 같은 조건의 개선 수치로 합치지 않습니다.

## 지원 범위

복잡한 병합 셀, 중첩 개체, 글꼴 대체와 여러 쪽에 걸친 문서는 구조와 실행 환경에 따라 차이가 남을 수 있습니다. 현재 지원과 제한은 [호환성 안내](PWH-COMPATIBILITY-LIMITS.md), 계산 기준은 [공통 조판 소유권 규칙](engine-patches/LAYOUT-OWNERSHIP-RULES.md)에서 확인할 수 있습니다.

<a id="test-b-final-65"></a>
<a id="test-b-adjacent-source-anchors"></a>
<a id="test-b-terminal-cut-merged-frame"></a>
<a id="test-b-nested-column-left"></a>
<a id="test-b-terminal-object-float"></a>
<a id="test-b-reference-fonts-through-40"></a>
<a id="paired-rowbreak-opening-frame"></a>
<a id="paragraph-right-float-frame"></a>
<a id="test-b-rear-page-audit"></a>
<a id="print-faux-bold-text"></a>
<a id="terminal-inline-frame"></a>
<a id="test-b-60-full-document-verification"></a>
<a id="source-inline-tab-and-float-anchors"></a>
<a id="resumed-peer-frame-margins"></a>
<a id="terminal-peer-leaf-frame"></a>
<a id="parallel-declared-source-frames"></a>
<a id="complete-float-row-frame"></a>
<a id="source-frame-height-reconciliation"></a>
<a id="inline-declared-row-frame"></a>
<a id="declared-row-fragment-balance"></a>
<a id="nested-table-prefix-and-anchored-opening"></a>
<a id="closed-object-row-frame"></a>
<a id="source-table-boundaries-33-34"></a>
<a id="anchored-float-restart-frame"></a>
<a id="closed-inline-row-ownership"></a>
<a id="nested-restart-frame-ownership"></a>
<a id="nested-original-text-restart"></a>
<a id="original-inline-object-line"></a>
<a id="nested-terminal-inline-row-band-trial"></a>
<a id="nested-table-frame-ledger"></a>
<a id="nested-rowspan-opening-trial"></a>
<a id="stored-nested-row-geometry"></a>
<a id="confirmed-row-frame-reservation"></a>
<a id="r29-resumed-nested-left-anchor"></a>
<a id="r28-resumed-nested-successor"></a>
<a id="r27-stored-plain-tail"></a>
<a id="r17-caret-and-continuation"></a>
<a id="r16-forward-frame-ownership"></a>
<a id="r14-source-frame-candidate"></a>
<a id="r13-mixed-block-flow"></a>
## 코어 변경 추적

이전 코어 변경의 구현과 적용 조건은 [rhwp 원본 대비 변경](RHWP-DIFFERENCES.md)과 [패치 목록](engine-patches/README.md)에 정리합니다. 쪽별 진행 일지 대신 현재 비교 범위와 재현 가능한 검사 기준을 제공합니다.
