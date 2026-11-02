# 중첩 표의 원문 소유 범위 회귀 검사

공개 합성 HWPX로 중첩 표의 쪽 분할·원문 주소·표시 여부를 검사합니다. 사용자 문서·스크린샷·개인 진단 문구는 포함하지 않습니다.

## r12: 선언 높이와 저장된 인라인 개체 줄

`node --test tests/nested-declared-row-pagination.test.mjs`의 새 합성 회귀 4건은 다음을 검사합니다. 코어 환경 변수는 아래 실행 안내와 같습니다.

- 선언 높이가 있는 중첩 행의 일부가 남은 쪽 공간을 사용하며 각 원문 표식이 한 번씩 물리 쪽 안에 놓입니다. 원문 셀 주소·선언 크기, 내보내기·재열기·편집·스냅샷 복원도 확인합니다.
- 실제 저장 프레임이 없으면 기존 행 전체 경로를 유지합니다.
- 단일 저장 줄 상자 안에 온전히 들어 있는 인라인 표는 개체 줄 단위로 넘어갑니다.
- 저장 줄 상자보다 큰 내부 표는 재귀 분할을 유지해 후속 원문을 소비하거나 용지 밖에 놓지 않습니다.

합성 문서의 논리 배치 검사만으로 실제 문서 전체의 글리프 표시를 증명하지 않습니다. SVG 클립 검사와 실제 기준 PDF 비교를 함께 사용합니다.

## Run

Set `PWH_CORE_JS` and `PWH_CORE_WASM` to the exact engine build to test. Set `PWH_PLAYWRIGHT_MODULE` to the Playwright ESM entry URL. `PWH_BROWSER_EXECUTABLE` optionally selects a browser executable; otherwise Playwright uses its configured Chromium.

```powershell
node --test tests/engine-source-ownership/engine-source-ownership.test.mjs
```

The tests skip when the core or browser module environment is absent. Individual scripts also accept positional core paths:

```powershell
node tests/engine-source-ownership/synthetic-nested-regression.mjs <rhwp.js> <rhwp_bg.wasm>
node tests/engine-source-ownership/local-host-reset-regression.mjs <rhwp.js> <rhwp_bg.wasm>
```

`PWH_SYNTHETIC_TABLE_FIRST=1` inserts a table before the host text; the default inserts it after the text. `PWH_SYNTHETIC_HOST_SPACING=1` gives that host paragraph 12pt before and 8pt after. The test runner exercises all four combinations. `PWH_ENGINE_FIXTURE_OUTPUT` optionally saves a generated fixture to an explicit path; the tests write no document by default.

## Assertions

The larger fixture contains a 90×3 outer table and a 10×1 table inside its final cell. That row has ample declared height to hold the inner table; intentionally clipped oversized content is not classified as lost source. The checks cover:

- All 280 unique source markers appear once in the source scan and once across the visible pages.
- The visible SVG oracle intersects ancestor rectangular clip paths with the viewport, so text that exists only above or below its clip is not counted as displayed.
- A rendered nested cursor path resolves to its original source text.
- HWPX export/reopen preserves the source text and the nonzero host paragraph spacing.
- Editing a nested source location and restoring a snapshot recovers the original text.

The smaller fixture stores local host line positions `0 → 1600 → 0` in a short cell with an inner table. All five markers must remain visible once on one page. It guards against promoting every stored coordinate restart to a physical page break.

`getPageTextLayout` alone is insufficient for visibility checks: it recursively returns TextRun nodes without applying ancestor clipping. The SVG helper reports unsupported clip shapes as limitations, and those are test failures. Its visibility rule uses the glyph center and records partially clipped glyphs separately. Font appearance, stroke thickness, and border layout still require separate geometric or visual comparison for a particular engine change.

Passing these fixtures is a regression gate, not proof of compatibility with every HWP/HWPX shape. Engine-level cursor/frame tests and reference-document comparisons remain necessary.

## Physical child-frame reservation

`node physical-reserve.mjs <engine-source-root>` extracts the real `projected_recursive_run_extra` function and its unit/cut types from the selected source tree, then compiles a std-only Rust harness. `PWH_RUSTC` selects the compiler. The fixture adapter supplies independently specified child physical RowCut heights, including explicit cell padding; it does not reimplement the parent projection algorithm.

The cases cover padding on every partial fragment, exact child RowCuts on stored empty-host placeholders, rejection of untyped stored placeholders/text atoms, existing recursive reflow support, and avoidance of double-counted host spacing/captions/outer margins. Full-engine reference-document tests must still verify that the producer and actual child measurement supply those physical heights correctly.

`frame-border-oracle.mjs` measures actual horizontal SVG border strokes for a specified owned child-frame relation. A bbox or paint clip can be enlarged without moving the physical border; the helper deliberately checks the strokes and uses clipping depth to exclude lower descendant borders. It requires a visible complete parent horizontal edge and reports an unknown result otherwise. Intentionally oversized clipped objects must not automatically be classified as frame-containment defects.

`frame-border-oracle.test.mjs` tests the oracle with synthetic SVGs: an expanded bbox with an escaping child stroke, merged row edges covering a narrower cell, and an incomplete visible frame that must remain unknown. A containing table frame can be supplied to identify its stroke scope before measuring the target cell, so a descendant border cannot become the parent's boundary.

## Source predicate tests

With Rust 1.93.1 available, pass an extracted engine source root to the standalone
tests below, or set `PWH_ENGINE_SOURCE`. `PWH_RUSTC` selects the Rust executable.

```powershell
node tests/engine-source-ownership/run.mjs <engine-source-root>
node tests/engine-source-ownership/sourceframe.mjs <engine-source-root>
node tests/engine-source-ownership/parallel-row-source-frame.mjs <engine-source-root>
node tests/engine-source-ownership/page-number-source-activation.mjs <engine-source-root>
```

The harness extracts the actual source functions and records their SHA256 rather
than copying their implementations. The source-frame adapter supplies fixture
CellUnits in place of the full composer. It checks completed siblings, mixed and
recursive owners, synchronized plain-text restarts, stale text/format coordinates,
invalid cursors, synthetic lines and unsupported spans. These predicate checks
complement the browser and document roundtrip tests above.

The r14 candidate runners accept the source-root argument or `PWH_ENGINE_SOURCE`.
The parallel-row suite has 19 cases covering declared minimum-space conservation,
complete column ownership, original page origins versus paragraph-local resets,
edited/synthetic input rejection and explicit accepted-frame transport. The
page-number suite has 22 cases covering source-ordered object fragments,
preceding-section inheritance, numbering restarts and hide rules. It pins the
unchanged source resolver/number/hide functions separately. These standalone Rust
source tests require an engine source tree and a compiler; they are qualification
commands, not a claim that an environment without those inputs ran them.


## 저장된 중첩 표의 틀과 개체 여백

다음 시험은 같은 합성 HWPX에서 **물리적 첫 프레임**, **소비한 원문 커서**, **개체 자체의 여백**을 구분합니다. 실제 사용자 문서나 로컬 경로를 포함하지 않습니다. 소스 함수 시험과 실제 WASM 시험은 서로 다른 검증이며, 이 결과만으로 한글 기준 PDF와의 일치율을 승인하지 않습니다.

r14는 아직 미배포 후보입니다. Node·브라우저 후보 시험에는 `PWH_CANDIDATE_CORE_TESTS=1`을 명시해야 하며, 기본 CI의 배포 r13에 r14 기대값을 적용하지 않습니다. 아래 standalone 소스 명령은 명시한 원본 소스 루트를 검사합니다.

```powershell
$env:PWH_ENGINE_SOURCE = '<패치를 적용한 엔진 소스 루트>'
$env:PWH_RUSTC = '<rustc 실행 파일>'
node tests/engine-source-ownership/closed-float-source-frame.mjs
node tests/engine-source-ownership/sibling-table-offset.mjs
node tests/engine-source-ownership/nested-opening-frame-source.mjs
```

- `closed-float-source-frame.mjs`: 33개 실제 소스 사례. 글보다 앞에 저장된 컨트롤 앵커와 표시 순서를 구분하고, 원래 줄·오프셋·개체 끝·다음 문단 원점이 닫힌 배치를 증명하는지 확인합니다. 본체만 들어가고 전체 저장 프레임은 본문 영역을 벗어나는 경우, 재구성된 줄과 깊은 셀 수정은 제외합니다.
- `sibling-table-offset.mjs`: 9개 실제 소스 사례. 같은 호스트의 형제 개체 위치를 예약과 그리기에서 같은 근거로 처리하는 조건을 확인합니다.
- `nested-opening-frame-source.mjs`: 18개 실제 소스 사례. 승인된 자식 프레임을 소유한 빈 호스트만 여백을 추가하며, 다른 표 포인터·글이 있는 호스트·합성 줄·재조판된 줄·중첩 편집 후의 원본처럼 보이는 줄 등을 거절하는지 확인합니다.

```powershell
$env:PWH_CANDIDATE_CORE_TESTS = '1'
$env:PWH_CORE_JS = '<후보 core의 rhwp.js>'
$env:PWH_CORE_WASM = '<후보 core의 rhwp_bg.wasm>'
node --test tests/stored-float-host-frame.test.mjs tests/nested-opening-frame.test.mjs
```

`stored-float-host-frame.test.mjs`는 11개 후보 실행 사례와 선택적인 3개 이전 fallback 보존 사례를 검사합니다. 후자는 `PWH_FLOAT_FRAME_BASE_JS`와 `PWH_FLOAT_FRAME_BASE_WASM`으로 이전 기준 엔진을 지정해야 합니다. 본문보다 큰 저장 프레임이 잘못 들어간 이전 결과를 새 후보의 품질 승인 기준으로 삼지는 않습니다.

`nested-opening-frame.test.mjs`는 실제 WASM으로 9개 합성 변형의 프레임·비대칭 여백·원문 주소·저장/다시 열기·깊은 셀 수정·실행 취소를 검사합니다. 별도의 편집 후 일반 재조판 검증에는 해당 기능이 없는 독립 기준 엔진을 `PWH_REFERENCE_CORE_JS`와 `PWH_REFERENCE_CORE_WASM`으로 지정합니다. 후보와 기준은 같은 원본 바이트를 받아야 하며, 동일한 깊은 셀 수정 후 전체 인쇄 SVG와 물리적 표 틀이 일치해야 합니다. 기준 입력이 없으면 이 검사는 명시적으로 건너뜁니다. standalone runner는 기준 입력이 빠지면 실패합니다.

```powershell
$env:PWH_REFERENCE_CORE_JS = '<독립된 이전 기준 core의 rhwp.js>'
$env:PWH_REFERENCE_CORE_WASM = '<독립된 이전 기준 core의 rhwp_bg.wasm>'
node tests/engine-source-ownership/nested-opening-frame-regression.mjs
$env:PWH_BROWSER_TESTS = '1'
node --test tests/nested-opening-frame-browser.test.mjs
```

브라우저 시험은 Playwright의 Chromium을 사용합니다. 별도 모듈은 `PWH_PLAYWRIGHT_MODULE`로, 설치된 시험용 브라우저는 `PWH_BROWSER_EXECUTABLE`로 지정할 수 있습니다. 실제 SVG에 적용된 클립을 확인해 두 쪽의 12개 표식이 각각 한 번만 보이고 숨김·부분 잘림이 없는지 검사합니다. 수치상 레이아웃에 글자가 있다는 사실만으로 표시 성공을 판단하지 않습니다.

운영 런타임을 r14로 승격할 때는 배포 코어를 사용하는 core·browser CI에 이 명시 플래그를 켜거나 후보 전용 gate를 제거해야 합니다. `stored-float-host-frame`, `stored-float-source`, `sibling-table-offset`, `nested-opening-frame` 및 해당 browser 시험이 계속 건너뛰어지는 상태를 배포 완료로 인정하지 않습니다. 승격 검증은 후보 플래그를 끈 r13 경로의 보존과 플래그를 켠 새 코어의 실제 실행 기록을 각각 남깁니다.

## Patched runtime preservation integrity

`python tests/engine-source-ownership/preserve-patched-runtime.test.py` exercises
archive and manifest integrity, component markers, safe Windows member paths,
deterministic non-overwriting ZIP creation, dependency drift rejection, patch
digest rejection and core-output substitution rejection. The fixtures contain
only synthetic component bytes. `scripts/preserve-patched-runtime.py
--verify-only` also verifies real pinned build/client inputs without creating a
release archive or changing a lock or installation.
