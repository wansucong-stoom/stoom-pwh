// Common calendar/alphabet/number sequences, generated independently of UI assets.
const split=value=>value.split(',');
const entries=[];
const add=(id,label,values)=>entries.push({id,label,values:typeof values==='string'?split(values):values});
const variants=(id,label,values)=>{
 add(id,label,values);add(id+'-lower',label+' · 소문자',values.map(v=>v.toLowerCase()));add(id+'-upper',label+' · 대문자',values.map(v=>v.toUpperCase()));
};
const months=split('January,February,March,April,May,June,July,August,September,October,November,December');
add('months-ko','월 이름','일월,이월,삼월,사월,오월,유월,칠월,팔월,구월,시월,십일월,십이월');
add('months-number','월',Array.from({length:12},(_,i)=>(i+1)+'월'));
add('months-hanja','한자 월','一月,二月,三月,四月,五月,六月,七月,八月,九月,十月,十一月,十二月');
variants('months-en','영문 월',months);variants('months-en-short','영문 월 약자',months.map(v=>v.slice(0,3)));
const week=split('월,화,수,목,금,토,일'),weekEn=split('Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'),weekHanja=split('月,火,水,木,金,土,日');
for(const sunday of [false,true]){
 const rotate=values=>sunday?[values.at(-1),...values.slice(0,-1)]:values;
 const id=sunday?'sun':'mon',label=sunday?'일요일부터':'월요일부터';
 add('week-'+id,'요일 · '+label,rotate(week));add('week-full-'+id,'요일 이름 · '+label,rotate(week.map(v=>v+'요일')));
 add('week-hanja-'+id,'한자 요일 · '+label,rotate(weekHanja));
 variants('week-en-'+id,'영문 요일 · '+label,rotate(weekEn));
 variants('week-en-short-'+id,'영문 요일 약자 · '+label,rotate(weekEn.map(v=>v.slice(0,3))));
}
add('hangul-names','한글 자음 이름','기역,니은,디귿,리을,미음,비읍,시옷,이응,지읒,치읓,키읔,티읕,피읖,히읗');
add('hangul-consonants','한글 자음',Array.from('ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'));
add('hangul-syllables','가나다',Array.from('가나다라마바사아자차카타파하'));
add('alphabet-upper','알파벳 대문자',Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
add('alphabet-lower','알파벳 소문자',Array.from('abcdefghijklmnopqrstuvwxyz'));
const stems=split('갑,을,병,정,무,기,경,신,임,계'),branches=split('자,축,인,묘,진,사,오,미,신,유,술,해');
const stemsH=Array.from('甲乙丙丁戊己庚辛壬癸'),branchesH=Array.from('子丑寅卯辰巳午未申酉戌亥');
add('stems','천간',stems);add('stems-hanja','천간 · 한자',stemsH);
add('branches','지지',branches);add('branches-hanja','지지 · 한자',branchesH);
add('cycle','육십갑자',Array.from({length:60},(_,i)=>stems[i%10]+branches[i%12]));
add('cycle-hanja','육십갑자 · 한자',Array.from({length:60},(_,i)=>stemsH[i%10]+branchesH[i%12]));
add('seasons','24절기','입춘,우수,경칩,춘분,청명,곡우,입하,소만,망종,하지,소서,대서,입추,처서,백로,추분,한로,상강,입동,소설,대설,동지,소한,대한');
add('seasons-hanja','24절기 · 한자','立春,雨水,驚蟄,春分,淸明,穀雨,立夏,小滿,芒種,夏至,小暑,大暑,立秋,處暑,白露,秋分,寒露,霜降,立冬,小雪,大雪,冬至,小寒,大寒');
add('joseon','조선 왕 이름','태조,정종,태종,세종,문종,단종,세조,예종,성종,연산군,중종,인종,명종,선조,광해군,인조,효종,현종,숙종,경종,영조,정조,순조,헌종,철종,고종,순종');
add('native-numbers','한글 숫자','하나,둘,셋,넷,다섯,여섯,일곱,여덟,아홉,열,열하나,열둘,열셋,열넷,열다섯,열여섯,열일곱,열여덟,열아홉,스물');
add('native-ordinal','한글 서수','첫째,둘째,셋째,넷째,다섯째,여섯째,일곱째,여덟째,아홉째,열째,열한째,열두째,열셋째,열넷째,열다섯째,열여섯째,열일곱째,열여덟째,열아홉째,스무째');
const english=split('one,two,three,four,five,six,seven,eight,nine,ten,eleven,twelve,thirteen,fourteen,fifteen,sixteen,seventeen,eighteen,nineteen,twenty');
const ordinal=split('first,second,third,fourth,fifth,sixth,seventh,eighth,ninth,tenth,eleventh,twelfth,thirteenth,fourteenth,fifteenth,sixteenth,seventeenth,eighteenth,nineteenth,twentieth');
variants('english-numbers','영문 숫자',english.map(v=>v[0].toUpperCase()+v.slice(1)));
variants('english-ordinal','영문 서수',ordinal.map(v=>v[0].toUpperCase()+v.slice(1)));
const chinese=n=>n<10?'一二三四五六七八九'[n-1]:n===10?'十':n<20?'十'+chinese(n-10):n===20?'二十':'';
const chineseNumbers=Array.from({length:20},(_,i)=>chinese(i+1));
add('numbers','숫자',Array.from({length:20},(_,i)=>String(i+1)));
add('chinese-numbers','한자 숫자',chineseNumbers);add('chinese-ordinal','한자 서수',chineseNumbers.map(v=>'第'+v));
add('chinese-week','중국어 요일','星期天,星期一,星期二,星期三,星期四,星期五,星期六');
add('chinese-week-sunday','중국어 요일 · 일요일','星期日,星期一,星期二,星期三,星期四,星期五,星期六');
export const autoFillLists=Object.freeze(entries.map(entry=>Object.freeze({...entry,values:Object.freeze(entry.values)})));

export function validateCustomList(value){
 if(!value||typeof value.id!=='string'||!/^[\w-]{1,80}$/.test(value.id)||typeof value.label!=='string'||!value.label.trim()||value.label.length>80||
  !Array.isArray(value.values)||value.values.length<2||value.values.length>500||
  value.values.some(v=>typeof v!=='string'||!v.trim()||v.length>200||/[\r\n\u0000-\u001f]/.test(v)))
  throw Error('목록 이름과 쉼표 또는 줄바꿈으로 구분한 두 개 이상의 항목을 입력하세요.');
 return {id:value.id,label:value.label.trim(),values:value.values.map(v=>v.trim())};
}
