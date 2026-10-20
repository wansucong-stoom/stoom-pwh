"""Generate public-safe inline-object line-spacing fixtures; standard library only.

The sentences and XML are wholly synthetic. No institution/user document or
font binary is included. Existing row-height regression fixtures are unrelated.
"""
from pathlib import Path
from html import escape
import json
import zipfile
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parent
LANGS = ('HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER')
ATTRS = ('hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user')


def paragraph(text='', extra='', pid=0, lineseg=''):
    return (f'<hp:p id="{pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" '
            f'columnBreak="0" merged="0"><hp:run charPrIDRef="0">{extra}'
            f'<hp:t>{escape(text)}</hp:t></hp:run>{lineseg}</hp:p>')


def build(name, height, percent, affect, stored_spacing=None, treat_as_char=True,
          page_height=84188, compact_margins=False):
    fontfaces = ''.join(f'<hh:fontface lang="{lang}" fontCnt="1">'
                        '<hh:font id="0" face="Batang" type="TTF" isEmbedded="0"/>'
                        '</hh:fontface>' for lang in LANGS)
    language_attrs = lambda value: ' '.join(f'{key}="{value}"' for key in ATTRS)
    borders = ''.join(f'<hh:{side}Border type="SOLID" width="0.12 mm" color="#000000"/>'
                      for side in ('left', 'right', 'top', 'bottom'))
    header = ('<?xml version="1.0" encoding="UTF-8"?>'
              '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">'
              f'<hh:refList><hh:fontfaces itemCnt="7">{fontfaces}</hh:fontfaces>'
              f'<hh:borderFills itemCnt="1"><hh:borderFill id="1">{borders}</hh:borderFill></hh:borderFills>'
              '<hh:charProperties itemCnt="1"><hh:charPr id="0" height="1100" textColor="#000000" '
              'shadeColor="none" useFontSpace="0" useKerning="0">'
              f'<hh:fontRef {language_attrs(0)}/><hh:ratio {language_attrs(100)}/>'
              f'<hh:spacing {language_attrs(0)}/><hh:relSz {language_attrs(100)}/>'
              f'<hh:offset {language_attrs(0)}/></hh:charPr></hh:charProperties>'
              '<hh:paraProperties itemCnt="1"><hh:paraPr id="0">'
              '<hh:align horizontal="LEFT" vertical="BASELINE"/>'
              '<hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/>'
              '<hh:right value="0" unit="HWPUNIT"/><hh:prev value="0" unit="HWPUNIT"/>'
              '<hh:next value="0" unit="HWPUNIT"/></hh:margin>'
              f'<hh:lineSpacing type="PERCENT" value="{percent}" unit="HWPUNIT"/>'
              '</hh:paraPr></hh:paraProperties>'
              '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="Body" engName="Body" '
              'paraPrIDRef="0" charPrIDRef="0"/></hh:styles></hh:refList></hh:head>')
    cell = ('<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" '
            'borderFillIDRef="1"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" '
            'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" '
            'textHeight="0" hasTextRef="0" hasNumRef="0">'
            + paragraph('합성 표의 내용입니다.') + '</hp:subList>'
            '<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
            f'<hp:cellSz width="30000" height="{height}"/>'
            '<hp:cellMargin left="420" right="420" top="400" bottom="400"/></hp:tc>')
    table = ('<hp:tbl id="1" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
             'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" '
             'repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="1" noAdjust="0">'
             f'<hp:sz width="30000" widthRelTo="ABSOLUTE" height="{height}" heightRelTo="ABSOLUTE"/>'
             f'<hp:pos treatAsChar="{int(treat_as_char)}" affectLSpacing="{int(affect)}" '
             'flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" '
             'horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
             '<hp:outMargin left="0" right="0" top="100" bottom="200"/>'
             '<hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:tr>' + cell + '</hp:tr></hp:tbl>')
    top, bottom, header_height, footer_height = (750, 750, 0, 0) if compact_margins else (5669, 4252, 4252, 2835)
    secpr = (f'<hp:secPr id="0"><hp:pagePr width="59528" height="{page_height}" landscape="WIDELY">'
             f'<hp:margin left="8504" right="8504" top="{top}" bottom="{bottom}" header="{header_height}" '
             f'footer="{footer_height}" gutter="0"/></hp:pagePr></hp:secPr>')
    lineseg = ''
    if stored_spacing is not None:
        line_height = height + 300
        lineseg = ('<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" '
                   f'vertsize="{line_height}" textheight="{line_height}" baseline="{line_height}" '
                   f'spacing="{stored_spacing}" horzpos="0" horzsize="42520" flags="0"/>'
                   '</hp:linesegarray>')
    section = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
               'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
               + paragraph('합성 줄 간격 검사', secpr, 0)
               + paragraph('', table, 1, lineseg)
               + paragraph('표 다음 본문입니다.', pid=2) + '</hs:sec>')
    package = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:metadata/>'
               '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
               '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>'
               '</opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>')
    with zipfile.ZipFile(OUT / name, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/hwp+zip', compress_type=zipfile.ZIP_STORED)
        archive.writestr('version.xml', '<?xml version="1.0"?><HCFVersion targetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Synthetic Fixture" appVersion="1"/>')
        archive.writestr('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></rootfiles></container>')
        archive.writestr('Contents/content.hpf', package)
        archive.writestr('Contents/header.xml', header)
        archive.writestr('Contents/section0.xml', section)
        archive.writestr('Preview/PrvText.txt', '합성 줄 간격 검사\n합성 표의 내용입니다.\n표 다음 본문입니다.')
    return {'name': name, 'objectHeight': height, 'outerTop': 100, 'outerBottom': 200,
            'percent': percent, 'affect': affect, 'storedSpacing': stored_spacing,
            'treatAsChar': treat_as_char, 'fontHeight': 1100}


def build_dual(name, force_page_break):
    """Combine only the two synthetic tables generated above, never a user file."""
    hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
    hs = 'http://www.hancom.co.kr/hwpml/2011/section'
    ET.register_namespace('hp', hp)
    ET.register_namespace('hs', hs)
    first_name = 'tac-height5000-percent135-affect1.hwpx'
    second_name = 'tac-height10000-percent135-affect0.hwpx'
    with zipfile.ZipFile(OUT / first_name) as first, zipfile.ZipFile(OUT / second_name) as second:
        first_section = ET.fromstring(first.read('Contents/section0.xml'))
        second_section = ET.fromstring(second.read('Contents/section0.xml'))
        first_paras = list(first_section)
        second_paras = list(second_section)
        first_paras[2].find(f'.//{{{hp}}}t').text = '첫 표 다음 본문입니다.'
        second_paras[1].set('id', '3')
        second_paras[1].set('pageBreak', str(int(force_page_break)))
        second_paras[2].set('id', '4')
        second_paras[2].find(f'.//{{{hp}}}t').text = '둘째 표 다음 본문입니다.'
        first_section.extend(second_paras[1:])
        section = ET.tostring(first_section, encoding='utf-8', xml_declaration=True)
        with zipfile.ZipFile(OUT / name, 'w', compression=zipfile.ZIP_DEFLATED) as target:
            for entry in first.infolist():
                target.writestr(entry, section if entry.filename == 'Contents/section0.xml' else first.read(entry.filename))
    return {'name': name, 'pageCount': 2 if force_page_break else 1,
            'following': [
                {'text': '첫 표 다음 본문입니다.', 'objectHeight': 5000,
                 'expectedSpacing': 1855, 'outerBottom': 200},
                {'text': '둘째 표 다음 본문입니다.', 'objectHeight': 10000,
                 'expectedSpacing': 385, 'outerBottom': 200},
            ]}


if __name__ == '__main__':
    variants = []
    for height in (5000, 10000):
        for percent in (100, 135, 160):
            for affect in (False, True):
                name = f'tac-height{height}-percent{percent}-affect{int(affect)}.hwpx'
                variants.append(build(name, height, percent, affect))
    for affect in (False, True):
        name = f'tac-stored-spacing-affect{int(affect)}.hwpx'
        variants.append(build(name, 5000, 135, affect, stored_spacing=1777))
    (OUT / 'variants.json').write_text(json.dumps(variants, indent=2) + '\n', encoding='utf-8')
    dual = [build_dual('tac-two-tables-flow.hwpx', False),
            build_dual('tac-two-tables-pagebreak.hwpx', True)]
    (OUT / 'dual-variants.json').write_text(json.dumps(dual, indent=2) + '\n', encoding='utf-8')
    boundary = []
    for label, body_height, pages in [('fit', 16490, 1), ('out', 16450, 2)]:
        record = build(f'tac-page-boundary-{label}.hwpx', 10000, 135, True,
                       page_height=body_height + 1500, compact_margins=True)
        record.update({'bodyHeight': body_height, 'pageHeight': body_height + 1500,
                       'pageCount': pages, 'pageTop': 750, 'pageBottom': 750})
        boundary.append(record)
    (OUT / 'boundary-variants.json').write_text(json.dumps(boundary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'variants': len(variants), 'dualVariants': len(dual),
                      'boundaryVariants': len(boundary),
                      'files': [v['name'] for v in variants + dual + boundary]}))
