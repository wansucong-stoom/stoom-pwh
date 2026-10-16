# 별도 로컬 Studio 서버 호환 경로

이 문서는 사용자가 별도 로컬 Studio 공유 서버를 명시했을 때만 읽는다. 기본 우측 파일 편집기의 pwh_editor_* 세션과 pwh_live_* 세션은 다른 경로다. 기본 편집기를 고치기 위해 새 로컬 서버를 열거나 미저장 문서를 바꾸지 않는다.

### 완성된 HWPX를 우측에서 바로 편집

아래 절은 사용자가 별도 로컬 Studio 공유 편집 경로를 명시한 경우에만 적용한다. 기본 HWPX 클라이언트 미리보기 요청에는 파일 패널을 사용한다. 사용자가 Studio에서 완성본을 직접 편집하거나 주석으로 함께 수정하겠다고 요청하면 PDF 미리보기만 열고 끝내지 않는다. `pwh_live_status`로 현재 연결과 미저장 상태를 확인하고, 덮어쓸 미저장 편집이 없을 때 `pwh_live_open`에 완성 HWPX 절대 경로를 전달한다. Codex의 `open_in_codex`가 있으면 반환 URL을 browser 대상으로 `placement:right`에 연다. 다른 호스트에서는 지원되는 브라우저 패널로 연다. 열고 나서 `pwh_live_read`로 실제 문서 이름·본문·state를 확인해야 연결됐다고 보고한다.

사용자는 편집기에서 직접 입력·서식 변경 후 새 수정본으로 저장할 수 있다. AI 수정은 문단·표 셀 등을 선택하고 수정 내용을 작성한 다음 하단의 `AI 수정 요청`을 눌러 채팅으로 전송한다. 호스트 주석 API가 없으면 `수정 요청 복사`로 표시되며 요청 ID를 포함한 문구를 채팅에 붙여넣는 경로를 사용한다. 이 차이를 숨기거나 자동 메시지 전송을 보장하지 않는다.

PDF 뷰어의 `편집 요청`과 브라우저 영역 주석은 Codex 호스트의 기본 기능이다. pwh가 PDF 주석 서비스를 제공한다고 설명하지 않는다. PDF 주석만 수신한 경우에도 대상 파일/버전·위치를 대조하고 실제 HWPX를 수정한 뒤 재조판해야 한다. 공유 편집 요청은 `pwh_live_request`와 현재 `pwh_live_read` 상태를 대조하고 live_apply/live_save 경로로 처리한다.

pwh_live_open에 원본 절대 경로를 전달하고 반환 URL을 Codex 브라우저 패널에서 연다. 경로를 생략하면 현재 세션 또는 빈 문서를 사용한다. 기존 세션에 미저장 변경이 있으면 임의로 다른 문서로 교체하지 않는다.

사용자 요청을 처리할 때마다 pwh_live_read로 현재 state·selection·text를 읽는다. 디스크 파일을 읽은 결과만으로 사용자의 미저장 편집을 판단하지 않는다. 현재 세션 정보는 pwh_live_status로 확인한다. 에이전트가 화면을 계속 보고 있거나 사용자 입력만으로 대화가 자동 시작된다고 말하지 않는다.

로컬 선택 브리지가 연결되면 selection에 실제 cursor, 선택 start/end, selectedText, 현재 paragraph, formatting.character/paragraph, table, objects, selectionRects가 포함된다. source 주소는 0부터 시작하며 rect는 확대 전 쪽 CSS 픽셀이다. known·truncated·unknown과 개수 제한을 확인한다. 머리말·꼬리말·각주의 좌표와 비직사각 셀 제외 목록처럼 노출되지 않는 문맥은 지원된다고 추측하지 않는다.

브리지가 없으면 SDK의 제한된 선택 문맥만 반환할 수 있다. 이때 빈 선택 또는 문단 안의 정확한 위치를 안다고 가정하지 말고 명시적 주소를 확인한다.

## 같은 문서 수정

pwh_live_commands로 실제 명령 ID·실행 가능 상태를 확인한다. 메뉴·서식 변경에는 pwh_live_apply의 command를 사용하고 직전 read의 state 전체를 expectedState로 전달한다. 메뉴 명령은 문서 상태와 선택 fingerprint를 대조한다. STATE_CONFLICT 또는 SELECTION_CONFLICT가 발생하면 다시 읽고 대상·요청을 재평가한다. 새 상태 값만 기계적으로 바꿔 재실행하지 않는다.

복잡한 작업은 같은 편집기의 hwpctrl 배치 또는 지원되는 applyTextCommand를 사용한다.

~~~json
{
  "operation": {"type":"command","id":"실제 조회한 ID","params":{}},
  "expectedState": {"documentEpoch":0,"changeSeq":0,"documentSha256":"직전 read 값","selectionFingerprint":"직전 read 값"}
}
~~~

허용 operation은 command, hwpctrl의 calls:[{method,args}], applyTextCommand의 command, undo, redo다. 각 API의 실제 계약을 먼저 확인한다. HwpCtrl의 자체 커서는 사용자가 화면에서 선택한 위치와 별개다. SetTextFile의 UNICODE 동작도 현재 선택 교체로 가정하지 않는다. 명시적인 문서 주소로 대상을 지정하고 변경 직후 다시 읽어 사용자 입력과 양식이 보존됐는지 확인한다.

exact text command는 버전이 지원하는 본문·서식 범위에 제한이 있다. 표 셀·도형·혼합 서식까지 일반 본문 명령으로 처리하지 않는다. unsupported 결과를 우회해 전체 문서를 평문으로 재작성하지 않는다.

live 화면을 수정할 때에는 live 경로를 쓴다. rhwp-core 네이티브 MCP나 CLI로 디스크 문서만 바꾸고 현재 화면도 수정되었다고 보고하지 않는다. 네이티브 도구가 필요한 경우 현재 세션을 새 파일로 저장한 뒤 명확히 별도 수정본으로 다루고 사용자 미저장 변경을 보존한다.

## 선택한 객체의 수정 요청

pwh_live_request에 requestId를 전달하면 선택 문맥과 요청 시점의 state를 읽을 수 있다. 받은 요청의 세션·문서 상태·선택 fingerprint를 현재 pwh_live_read와 비교한다. 달라졌으면 현재 대상을 재확인하고 요청 의도가 유지되는지 판단한다.

호스트가 지원하면 화면의 AI 수정 요청으로 선택 문맥과 주석을 전달하고, 지원하지 않으면 요청을 복사해 사용자가 채팅에 붙여넣는다. 실제로 수신하지 않은 주석을 알고 있다고 말하지 않는다. 캔버스의 각 글자가 DOM 요소로 존재한다고 가정하지 않는다. 좌표만으로 문단·셀·개체 주소를 확정하지 말고 실제 선택 참조와 문서 구조를 함께 확인한다.


변경 후 pwh_live_read로 최신 문구·선택·state를 확인하고 실제 화면을 검수한다. pwh_live_save에 새 output과 최신 expectedState를 전달하며 저장본은 엔진 재열기와 필요한 쪽 조판으로 확인한다.

~~~text
node src/live.mjs serve [ABSOLUTE_FILE]
node src/live.mjs status
node src/live.mjs read
node src/live.mjs commands
node src/live.mjs apply REQUEST_JSON
node src/live.mjs save [NEW_OUTPUT]
~~~

serve 프로세스를 유지해야 이 별도 브라우저가 연결된다. 기본 파일 편집기를 위해 이 프로세스를 시작하지 않는다.
