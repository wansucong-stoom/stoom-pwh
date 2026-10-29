from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec
from copy import deepcopy
import zipfile
import xml.etree.ElementTree as E
root=Path(__file__).resolve().parent
spec=spec_from_file_location('fixture_builder',root.parent/'tac-line-spacing/build_fixture.py')
builder=module_from_spec(spec);spec.loader.exec_module(builder);builder.OUT=root
builder.build('growth-base.hwpx',14740,160,False,stored_spacing=600,page_height=48000,compact_margins=True)
hp='http://www.hancom.co.kr/hwpml/2011/paragraph';H='{'+hp+'}'
E.register_namespace('hp',hp);E.register_namespace('hs','http://www.hancom.co.kr/hwpml/2011/section')
with zipfile.ZipFile(root/'growth-base.hwpx') as src, zipfile.ZipFile(root/'stored-grown.hwpx','w') as dst:
    for item in src.infolist():
        data=src.read(item.filename)
        if item.filename=='Contents/section0.xml':
            doc=E.fromstring(data);table=doc.find('.//'+H+'tbl');cell=deepcopy(table.find('.//'+H+'tc'))
            for row in table.findall(H+'tr'):table.remove(row)
            table.set('rowCnt','5');table.set('colCnt','3');table.set('repeatHeader','1')
            table.find(H+'sz').set('width','36000')
            for r in range(5):
                tr=E.SubElement(table,H+'tr')
                for col in range(3):
                    c=deepcopy(cell);c.find(H+'cellAddr').set('colAddr',str(col));c.find(H+'cellAddr').set('rowAddr',str(r))
                    c.find(H+'cellSz').set('width','12000');c.find(H+'cellSz').set('height',str([2400,2400,2400,3770,3770][r]))
                    para=c.find('.//'+H+'p');text=para.find('.//'+H+'t')
                    text.text='표 항목' if r==0 else '여러 줄의 내용을 넣어 내용을 자세히 설명합니다. 예시 문장을 사용합니다.'
                    if r:
                        lines=E.SubElement(para,H+'linesegarray')
                        for n in range(4):E.SubElement(lines,H+'lineseg',{'textpos':str(n*10),'vertpos':str(n*1500),'vertsize':'1100','textheight':'1100','baseline':'935','spacing':'400','horzpos':'0','horzsize':'11000','flags':'0'})
                    tr.append(c)
            last=doc[-1]
            for i in range(6):
                p=deepcopy(last);p.set('id',str(3+i));p.find('.//'+H+'t').text='표 다음에 이어지는 합성 문장입니다. '*3;doc.append(p)
            data=E.tostring(doc,encoding='utf-8',xml_declaration=True)
        dst.writestr(item,data)
(root/'growth-base.hwpx').unlink()
print(root/'stored-grown.hwpx')
