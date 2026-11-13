const item=(command,label,icon,extra={})=>({command,label,icon,...extra});
const group=(label,items)=>({label,items});
// Command identities belong to the shared editor. A missing command is never
// presented as an implemented feature merely to fill out a familiar layout.
export const ribbonTabs=[
 {id:'edit',label:'편집',groups:[
  group('클립보드',[item('edit:cut','오려 두기','cut'),item('edit:copy','복사하기','copy'),item('edit:paste','붙이기','paste'),item('edit:format-copy','모양 복사','brush')]),
  group('편집',[item('edit:undo','되돌리기','undo'),item('edit:redo','다시 실행','redo'),item('edit:select-all','모두 선택','select')]),
  group('모양',[item('format:char-shape','글자 모양','character'),item('format:para-shape','문단 모양','paragraph'),item('format:style-dialog','스타일','styles')]),
  group('용지',[item('page:setup','편집 용지','page'),item('page:col-settings','단 설정','columns')]),
  group('개체',[item('insert:shape','도형','shape'),item('insert:image','그림','image'),item('table:create','표','table'),item('format:object-properties','개체 속성','object')]),
  group('찾기',[item('edit:find','찾기','search'),item('edit:find-replace','찾아 바꾸기','replace'),item('edit:goto','찾아가기','goto')])
 ]},
 {id:'view',label:'보기',groups:[
  group('표시',[item('view:para-mark','문단 부호','paragraph',{toggle:true}),item('view:ctrl-mark','조판 부호','marks',{toggle:true}),item('view:border-transparent','투명 선','border',{toggle:true}),item('view:toggle-clip','잘림 보기','crop',{toggle:true})]),
  group('격자',[item('view:toggle-grid','격자 보기','grid',{toggle:true}),item('view:grid-settings','격자 설정','settings')]),
  group('도구 상자',[item('view:toolbox-basic','기본 도구','toolbar',{toggle:true}),item('view:toolbox-format','서식 도구','character',{toggle:true})]),
  group('확대/축소',[item('view:zoom-out','축소','zoom-out'),item('view:zoom-in','확대','zoom-in'),item('view:zoom-100','100%','zoom-100'),item('view:zoom-dialog','확대/축소','zoom')]),
  group('화면 맞춤',[item('view:zoom-fit-page','쪽 맞춤','fit-page'),item('view:zoom-fit-width','폭 맞춤','fit-width')]),
  group('화면 색',[item('view:theme-light','밝게','sun'),item('view:theme-dark','어둡게','moon'),item('view:theme-system','시스템 설정','screen')])
 ]},
 {id:'insert',label:'입력',groups:[
  group('개체',[item('insert:shape','도형','shape'),item('insert:image','그림','image'),item('table:create','표','table'),item('insert:textbox','글상자','textbox'),item('insert:equation','수식','equation')]),
  group('입력 요소',[item('insert:field','누름틀/필드','field')]),
  group('주석',[item('insert:footnote','각주','footnote'),item('insert:endnote','미주','endnote'),item('insert:endnote-shape','각주·미주 모양','note-settings')]),
  group('연결',[item('insert:bookmark','책갈피','bookmark'),item('insert:hyperlink','하이퍼링크','link')]),
  group('문자',[item('insert:symbols','문자표','symbols')])
 ]},
 {id:'format',label:'서식',groups:[
  group('스타일',[{special:'styles',label:'문서 스타일',icon:'styles'},item('format:style-dialog','스타일 설정','styles')]),
  group('글자',[item('format:char-shape','글자 모양','character'),item('format:bold','진하게','bold',{toggle:true}),item('format:italic','기울임','italic',{toggle:true}),item('format:underline','밑줄','underline',{toggle:true}),item('format:strikethrough','취소선','strike',{toggle:true}),item('format:font-size-increase','글자 크게','text-plus'),item('format:font-size-decrease','글자 작게','text-minus')]),
  group('문단',[item('format:para-shape','문단 모양','paragraph'),item('format:align-left','왼쪽 정렬','align-left'),item('format:align-center','가운데 정렬','align-center'),item('format:align-right','오른쪽 정렬','align-right'),item('format:align-justify','양쪽 정렬','align-justify')]),
  group('번호·간격',[item('format:toggle-numbering','문단 번호','numbering'),item('format:bullet-shape','글머리표','bullets'),item('format:level-increase','수준 증가','indent'),item('format:level-decrease','수준 감소','outdent'),item('format:line-spacing-increase','줄 간격 늘림','spacing-plus'),item('format:line-spacing-decrease','줄 간격 줄임','spacing-minus')])
 ]},
 {id:'page',label:'쪽',groups:[
  group('용지',[item('page:setup','편집 용지','page'),item('page:page-border','쪽 테두리/배경','page-border')]),
  group('머리말·꼬리말',[item('page:header-create','머리말','header'),item('page:footer-create','꼬리말','footer')]),
  group('쪽 번호',[item('page:new-page-num','새 번호로 시작','page-number'),item('page:hide-current','현재 쪽 감추기','hide-page')]),
  group('나누기',[item('page:break','쪽 나누기','page-break'),item('page:column-break','단 나누기','column-break'),item('page:section-settings','구역 설정','section')]),
  group('단',[item('page:col-1','1단','column-one'),item('page:col-2','2단','columns'),item('page:col-3','3단','column-three'),item('page:col-settings','단 설정','settings')])
 ]},
 {id:'table',label:'표',groups:[
  group('표',[item('table:create','표 만들기','table'),item('table:cell-props','표/셀 속성','table-settings'),item('format:object-properties','개체 속성','object')]),
  group('줄·칸',[item('table:insert-row-col','줄/칸 추가','row-plus'),item('table:delete-row-col','줄/칸 지우기','row-minus'),item('table:cell-merge','셀 합치기','merge'),item('table:cell-split','셀 나누기','split')]),
  group('셀 크기',[item('table:cell-width-equal','너비를 같게','equal-width'),item('table:cell-height-equal','높이를 같게','equal-height')]),
  group('테두리',[item('table:border-each','각 셀 테두리','grid'),item('table:border-one','하나의 셀처럼','border')]),
  group('계산',[item('table:block-formula','블록 계산식','equation'),item('table:block-sum','합계','sum'),item('table:block-avg','평균','average'),item('table:block-product','곱','product')]),
  group('행/열 바꿈',[item('table:transpose-copy','바꿈 복사','transpose'),item('table:transpose-paste','바꿈 붙이기','paste')])
 ]},
 {id:'tool',label:'도구',groups:[
  group('문서 검토',[item('edit:document-history','문서 이력','history'),item('edit:compare-documents','문서 비교','compare')]),
  group('설정',[item('tool:options','환경 설정','settings'),item('format:style-dialog','스타일 설정','styles')]),
  group('제품',[item('file:about','제품 정보','info')])
 ]}
];

export function availableRibbonGroups(tab,hasCommand){
 return tab.groups.map(group=>({...group,items:group.items.filter(item=>item.special==='styles'||hasCommand(item.command))})).filter(group=>group.items.length);
}
export function ribbonCommandIds(){return [...new Set(ribbonTabs.flatMap(tab=>tab.groups.flatMap(group=>group.items.map(item=>item.command).filter(Boolean))))];}
