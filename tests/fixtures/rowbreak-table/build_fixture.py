"""Build a public-safe, wholly synthetic HWPX table-height regression fixture.

No institution document, user text, image, logo, or font binary is used.
Python standard library only. No stored line-segment layout is present.
"""
from pathlib import Path
from html import escape
import json
import zipfile

OUT = Path(__file__).resolve().parent
FONT = "Batang"  # Family name only; no font binary is distributed.
LANGS = ("HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER")
ATTRS = ("hangul", "latin", "hanja", "japanese", "other", "symbol", "user")


def p(text="", extra="", pid=0):
    return (f'<hp:p id="{pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" '
            f'columnBreak="0" merged="0"><hp:run charPrIDRef="0">{extra}'
            f'<hp:t>{escape(text)}</hp:t></hp:run></hp:p>')


def cell(row, col, text, height):
    return (f'<hp:tc name="" header="{int(row == 0)}" hasMargin="1" protect="0" '
            f'editable="0" dirty="0" borderFillIDRef="1"><hp:subList id="" '
            f'textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" '
            f'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" '
            f'hasTextRef="0" hasNumRef="0">{p(text)}</hp:subList>'
            f'<hp:cellAddr colAddr="{col}" rowAddr="{row}"/>'
            f'<hp:cellSpan colSpan="1" rowSpan="1"/>'
            f'<hp:cellSz width="14173" height="{height}"/>'
            f'<hp:cellMargin left="420" right="420" top="400" bottom="400"/></hp:tc>')


def build(name, final_text):
    fontfaces = ''.join(f'<hh:fontface lang="{lang}" fontCnt="1">'
                        f'<hh:font id="0" face="{FONT}" type="TTF" isEmbedded="0"/>'
                        '</hh:fontface>' for lang in LANGS)
    attr = lambda value: ' '.join(f'{key}="{value}"' for key in ATTRS)
    borders = ''.join(f'<hh:{side}Border type="SOLID" width="0.12 mm" color="#000000"/>'
                      for side in ('left', 'right', 'top', 'bottom'))
    header = ('<?xml version="1.0" encoding="UTF-8"?>'
              '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">'
              f'<hh:refList><hh:fontfaces itemCnt="7">{fontfaces}</hh:fontfaces>'
              f'<hh:borderFills itemCnt="1"><hh:borderFill id="1">{borders}</hh:borderFill></hh:borderFills>'
              '<hh:charProperties itemCnt="1"><hh:charPr id="0" height="1100" textColor="#000000" '
              'shadeColor="none" useFontSpace="0" useKerning="0">'
              f'<hh:fontRef {attr(0)}/><hh:ratio {attr(100)}/><hh:spacing {attr(0)}/>'
              f'<hh:relSz {attr(100)}/><hh:offset {attr(0)}/></hh:charPr></hh:charProperties>'
              '<hh:paraProperties itemCnt="1"><hh:paraPr id="0">'
              '<hh:align horizontal="LEFT" vertical="BASELINE"/>'
              '<hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/>'
              '<hh:right value="0" unit="HWPUNIT"/><hh:prev value="0" unit="HWPUNIT"/>'
              '<hh:next value="0" unit="HWPUNIT"/></hh:margin>'
              '<hh:lineSpacing type="PERCENT" value="135" unit="HWPUNIT"/></hh:paraPr></hh:paraProperties>'
              '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="Body" engName="Body" '
              'paraPrIDRef="0" charPrIDRef="0"/></hh:styles></hh:refList></hh:head>')
    rows = [
        ["구분", "설명", "확인"],
        ["첫째 항목", "첫번째 문장을 확인합니다 두번째 문장을 검토합니다", "확인합니다"],
        ["둘째 항목", "표의 내용을 확인합니다", "확인합니다"],
        ["셋째 항목", "표의 내용을 확인합니다", "확인합니다"],
        ["넷째 항목", "표의 내용을 확인합니다", "확인합니다"],
        ["다섯째 항목", "표의 내용을 확인합니다", "확인합니다"],
        ["마지막 항목", final_text, "확인합니다"],
    ]
    heights = [2500] + [4050] * 6
    table = ('<hp:tbl id="1" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
             'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" '
             'repeatHeader="1" rowCnt="7" colCnt="3" cellSpacing="0" borderFillIDRef="1" noAdjust="0">'
             f'<hp:sz width="42519" widthRelTo="ABSOLUTE" height="{sum(heights)}" heightRelTo="ABSOLUTE"/>'
             '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
             'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" '
             'horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
             '<hp:outMargin left="0" right="0" top="100" bottom="200"/>'
             '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
             + ''.join('<hp:tr>' + ''.join(cell(r, c, text, heights[r]) for c, text in enumerate(row))
                       + '</hp:tr>' for r, row in enumerate(rows)) + '</hp:tbl>')
    section_properties = ('<hp:secPr id="0"><hp:pagePr width="59528" height="84188" '
                          'landscape="WIDELY"><hp:margin left="8504" right="8504" '
                          'top="5669" bottom="4252" header="4252" footer="2835" gutter="0"/>'
                          '</hp:pagePr></hp:secPr>')
    section = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
               'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
               + p("합성 표 높이 회귀 검사", section_properties, 0) + p("", table, 1)
               + p("표 다음 문단입니다.", pid=2) + '</hs:sec>')
    package = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:metadata/>'
               '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
               '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>'
               '</opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>')
    target = OUT / name
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/hwp+zip', compress_type=zipfile.ZIP_STORED)
        archive.writestr('version.xml', '<?xml version="1.0"?><HCFVersion targetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Synthetic Fixture" appVersion="1"/>')
        archive.writestr('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></rootfiles></container>')
        archive.writestr('Contents/content.hpf', package)
        archive.writestr('Contents/header.xml', header)
        archive.writestr('Contents/section0.xml', section)
        archive.writestr('Preview/PrvText.txt', '\n'.join(text for row in rows for text in row))
    return str(target)


if __name__ == '__main__':
    print(json.dumps({
        'overflow': build('synthetic-rowbreak-overflow.hwpx', '첫번째 문장을 확인합니다 두번째 문장을 검토합니다 세번째 문장을 정리합니다'),
        'two_line_control': build('synthetic-rowbreak-two-line-control.hwpx', '첫번째 문장을 확인합니다 두번째 문장을 검토합니다'),
        'single_line_control': build('synthetic-rowbreak-single-line-control.hwpx', '표의 내용을 확인합니다'),
    }, ensure_ascii=False))
