import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const exec = promisify(execFile);
export const pythonOptions = {cwd: projectRoot, shell: false, windowsHide: true,
  timeout: 120000, maxBuffer: 4 * 1024 * 1024, env: {...process.env, PYTHONUTF8: '1'}};

export async function testTempDirectory(prefix) {
  const base = process.env.PWH_TEST_TMP_ROOT || os.tmpdir();
  await fs.mkdir(base, {recursive: true});
  return fs.mkdtemp(path.join(base, prefix));
}

export async function findPython() {
  const explicit = process.env.PWH_PYTHON_PATH || process.env.HWPXYZ_PYTHON_PATH;
  for (const candidate of explicit ? [explicit] : ['python3', 'python']) {
    try {
      await exec(candidate, ['-B', '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'],
        {...pythonOptions, timeout: 10000});
      return candidate;
    } catch {}
  }
  throw new Error('Tests require Python 3.11+. Put it on PATH or set PWH_PYTHON_PATH.');
}

// Entirely synthetic XML: no institution documents, logos or proprietary fonts.
const buildFixture = String.raw`
import sys,zipfile
from pathlib import Path
out=Path(sys.argv[1])
lines='<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1100" textheight="1100" baseline="900" spacing="660" horzpos="0" horzsize="40000" flags="0"/></hp:linesegarray>'
def p(text, char='5', extra='', pid='0'):
 return f'<hp:p id="{pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="{char}">{extra}<hp:t>{text}</hp:t></hp:run>{lines}</hp:p>'
header='''<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">
 <hh:refList><hh:fontfaces itemCnt="2">
  <hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="Fixture Sans" type="TTF"/></hh:fontface>
  <hh:fontface lang="LATIN" fontCnt="1"><hh:font id="0" face="Fixture Sans" type="TTF"/></hh:fontface>
 </hh:fontfaces><hh:borderFills itemCnt="1"><hh:borderFill id="1"><hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/></hh:borderFill></hh:borderFills>
 <hh:charProperties itemCnt="2">
  <hh:charPr id="0" height="1200" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0"><hh:fontRef hangul="0" latin="0"/><hh:ratio hangul="100" latin="100"/><hh:spacing hangul="0" latin="0"/></hh:charPr>
  <hh:charPr id="5" height="1100" textColor="#0000FF" shadeColor="none" useFontSpace="0" useKerning="0"><hh:fontRef hangul="0" latin="0"/><hh:ratio hangul="95" latin="95"/><hh:spacing hangul="-9" latin="-9"/><hh:bold/></hh:charPr>
 </hh:charProperties><hh:paraProperties itemCnt="2">
  <hh:paraPr id="0"><hh:align horizontal="LEFT"/><hh:margin><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/></hh:paraPr>
  <hh:paraPr id="1"><hh:align horizontal="CENTER"/><hh:heading type="OUTLINE" level="1"/><hh:lineSpacing type="PERCENT" value="115" unit="HWPUNIT"/></hh:paraPr>
 </hh:paraProperties><hh:styles itemCnt="2"><hh:style id="0" type="PARA" name="Fixture Body" engName="Fixture Body" paraPrIDRef="0" charPrIDRef="0"/><hh:style id="1" type="PARA" name="Fixture Heading" engName="Fixture Heading" paraPrIDRef="1" charPrIDRef="5"/></hh:styles></hh:refList>
</hh:head>'''
section_properties='<hp:secPr id="0"><hp:pagePr width="59528" height="84188" landscape="WIDELY"><hp:margin left="8504" right="8504" top="5669" bottom="5669" header="4252" footer="4252" gutter="0"/></hp:pagePr></hp:secPr>'
header_control='<hp:ctrl><hp:header id="7" applyPageType="BOTH"><hp:subList>'+p('고정 머리말','0')+'</hp:subList></hp:header></hp:ctrl>'
def cell(col, span, text, extra=''):
 return f'<hp:tc name="" header="0" hasMargin="1" borderFillIDRef="1"><hp:subList vertAlign="CENTER">'+p(text,extra=extra)+f'</hp:subList><hp:cellAddr colAddr="{col}" rowAddr="0"/><hp:cellSpan colSpan="{span}" rowSpan="1"/><hp:cellSz width="{16000*span}" height="3000"/><hp:cellMargin left="120" right="130" top="140" bottom="150"/></hp:tc>'
table='<hp:tbl id="10" rowCnt="1" colCnt="3" borderFillIDRef="1"><hp:sz width="48000" height="3000" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="1" vertOffset="0" horzOffset="0"/><hp:caption side="BOTTOM" width="48000" gap="850"><hp:subList>'+p('합성 표 캡션','0')+'</hp:subList></hp:caption><hp:tr>'+cell(0,1,'원본 셀 텍스트')+cell(1,2,'보호된 제목','<hp:ctrl><hp:colPr id="11" type="NEWSPAPER" colCount="1" sameSz="1"/></hp:ctrl>')+'</hp:tr></hp:tbl>'
section='<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'+p('합성 양식','0',section_properties+header_control)+p('원본 본문 문단')+p('', '0',table)+p('첫 텍스트</hp:t><hp:t>둘째 텍스트')+'</hs:sec>'
package='''<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>'''
with zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED) as z:
 z.writestr('mimetype','application/hwp+zip',compress_type=zipfile.ZIP_STORED)
 z.writestr('Contents/content.hpf',package)
 z.writestr('Contents/header.xml',header)
 z.writestr('Contents/section0.xml',section)
 z.writestr('Preview/PrvText.txt','합성 양식\n원본 본문 문단\n원본 셀 텍스트')
 z.writestr('BinData/fixture.bin',bytes(range(32)))
`;

export async function makeHwpxFixture(directory, python) {
  const source = path.join(directory, 'synthetic-template.hwpx');
  await exec(python, ['-B', '-c', buildFixture, source], pythonOptions);
  return {source, cellPath: '/sec/p[2]/run[0]/tbl[0]/tr[0]/tc[0]', cellText: '원본 셀 텍스트',
    protectedCellPath: '/sec/p[2]/run[0]/tbl[0]/tr[0]/tc[1]', protectedParagraphPath: '/sec/p[2]',
    leafPath: '/sec/p[2]/run[0]/tbl[0]/tr[0]/tc[1]/subList[0]/p[0]/run[0]/t[0]', leafText: '보호된 제목',
    multipleTextLeafPath: '/sec/p[3]/run[0]/t[0]'};
}
