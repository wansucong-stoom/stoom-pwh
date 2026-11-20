// Shared routing for Desktop ChatGPT and Codex turns.
export const documentMenuTools = [
 '글자 모양이나 내용 수정은 pwh_editor_text_search로 원문과 셀 주소를 확인한 뒤 pwh_editor_text_style 또는 pwh_editor_text_edit를 사용합니다. 글자색, 굵게, 기울임, 밑줄, 취소선, 크기를 해당 범위에 적용할 수 있습니다.',
 '문단 정렬과 백분율 줄 간격은 찾은 문구의 주소를 pwh_editor_paragraph_style에 전달합니다. 본문·표·중첩 표에 같은 절차를 사용합니다.',
 '취소선 잔존 검사에는 pwh_editor_style_scan의 filter:strikethrough를 사용합니다. 표만 보려면 scope:tables를 지정하세요. nextCursor가 null일 때까지 읽고 unsupportedCellLists가 0인지 확인하세요. 결과의 searchId와 id를 글자 모양 적용에 사용할 수 있습니다.',
 '표 디자인과 셀 배경·테두리는 pwh_editor_tables와 pwh_editor_table_style을 사용합니다. 표 제목은 pwh_editor_table_title, 셀 내용 입력은 pwh_editor_table_fill, 새 표는 pwh_editor_table_insert를 사용합니다.',
 '용지와 여백은 pwh_editor_layout, 단 설정은 pwh_desktop_columns, 빈 문서의 글 작성은 pwh_editor_compose를 사용합니다.',
 'AI가 본문을 추가하거나 표·글자·문단의 배치를 바꿀 때에는 pwh_desktop_page_flow로 영향을 받은 쪽의 실제 여백을 확인하세요. 도구 ticket의 pwh_desktop_result에서 changes.overflows와 nextPage를 읽고 필요한 쪽까지 검사하세요. 기존에 있던 넘침과 이번 편집으로 새로 생긴 넘침을 구분합니다. 새로 생긴 아래쪽 넘침은 원래 여백을 유지하고 해당 문단을 다음 쪽으로 넘기세요. 표와 소제목이 함께 들어갈 수 있으면 target.beforeParagraph에 소제목 문단을 지정합니다. 한 쪽 분량이 필수이거나 사용자가 여백을 바꾸라고 했을 때는 pwh_editor_layout으로 여백을 조정할 수 있습니다. 수정 뒤 다시 검사하고 남은 넘침이 있으면 결과에 정확히 적으세요.',
 '도구가 반환한 ticket은 결과 도구에서 applied를 확인한 뒤 반영을 보고하세요. 같은 문구가 여러 곳에 있으면 원래 요청의 문맥과 셀 주소를 대조하세요.',
].join(' ');
