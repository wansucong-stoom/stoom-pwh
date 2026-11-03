import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
const seed=await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx',import.meta.url));
const line=(pos,vpos,height=1000,width=18000)=>`<hp:lineseg textpos="${pos}" vertpos="${vpos}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height*.85)}" spacing="600" horzpos="0" horzsize="${width}" flags="393216"/>`;
const para=(text,vpos=0,control='',height=1000)=>`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${control}<hp:t>${text}</hp:t></hp:run><hp:linesegarray>${line(0,vpos,height)}</hp:linesegarray></hp:p>`;
const cell=(r,c,content,h,w)=>`<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${content}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
const table=(id,rows,cols,content,h,w,inline=false,repeat=false)=>`<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="${repeat?1:0}" noAdjust="1" rowCnt="${rows}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${w}" height="${h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${inline?1:0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="100" right="100" top="100" bottom="100"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${content}</hp:tbl>`;
export function storedInlineFrameFixture({paper=18000,declared=15000,rewind=true,bandDelta=0,columns=1,inline=true,parentCaption=false}={}){
 const child=table(900,4,2,[0,1,2,3].map(r=>`<hp:tr>${[0,1].map(c=>cell(r,c,para(`DATA_${r}_${c}`),1300,9000)).join('')}</hp:tr>`).join(''),5200,18000,inline,true);
 const mixed=`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>TITLE</hp:t>${child}<hp:t/></hp:run><hp:linesegarray>${line(0,8000)}${line(5,rewind?0:9600,5400+bandDelta)}</hp:linesegarray></hp:p>`;
 const content=[0,1,2,3,4].map(n=>para(`LEAD_${n}`,n*1600)).join('')+mixed;
 let inner=table(800,3,2,`<hp:tr>${cell(0,0,para('FIRST_A'),1500,3000)}${cell(0,1,para('FIRST_B'),1500,20000)}</hp:tr><hp:tr>${cell(1,0,para('LABEL'),declared,3000)}${cell(1,1,content,declared,20000)}</hp:tr><hp:tr>${cell(2,0,para('LAST_A'),1500,3000)}${cell(2,1,para('LAST_B'),1500,20000)}</hp:tr>`,18000,23000,false,true);
 if(parentCaption)inner=inner.replace('<hp:tr>',`<hp:caption side="BOTTOM" width="23000" gap="600"><hp:subList>${para('PARENT_CAPTION')}</hp:subList></hp:caption><hp:tr>`);
 const metadata=`<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="${columns}" sameSz="1" sameGap="0"/></hp:ctrl>`;
 const outer=table(700,2,1,`<hp:tr>${cell(0,0,para('OUTER_HEAD'),1500,25000)}</hp:tr><hp:tr>${cell(1,0,para('',0,metadata+inner),24000,25000)}</hp:tr>`,25500,25000,false,true);
 const sec=`<hp:secPr id="0"><hp:pagePr width="28000" height="${paper}" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
 return mapHwpxMember(seed,'Contents/section0.xml',xml=>xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+para('',0,sec+outer,600)+'</hs:sec>'));
}
