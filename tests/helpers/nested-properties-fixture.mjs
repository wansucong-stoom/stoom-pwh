import assert from 'node:assert/strict';

export const requireOk=result=>{const value=JSON.parse(result);assert.equal(value.ok,true,JSON.stringify(value));return value;};
export function nestedPropertiesFixture(HwpDocument,{empty=false}={}){
  const doc=HwpDocument.createEmpty();doc.createBlankDocument();
  try{
    const outer=requireOk(doc.createTable(0,0,0,2,2));
    requireOk(doc.setTableProperties(0,outer.paraIdx,outer.controlIdx,JSON.stringify({treatAsChar:true,paddingLeft:120,paddingRight:160})));
    requireOk(doc.insertParagraph(0,1));
    const inner=requireOk(doc.createTable(0,1,0,2,2));
    requireOk(doc.setTableProperties(0,1,inner.controlIdx,JSON.stringify({treatAsChar:true,paddingLeft:210,paddingRight:230})));
    if(!empty)requireOk(doc.insertTextInCell(0,1,inner.controlIdx,1,0,0,'Inner cell text'));
    requireOk(doc.copyControl(0,1,'[]',inner.controlIdx));requireOk(doc.deleteTableControl(0,1,inner.controlIdx));
    requireOk(doc.pasteInternalInCell(0,outer.paraIdx,outer.controlIdx,0,0,0));
    const rootPath=[{controlIndex:outer.controlIdx,cellIndex:0,cellParaIndex:0}];
    const innerPath=[...rootPath,{controlIndex:0,cellIndex:0,cellParaIndex:0}];
    const deep=requireOk(doc.createTable(0,1,0,1,2));
    requireOk(doc.setTableProperties(0,1,deep.controlIdx,JSON.stringify({treatAsChar:true,paddingLeft:310,paddingRight:330})));
    if(!empty)requireOk(doc.insertTextInCell(0,1,deep.controlIdx,0,0,0,'Deep cell text'));
    requireOk(doc.copyControl(0,1,'[]',deep.controlIdx));requireOk(doc.deleteTableControl(0,1,deep.controlIdx));
    requireOk(doc.pasteInternalInCellByPath(0,outer.paraIdx,JSON.stringify(innerPath),0));
    // Begin from a loaded HWPX, as the editor does. The blank-document writer
    // supplies defaults on its first serialization, before the tested edit.
    const loaded=new HwpDocument(doc.exportHwpx());doc.free();
    return {doc:loaded,outer,rootPath,innerPath,deepPath:[...innerPath,{controlIndex:0,cellIndex:0,cellParaIndex:0}]};
  }catch(error){doc.free();throw error;}
}
