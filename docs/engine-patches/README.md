<a id="core-patches-table-layout-and-source-ownership"></a>
# 코어 패치: 표 조판과 원문 소유 범위

이 디렉터리는 rhwp 0.8.7에 적용한 변경을 검토할 수 있도록 보존합니다. Pwh의 Studio·클라이언트 패치와 구분되는 **조판 코어 변경**입니다. 문서 원문의 텍스트, XML에 저장된 셀 높이, 글꼴이나 여백이 아니라 계산된 배치를 변경합니다. 넘친 글자를 잘라 가리거나 줄 간격을 압축하지 않으며, 문서 전체에 `reflowLinesegs` 복구를 호출하지 않습니다.

<a id="cause-and-scope"></a>
## 원인과 적용 범위

높이 측정 단계에서는 줄바꿈한 텍스트에 맞게 행을 늘리고, 표 전체 높이를 유지하기 위해 다른 행의 여유 공간을 회수할 수 있습니다. 이후 `LayoutEngine::trust_declared_row_heights`는 행 높이의 합이 같고 차이가 기존 허용 범위 안에 있으면 각 행의 원래 높이를 복원할 수 있습니다. 저장된 LINE_SEG 정보가 없는 생성 HWPX는 ViewText 내용 격자로 판정될 수 있습니다. 이때 지정된 높이를 복원하면 표 전체 높이는 그대로여도 실제 내용에 필요한 최소 높이가 사라질 수 있습니다.

`rhwp-0.8.7-nols-row-content-floor.patch`는 높이를 복원하기 전에 조건을 한 번 더 확인합니다. 높이가 줄어들 가로쓰기 NO_LS 셀에 대해 렌더러의 기존 기준 너비, 안쪽 여백, 줄바꿈 및 내용 높이 계산을 재사용합니다. 내용과 여백이 지정된 행 높이에 들어가지 않으면 측정된 행 높이를 유지합니다. 내용이 들어가는 ViewText 격자, 저장된 배치 정보가 있는 셀, 높이가 줄지 않는 행에는 기존 보정을 그대로 사용합니다. 세로쓰기도 변경하지 않습니다. 패치에는 특정 문서 ID, 기관명, 글꼴, 행 개수 또는 셀 번호를 넣지 않았습니다.

첫 번째 패치는 `src/renderer/layout/table_layout.rs`만 변경합니다. 보조 함수에는 유일한 호출 위치에서 기존에 해석한 스타일을 전달합니다.

두 번째 패치 `rhwp-0.8.7-inline-table-affect-line-spacing.patch`는 `affectLSpacing` 속성이 켜진 새 인라인 표 뒤의 간격을 보완합니다. 기존 대체 경로는 퍼센트 줄 간격을 항상 표를 담은 문단의 글꼴 높이로 계산했습니다. 그 밖에 내용이 없는 문단에 표 하나만 있는 경우에는 이 속성에 따라 개체 줄 상자(표 높이와 위·아래 바깥 여백)를 퍼센트 계산의 기준으로 사용합니다. 현재 검증된 기준은 저장된 개체 줄의 배치 정보로 확인한 **지정 표 프레임**(`table.common.height`와 바깥 여백)입니다. 셀 내용이 늘어난 뒤 달라진 측정 높이는 이 보조 함수에서 추정하지 않습니다. 검증된 원래 배치에서 해당 속성을 무시하면 다음 문단이 한컴 한글보다 표에 지나치게 가깝게 그려질 수 있습니다.

`src/renderer/mod.rs`의 보조 함수가 표 내용 높이와 추가 간격을 제공합니다. `src/renderer/composer/line_breaking.rs`는 다음 문단들의 세로 위치를 누적하기 전에, 새 호스트의 합성 LINE_SEG를 만들면서 이 간격을 기록합니다. 이후 높이 측정, 조판, 그리기 및 커서 위치 조회가 같은 계산 위치를 사용할 수 있습니다. 뒤쪽 대체 경로만 바꾸는 것으로는 충분하지 않습니다. 가져오기 과정에서 이미 글꼴 기준 간격의 합성 호스트 구간을 만들 수 있기 때문입니다. 해당 구간이 없거나 다시 생성될 때는 `src/renderer/layout.rs`의 기존 표 호스트 측정 대체 경로와 그리기 흐름도 같은 보조 함수를 사용합니다. DPI는 호출 측에서 전달합니다.

이 변경은 다음 조건을 모두 만족할 때 적용됩니다. **실제로 저장된** LINE_SEG가 없고, 문단 텍스트가 없으며, TAC 표가 정확히 하나이고, `affectLSpacing=1`이며, 퍼센트 줄 간격이 100%를 초과해야 합니다. 기존 합성 태그 판별로 식별되는 내부 생성 구간은 계속 적용 대상입니다. 개체 줄 프레임이 호스트 글꼴 높이보다 클 때만 적용합니다. 속성이 꺼진 경우, 실제 저장 LINE_SEG, 작은 개체, 혼합 컨트롤, 보이는 텍스트, 100% 간격 및 다른 간격 방식은 기존 경로를 유지합니다. 그림과 도형의 측정값도 변경하지 않습니다. 바깥 여백은 퍼센트 기준에 한 번만 포함합니다. 흐름 계산이 여백을 별도로 반영하므로 보조 함수의 내용 높이에서는 제외합니다. 기존 표 배치 진행량 뒤에 간격을 중복해서 더하지 않습니다.

차이에 포함된 원본 코드와 주석은 원래 저작자 표시를 유지합니다. rhwp의 저작권은 Edward Kim과 기여자에게 있으며 MIT 라이선스로 배포됩니다. 소스 ZIP의 `LICENSE`, 저장소의 `THIRD_PARTY_NOTICES.md` 및 원본 프로젝트 <https://github.com/edwardkim/rhwp>를 참고하세요.

<a id="pinned-inputs"></a>
## 고정된 빌드 입력

<a id="nested-table-source-ownership"></a>
### 중첩 표의 원문 소유 범위

`rhwp-0.8.7-nested-source-ownership.patch`는 기존 자식 `RowCut` 경로를 첫 번째 컨트롤 위치에 비인라인 `TopAndBottom` RowBreak 표 하나가 있는 혼합 문단으로 확장합니다. 호스트 텍스트는 자신의 줄, 간격 및 나눔 단위를 유지합니다. 자식 행·셀 커서는 고정 높이의 단순 조각에서 다시 구성하지 않고 부분 배치에 전달합니다.

자식 분할은 남아 있는 보이는 내용의 소유 범위가 원래 일반 텍스트 문단의 재시작 위치에서 시작할 때에만 저장된 원문 프레임 경계를 사용할 수 있습니다. 이미 끝난 라벨 셀은 다음 페이지의 이어지는 내용을 소유하지 않습니다. 중첩 컨트롤 조각, 합성되었거나 오래된 줄 배치, 지원하지 않는 병합 범위 및 소유 범위가 불분명한 경우에는 그 권한을 부여하지 않습니다. 표는 유형이 지정된 표 단위를 포함한 분할에서만 그립니다. 일반 호스트 텍스트가 같은 블록 표를 다시 그리지 않습니다.

저장된 문단에서 유형이 지정된 자식 실행 구간은 선택된 자식 `RowCut`의 실제 높이도 확보하며, 각 조각의 셀 안쪽 여백을 포함합니다. 실행 구간에 자식 분할의 명시적인 출처가 있으면 자리 표시용 시각 줄이 있는 빈 호스트도 포함합니다. 완전한 행은 부분 행 분할과 같은 실행 구간을 공유할 수 있습니다. 자리 표시용 줄 범위만으로는 실제 높이 확보를 승인하지 않습니다. 같은 확보 높이를 쪽 나눔과 부분 행 렌더링에 사용합니다. 이전에는 부모가 원문 단위에서 투영한 높이만 예약하는 동안 자식은 안쪽 여백도 그려 내부 테두리가 부모 프레임 아래로 내려갈 수 있었습니다. 분리된 혼합 호스트 텍스트 단위는 문단 간격을 유지하고, 빈 호스트는 기존 가장자리 간격의 소유 범위를 유지합니다. 유형이 지정되지 않은 저장 스칼라 투영은 기존 경로를 사용합니다. 고정된 여백이나 픽셀 보정은 추가하지 않습니다.

이 패치는 계산된 쪽 나눔과 렌더링을 바꾸면서 원문 텍스트와 원본 커서 주소를 유지합니다. 저장된 셀 크기를 바꾸거나 보기 설정으로 넘친 내용을 가리지 않으며, 특정 문서나 쪽 식별자를 포함하지 않습니다.

이 패치는 소스·합성 문서·실제 문서 회귀 검사를 거쳐 r4 런타임에 반영됐습니다. **당시 r4 편집기 WASM**의 크기는 13,758,962바이트이고 SHA256은 `22516f486ced5fbff3a957b34e0d48adf77a05f8c0e80d8b7ff834d35ef5919b`입니다. 재현 가능한 빌드 스크립트는 네 패치를 모두 적용하고 각 소스의 변경 전후 해시를 검증합니다. 회귀 검사 명령과 합성 테스트 자료는 [`tests/engine-source-ownership`](../../tests/engine-source-ownership/README.md)에 있습니다.

| 입력 | 식별 정보 / SHA256 |
| --- | --- |
| 원본 소스 커밋 | `1a76570e833917d15817415a53c09ad61ab3203f` |
| 보존된 소스 ZIP | `pwh-upstream-rhwp-0.8.7-1a76570e8339.zip` |
| 소스 ZIP SHA256 | `067feefc25d36921ee41fea5df6fead00255ffa86441891fbaa202f96de202a2` |
| 원본 `table_layout.rs` SHA256 | `1dcbd3254a0f68b7de40c922f10e15cb62f2ef85e2c59fb24050bb143fa5f5f9` |
| 패치 적용 후 `table_layout.rs` SHA256 | `c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238` |
| 첫 번째 패치 SHA256 | `5a2427c162ee3928b7edecbaabad10936700c7db02f25a5436fb0a74a92bd221` |
| 인라인 표 간격 패치 SHA256 | `a9f6a533debe686f6e89ec06870e47ccb0357635f8303775467ceb6cfca9da7a` |
| 중첩 원문 소유 범위 패치 SHA256 | `346e2885cb5720574515167db94448f256e5d210d729ee63e2c0ac732e5b2a96` |
| 저장된 확장 표의 쪽 나눔 패치 SHA256 | `596bf711aaf4494438c76e0b77aa29741c93f2cdb9b75c5b49e3e4c3364eade3` |
| `saved/blank2010.hwp` | 13,824바이트; `43f472751fafefb8c66b0f831660ebed51e443a46bebe44c75bba918154ce4c9` |
| Rust / Cargo | `1.93.1` |
| 컴파일 대상 | `wasm32-unknown-unknown` |
| wasm-bindgen CLI | `0.2.127`; `--target web --out-name rhwp` |

두 번째 패치의 소스 해시는 다음과 같습니다.

| 파일 | 원본 SHA256 | 패치 적용 후 SHA256 |
| --- | --- | --- |
| `src/renderer/mod.rs` | `b27c1148d0496fe02dfef5ee3375511c3f2cd110925ebbfe90398a67b018f15d` | `c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a` |
| `src/renderer/composer/line_breaking.rs` | `42a685bc83d81e01356a5576fcc03d0c92117d5054d018c84f77ddbad297921e` | `6ced0b75cf4b46090801dd05adabe6e715d9ff06e22468ead3dbd5e6fbc9b940` |
| `src/renderer/layout.rs` | `eb561f70fed2217db8e17efc8b33a5639de4dd5c8087797cd2cf876be4bc4ca5` | `81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61` |

세 번째 패치는 앞의 두 패치가 적용된 다음 적용합니다.

| 파일 | 적용 전 SHA256 | 적용 후 SHA256 |
| --- | --- | --- |
| `src/renderer/layout/table_layout.rs` | `c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238` | `7f294df11f7dc48611cdcfbf8a7fa813763778dd9c4573cd619c06bc4c26990a` |
| `src/renderer/layout/table_partial.rs` | `9e0a4d66d00906d4c949481088dba04d81d1f04ac1091b09188d65a9140ddeab` | `cebac7b673a9c051bf31e64bcc6d2310f669b74a97bfd6351d663a9cc5b452d6` |

네 번째 패치는 저장된 인라인 표의 일반 텍스트 행이 저장된 크기보다 커졌을 때 측정된 높이를 유지하고, 쪽 나눔에도 같은 높이를 사용합니다. 저장된 셀 크기, 텍스트 및 중첩 표의 표시 영역 규칙은 변경하지 않습니다. 합성 저장 표 테스트 자료로 내용의 쪽 경계 안 배치와 내보낸 뒤 다시 열었을 때의 내용 보존을 확인합니다.

고정된 소스 ZIP은 변경하지 않는 engine-r2 릴리스에서 받습니다.
<https://github.com/wansucong-stoom/stoom-pwh/releases/download/engine-rhwp-0.8.7-pwh-r2/pwh-upstream-rhwp-0.8.7-1a76570e8339.zip>

보존한 소스 스냅샷에는 참조 문서와 `saved/`가 의도적으로 빠져 있습니다. 라이브러리의 `newBlank` 구현은 컴파일할 때 `saved/blank2010.hwp`를 포함하므로, 재빌드에는 원본 빈 문서 양식이 필요합니다. 고정 커밋의 원본 위치는 다음과 같습니다.
<https://raw.githubusercontent.com/edwardkim/rhwp/1a76570e833917d15817415a53c09ad61ab3203f/saved/blank2010.hwp>

이 파일을 로컬 입력으로 제공하면 스크립트가 복사 전에 해시를 검증합니다. 사용자 문서나 기관 양식은 필요하지 않습니다.

Windows 빌드에는 Rust의 `1.93.1-x86_64-pc-windows-gnu` 도구 체인과 공식 `wasm-bindgen-0.2.127-x86_64-pc-windows-msvc` 실행 파일을 사용했습니다. 도구의 호스트 식별자는 WebAssembly 컴파일 대상을 변경하지 않습니다. 호환되는 도구 체인과 `wasm32-unknown-unknown` 표준 라이브러리가 미리 설치되어 있어야 합니다.

<a id="rebuild-into-a-separate-candidate"></a>
## 별도의 후보 코어로 재빌드

`scripts/build-patched-core.mjs`는 모든 경로를 인수로 받습니다. 유지 관리자의 홈·작업 공간 경로를 사용하거나, 런타임을 설치하거나, 엔진 잠금 파일을 수정하거나, 기존 소스·출력 디렉터리를 덮어쓰지 않습니다. 패치를 적용하기 전에 소스와 패치를 검증하고 예상하지 않은 소스 리비전은 거절합니다. 네 패치가 모두 필요하며 기록된 순서대로 적용됩니다. Windows의 전역 `core.autocrlf` 설정이 소스 해시를 바꾸지 않도록 패치를 적용할 때 Git의 줄바꿈 변환을 명시적으로 끕니다.

저장소를 내려받고 필요한 입력과 도구를 로컬에 준비한 뒤 실행하는 예입니다.

```powershell
$env:RUSTUP_TOOLCHAIN = '1.93.1-x86_64-pc-windows-gnu'
node scripts/build-patched-core.mjs `
  --source-archive C:\pwh-inputs\pwh-upstream-rhwp-0.8.7-1a76570e8339.zip `
  --blank-template C:\pwh-inputs\blank2010.hwp `
  --source-root C:\pwh-rebuild\source `
  --output-root C:\pwh-rebuild\candidate-core `
  --wasm-bindgen C:\pwh-tools\wasm-bindgen.exe
```

Node.js 22.12 이상, Python 3.11 이상, Git과 고정된 Rust 도구가 PATH에 있어야 합니다. 또는 `--python`, `--cargo`, `--rustc`, `--wasm-bindgen`으로 경로를 지정할 수 있습니다. `RUSTUP_HOME`과 `CARGO_HOME`은 상속되며 격리된 빌드 환경을 가리킬 수 있습니다. `--target-dir`로 기존 컴파일 캐시를 재사용할 수 있습니다. `--offline`은 Cargo의 의존성 다운로드를 막으므로 필요한 의존성이 이미 있어야 합니다. `--prepare-only`는 컴파일러를 실행하지 않고 소스·해시·패치·작업 공간·양식을 준비합니다. 실행할 때마다 새로운 소스·출력 경로를 선택하세요. 실패한 후보 디렉터리는 삭제하지 않고 검토용으로 보존합니다.

실제 빌드 명령은 다음과 같습니다.

```text
cargo build --lib --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-name rhwp --out-dir <candidate-core> <target>/wasm32-unknown-unknown/release/rhwp.wasm
```

원본의 기본 기능을 유지하며, 요청한 경우에만 `--offline`을 추가합니다. Cargo 의존성과 Rust·wasm-bindgen 설치 파일은 이 스크립트에 포함되지 않습니다. 따라서 고정된 입력으로 재현하는 절차이며, 모든 도구가 포함된 완전한 오프라인 도구 체인이라는 뜻은 아닙니다.

<a id="workspace-and-dependency-lock-handling"></a>
## 작업 공간과 의존성 잠금 파일 처리

보존된 소스 ZIP에는 원래 작업 공간 목록에 이름이 남아 있는 독립 `tools/` 프로젝트가 없습니다. 스냅샷을 그대로 빌드하면 없는 작업 공간 manifest를 해석하는 과정에서 실패합니다. 이 WASM 라이브러리 빌드에서는 루트 작업 공간의 `members`만 `[".", "crates/*"]`로 제한하고, `default-members`, 루트 의존성 선언 및 각 크레이트 manifest는 유지합니다. 제외되는 구성원은 `tools/rhwp-subsecond`, `bindings/Native`, `tools/batch-convert` 및 세 개의 `tools/llm_verifier` 프로젝트입니다.

첫 빌드는 의도적으로 `--locked`를 사용하지 않습니다. 제외한 작업 공간 구성원에게만 필요한 잠금 항목을 Cargo가 정리해야 하기 때문입니다. 빌드 직후 스크립트는 Python의 TOML 파서로 결과 잠금 파일과 원본 ZIP의 잠금 파일을 비교합니다. 패키지가 추가되거나 유지된 패키지의 전체 잠금 레코드에서 버전, 소스, 체크섬 또는 의존성 목록이 하나라도 달라지면 **후보를 거절합니다**.

검증된 빌드에서는 원래 408개 패키지 레코드가 373개로 정리됐습니다. 35개가 삭제되고, 추가는 0개, 유지된 레코드의 변경도 0개였습니다. 여기에는 로컬 작업 공간 패키지 6개와 더 이상 쓰지 않는 레지스트리 의존성의 제거가 포함됩니다. 유지된 의존성의 버전은 갱신하지 않았습니다. 정리된 `Cargo.lock`의 SHA256은 `775639086168903cd7b5978704decf498aac7235b6a5e89c5a4fe8be325b3b06`입니다. 이 파일은 빌드 작업 공간에서 생성한 결과물이며 원본의 잠금 파일을 대체하지 않습니다.

<a id="output-and-release-boundary"></a>
## 산출물과 배포 범위

스크립트는 생성된 `.wasm`, JavaScript 연결 코드, 타입 선언, 원본 라이선스와 입력·출력 해시, 도구 버전, 잠금 파일 감사 결과가 담긴 `BUILD-RECORD.json`을 출력합니다. 생성된 연결 코드는 보존된 원본 연결 코드(`70cde06a369fa7fd4fc8bc8f3d6acaee158596ba1a116a2c72159002b0b5654e`)와 바이트 단위로 같아야 합니다.

독립적으로 반복한 **첫 번째 패치만 적용한** 빌드는 13,751,774바이트이고 SHA256은 `2af00b34b622b33d341d0be5a78f00d56dcd50d74fddca1ec71dd5d5474af907`입니다. 이는 행 최소 높이 보완의 과거 검증 기록이며 과거 두 패치 빌드의 식별값이 아닙니다. 현재 스크립트는 네 패치를 모두 빌드하고 각각의 입력·출력 소스 해시를 `BUILD-RECORD.json`에 기록합니다.

검증된 **두 패치 운영 빌드**는 13,752,323바이트이고 SHA256은 `a9c082330122e79120f8e0976f94837cc62625261fbb77c2fa2f51d6cb3e09d8`입니다. 그 정확한 산출물에 대해 두 합성 WASM 검사 모음이 모두 통과했습니다. 행 안에 내용이 들어가는지, 저장된 간격 대조군, 표 뒤 텍스트 커서 위치, 연속된 표와 쪽 경계를 포함해 25개 통과, 0개 실패, 0개 건너뜀입니다. 재빌드할 때마다 실제 해시를 기록하고, 컴파일러 경로나 빌드 환경 차이가 생기면 같은 빌드로 임의 표기하지 말고 원인을 확인해야 합니다.

패키징 전에 재빌드한 코어로 합성 회귀 테스트 자료를 실행하세요. 줄바꿈한 NO_LS 행에 내용이 들어가고, 내용이 들어가는 행은 기존 보정을 유지해야 합니다. 내보내고 다시 열었을 때 문서 내용과 원본 셀 높이가 유지되고, 스냅샷 실행 취소로 원래 상태가 복원되어야 합니다. 컴파일 성공이나 패치 해시 확인만으로 렌더링이 검증되는 것은 아닙니다.

인라인 표 간격은 표 높이, 바깥 여백, 속성 켜짐·꺼짐과 퍼센트 설정을 각각 바꿔 비교합니다. 기존 배치가 유지되는지 확인할 수 있도록 100% 대조군과 저장 LINE_SEG 대조군을 포함합니다. 내보내기·다시 열기 후 보존 및 쪽 경계 사례와 함께, 뒤따르는 문단의 표시 위치와 커서 위치를 모두 확인합니다. 공통 줄 상자 계산을 특정 문서에만 맞춘 픽셀 보정으로 대체하지 않습니다.

후보 코어를 지정해 두 검사 모음을 실행합니다.

```powershell
$env:PWH_CORE_JS = 'C:\pwh-rebuild\candidate-core\rhwp.js'
$env:PWH_CORE_WASM = 'C:\pwh-rebuild\candidate-core\rhwp_bg.wasm'
node --test tests/rowbreak-table-height.test.mjs tests/tac-table-line-spacing.test.mjs
```

이 테스트 자료에는 합성 텍스트와 배치 정보만 있습니다. 사용자 문서, 기관 보고서, 원본 문서 경로 또는 연구 원고는 포함하지 않습니다. 두 환경 변수를 모두 지정하지 않으면 코어 의존 검사가 건너뛰어지며, 건너뛴 실행은 후보 엔진을 검증한 것이 아닙니다.

수정한 코어를 배포할 때는 **새로운 불변 엔진 리비전**, 별도의 출처 정보 및 런타임 manifest가 필요합니다. engine-r2와 원래 npm 코어 바이트를 유지하세요. `scripts/preserve-engine.py`가 원래 코어가 바뀌지 않았는지 확인하는 조건을 우회하거나, 변경된 바이트를 기존 식별자로 허용하도록 바꾸면 안 됩니다. 패치한 리비전은 명시적인 배포 절차로 준비·검증합니다. 재빌드 스크립트는 이를 게시하거나 `runtime-lock.json`을 수정하지 않습니다.

<a id="preserve-a-later-patched-runtime"></a>
## 이후 패치 런타임 보존

`scripts/preserve-engine.py`는 원본 바이너리를 보존하며 최초 소스·라이선스 보존에 계속 사용합니다. 패치된 코어를 패키징하기 위해 원래 코어 검사를 약화해서는 안 됩니다.

`scripts/preserve-patched-runtime.py`는 이전 불변 런타임 아카이브와 전체 manifest, 새로 최적화한 코어의 `BUILD-RECORD.json`, 현재 패치의 모든 해시, 버전이 지정된 인라인 클라이언트 파일의 해시를 검증합니다. 인라인 빌드에서 호스트가 제공한 WASM을 찾는 부분도 정규화해 나머지 JavaScript 연결 코드가 재빌드한 코어와 정확히 일치함을 확인합니다. 통과한 회귀 검사 근거는 정확한 WASM 및 빌드 기록 다이제스트를 식별해야 합니다. 스크립트는 새 출력 디렉터리에 새 런타임 ZIP, 소스·빌드 입력 아카이브, 검증 기록 및 제안된 잠금 파일을 생성합니다. 프로젝트의 잠금 파일이나 설치된 런타임에는 쓰지 않습니다.

코어와 인라인 클라이언트 회귀 검사를 완료한 뒤 실행하는 예입니다.

```text
python scripts/preserve-patched-runtime.py --base-lock <preserved-r3-runtime-lock.json> --base-archive <verified-r3.zip> --candidate-core <optimized-core> --client-root client --client-build-root <studio-build-root> --regression-evidence <passing-core-regression.json> --revision 4 --output-dir <new-r4-output>
```

현재 Pwh와 Desktop 인라인 클라이언트는 새로운 공통 코어를 사용합니다. 별도로 보존한 과거 전체 Studio 구성 요소는 기본적으로 이전 바이트를 유지합니다. 묶여 있는 WASM은 ABI가 일치할 것이라는 추측만으로 교체하면 안 됩니다. 전체 교체에는 선택적 `--studio-replacement`와 `--studio-verification` 입력을 통해 명시적인 트리 해시와 스모크 테스트 근거가 필요합니다. 이 적용 범위는 manifest와 검증 파일에 기록합니다. 기존 원본 소스, 의존성 및 라이선스 자산은 변경되지 않는 기존 URL을 유지합니다.
