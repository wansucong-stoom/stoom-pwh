import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {extractHancomTableModel,pasteHancomTableInCell,pasteHtmlTableInCell} from '../src/nested-table-paste.mjs';

test('only accepts a complete bounded Hancom model',()=>{
 assert.equal(extractHancomTableModel('plain'),null);
 assert.equal(extractHancomTableModel('<!--[data-hwpjson]{bad}-->'),null);
 assert.equal(extractHancomTableModel('<!--[data-hwpjson]{"ok":true}-->'),'{"ok":true}');
});

test('HTML table preserves its grid and existing cell content',{
 skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set real WASM paths':false,
},async()=>{
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();const body=JSON.parse(doc.createTable(0,0,0,2,2));
 doc.insertTextInCell(0,body.paraIdx,body.controlIdx,0,0,0,'앞쪽');
 const bridge=new Proxy(doc,{get(target,key){if(key==='copyControl')return (sec,para,ci,path='')=>target.copyControl(sec,para,path,ci);if(key==='insertPwhScratchParagraph')return target.insertParagraph.bind(target);if(key==='deletePwhScratchParagraph')return target.deleteParagraph.bind(target);const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const context={cursor:{sectionIndex:0,parentParaIndex:body.paraIdx,controlIndex:body.controlIdx,cellIndex:0,cellParaIndex:0,charOffset:2},kind:'cell_text',selection:null};
 const html='<table><tr><td colspan="2" style="background-color:#215a85"><b>제목</b></td></tr><tr><td>가</td><td>나</td></tr></table>';
 const spec={rows:2,columns:2,cells:[{row:0,column:0,columnSpan:2,paragraphs:['제목']},{row:1,column:0,paragraphs:['가']},{row:1,column:1,paragraphs:['나']}]};
 try{const result=pasteHtmlTableInCell(bridge,context,html,spec);assert.equal(result.cells,3);
  const reopened=new HwpDocument(doc.exportHwpx());try{const path=[{controlIndex:body.controlIdx,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];assert.equal(JSON.parse(reopened.getTableDimensionsByPath(0,body.paraIdx,JSON.stringify(path))).cellCount,3);assert.equal(JSON.parse(reopened.getCellPropertiesByPath(0,body.paraIdx,JSON.stringify(path),0)).fillColor.toLowerCase(),'#215a85');}finally{reopened.free();}
 }finally{doc.free();}
});

test('a Hancom table, including nested tables, survives a cell paste, save and undo',{
 skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_HANCOM_CLIPBOARD?'Set WASM paths and an explicitly authorized local clipboard fixture':false,
},async()=>{
 const clip=JSON.parse((await fs.readFile(process.env.PWH_HANCOM_CLIPBOARD,'utf8')).replace(/^\uFEFF/,''));
 const model=extractHancomTableModel(clip.html);assert.ok(model);
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();
 const body=JSON.parse(doc.createTable(0,0,0,2,2));doc.insertTextInCell(0,body.paraIdx,body.controlIdx,0,0,0,'앞쪽');
 const last=doc.getParagraphCount(0)-1;doc.insertText(0,last,0,'본문 보존');
 const before=doc.saveSnapshot();
 const bridge=new Proxy(doc,{get(target,key){if(key==='copyControl')return (sec,para,ci,path='')=>target.copyControl(sec,para,path,ci);if(key==='insertPwhScratchParagraph')return target.insertParagraph.bind(target);if(key==='deletePwhScratchParagraph')return target.deleteParagraph.bind(target);const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const context={cursor:{sectionIndex:0,parentParaIndex:body.paraIdx,controlIndex:body.controlIdx,cellIndex:0,cellParaIndex:0,charOffset:2},kind:'body_text',selection:null};
 try{
  const result=pasteHancomTableInCell(bridge,context,model);assert.ok(result.cells>0);
  const path=[{controlIndex:body.controlIdx,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];
  const reopened=new HwpDocument(doc.exportHwpx());
  try{
   const dims=JSON.parse(reopened.getTableDimensionsByPath(0,body.paraIdx,JSON.stringify(path)));
   assert.equal(dims.rowCount,result.rows);assert.equal(dims.colCount,result.columns);assert.equal(dims.cellCount,result.cells);
   assert.equal(reopened.getTextInCell(0,body.paraIdx,body.controlIdx,0,0,0,2),'앞쪽');
   assert.equal(reopened.getTextRange(0,last,0,5),'본문 보존');
   const nested=JSON.parse(reopened.getControls()).filter(c=>c.ctrlId==='tbl');
   assert.ok(nested.length>=2,'nested table exists after save and reload');
   const source=HwpDocument.createEmpty();source.createBlankDocument();
   try{
    assert.equal(JSON.parse(source.pasteHwpJson(0,0,0,model)).ok,true);
    const sourceTable=JSON.parse(source.getControls()).find(c=>c.ctrlId==='tbl'&&c.list===0);assert.ok(sourceTable);
    const fields=['width','height','paddingLeft','paddingRight','paddingTop','paddingBottom','applyInnerMargin','verticalAlign','textDirection','isHeader','cellProtect','fieldName','editableInForm','borderLeft','borderRight','borderTop','borderBottom','fillType','fillColor','patternColor','patternType','diagonalLine','diagonalSlash','diagonalBackSlash','diagonalWidth','diagonalColor','centerLine'];
    const pick=(object,keys)=>Object.fromEntries(keys.map(key=>[key,object[key]]));
    for(let i=0;i<dims.cellCount;i++){
     const original=JSON.parse(source.getCellProperties(0,sourceTable.para,sourceTable.controlIndex,i));
     const actual=JSON.parse(reopened.getCellPropertiesByPath(0,body.paraIdx,JSON.stringify(path),i));
     assert.deepEqual(pick(actual,fields),pick(original,fields),`cell ${i} size, fill and borders`);
     const cellPath=structuredClone(path);cellPath[1].cellIndex=i;
     const beforeCount=source.getCellParagraphCount(0,sourceTable.para,sourceTable.controlIndex,i);
     assert.equal(reopened.getCellParagraphCountByPath(0,body.paraIdx,JSON.stringify(cellPath)),beforeCount);
     for(let para=0;para<beforeCount;para++){
      cellPath[1].cellParaIndex=para;const cp=JSON.stringify(cellPath);
      const len=source.getCellParagraphLength(0,sourceTable.para,sourceTable.controlIndex,i,para);
      assert.equal(reopened.getCellParagraphLengthByPath(0,body.paraIdx,cp),len);
      assert.equal(reopened.getTextInCellByPath(0,body.paraIdx,cp,0,len),source.getTextInCell(0,sourceTable.para,sourceTable.controlIndex,i,para,0,len));
      for(let offset=0;offset<len;offset++){
       const original=JSON.parse(source.getCellCharPropertiesAt(0,sourceTable.para,sourceTable.controlIndex,i,para,offset));
       const actual=JSON.parse(reopened.getCellCharPropertiesAtByPath(0,body.paraIdx,cp,offset));
       const keys=Object.keys(original).filter(key=>!['charShapeId','borderFillId'].includes(key));
       assert.deepEqual(pick(actual,keys),pick(original,keys),`cell ${i} character formatting`);
      }
     }
    }
    let childTables=0;
    for(let i=0;i<dims.cellCount;i++){
     const paraCount=source.getCellParagraphCount(0,sourceTable.para,sourceTable.controlIndex,i);
     for(let para=0;para<paraCount;para++)for(let ci=0;ci<8;ci++){
      const srcPath=[{controlIndex:sourceTable.controlIndex,cellIndex:i,cellParaIndex:para},{controlIndex:ci,cellIndex:0,cellParaIndex:0}];
      const dstPath=[path[0],{controlIndex:0,cellIndex:i,cellParaIndex:para},{controlIndex:ci,cellIndex:0,cellParaIndex:0}];
      let child;try{child=JSON.parse(source.getTableDimensionsByPath(0,sourceTable.para,JSON.stringify(srcPath)));}catch{continue;}
      childTables++;assert.deepEqual(JSON.parse(reopened.getTableDimensionsByPath(0,body.paraIdx,JSON.stringify(dstPath))),child);
      for(let j=0;j<child.cellCount;j++){
       const a=JSON.parse(source.getCellPropertiesByPath(0,sourceTable.para,JSON.stringify(srcPath),j));
       const b=JSON.parse(reopened.getCellPropertiesByPath(0,body.paraIdx,JSON.stringify(dstPath),j));
       assert.deepEqual(pick(b,fields),pick(a,fields),`nested cell ${j} size, fill and borders`);
       srcPath.at(-1).cellIndex=j;dstPath.at(-1).cellIndex=j;srcPath.at(-1).cellParaIndex=0;dstPath.at(-1).cellParaIndex=0;
       const paraCount=source.getCellParagraphCountByPath(0,sourceTable.para,JSON.stringify(srcPath));
       assert.equal(reopened.getCellParagraphCountByPath(0,body.paraIdx,JSON.stringify(dstPath)),paraCount);
       for(let p=0;p<paraCount;p++){
        srcPath.at(-1).cellParaIndex=p;dstPath.at(-1).cellParaIndex=p;
        const srcJson=JSON.stringify(srcPath),dstJson=JSON.stringify(dstPath),n=source.getCellParagraphLengthByPath(0,sourceTable.para,srcJson);
        assert.equal(reopened.getTextInCellByPath(0,body.paraIdx,dstJson,0,n),source.getTextInCellByPath(0,sourceTable.para,srcJson,0,n));
        for(let offset=0;offset<n;offset++){
         const a=JSON.parse(source.getCellCharPropertiesAtByPath(0,sourceTable.para,srcJson,offset)),b=JSON.parse(reopened.getCellCharPropertiesAtByPath(0,body.paraIdx,dstJson,offset));
         const keys=Object.keys(a).filter(key=>!['charShapeId','borderFillId'].includes(key));assert.deepEqual(pick(b,keys),pick(a,keys));
        }
       }
      }
     }
    }
    const totalSourceTables=JSON.parse(source.getControls()).filter(c=>c.ctrlId==='tbl').length;
    assert.equal(nested.length,totalSourceTables+1,'all source tables survive inside the destination table');
    if(totalSourceTables>1)assert.ok(childTables>0,'nested source tables were inspected');
   }finally{source.free();}
  }finally{reopened.free();}
  doc.restoreSnapshot(before);assert.equal(JSON.parse(doc.getControls()).filter(c=>c.ctrlId==='tbl').length,1);
  assert.equal(doc.getTextInCell(0,body.paraIdx,body.controlIdx,0,0,0,2),'앞쪽');
 }finally{doc.discardSnapshot(before);doc.free();}
});

test('a Hancom table in the final body paragraph accepts a pasted table without shifting the original',{
 skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_HANCOM_CLIPBOARD?'Set WASM paths and an explicitly authorized local clipboard fixture':false,
},async()=>{
 const readModel=async file=>extractHancomTableModel(JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')).html);
 const model=await readModel(process.env.PWH_HANCOM_CLIPBOARD),targetModel=await readModel(process.env.PWH_HANCOM_TARGET||process.env.PWH_HANCOM_CLIPBOARD);
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();assert.equal(JSON.parse(doc.pasteHwpJson(0,0,0,targetModel)).ok,true);
 const controls=JSON.parse(doc.getControls()),table=controls.find(c=>c.ctrlId==='tbl'&&c.list===0);assert.ok(table);
 const originalCount=doc.getParagraphCount(0);assert.ok(controls.some(c=>c.ctrlId==='tbl'&&c.list===0&&c.para===originalCount-1),'original table anchors the last paragraph');
 const dims=JSON.parse(doc.getTableDimensions(0,table.para,table.controlIndex)),cell=Math.min(13,dims.cellCount-1),len=doc.getCellParagraphLength(0,table.para,table.controlIndex,cell,0);
 const originalText=doc.getTextInCell(0,table.para,table.controlIndex,cell,0,0,len),before=doc.saveSnapshot();
 const bridge=new Proxy(doc,{get(target,key){if(key==='copyControl')return (sec,para,ci,path='')=>target.copyControl(sec,para,path,ci);if(key==='insertPwhScratchParagraph')return target.insertParagraph.bind(target);if(key==='deletePwhScratchParagraph')return target.deleteParagraph.bind(target);const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const context={cursor:{sectionIndex:0,parentParaIndex:table.para,controlIndex:table.controlIndex,cellIndex:cell,cellParaIndex:0,charOffset:len},kind:'cell_text',selection:null};
 try{const result=pasteHancomTableInCell(bridge,context,model);assert.ok(result.cells);
  assert.equal(doc.getParagraphCount(0),originalCount);assert.equal(doc.getTextInCell(0,table.para,table.controlIndex,cell,0,0,len),originalText);
  const saved=new HwpDocument(doc.exportHwpx());try{assert.ok(JSON.parse(saved.getControls()).filter(c=>c.ctrlId==='tbl').length>controls.filter(c=>c.ctrlId==='tbl').length);}finally{saved.free();}
  doc.restoreSnapshot(before);assert.deepEqual(JSON.parse(doc.getControls()),controls);
 }finally{doc.discardSnapshot(before);doc.free();}
});
