'use strict';

// The renderer supplies only documented per-job options; it never controls
// Electron's silent flag, paths, callbacks, headers or arbitrary print options.
function printOptions(value,printers){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('인쇄 설정을 확인해 주세요.');
 if(typeof value.printer!=='string'||!printers.some(p=>p.name===value.printer))throw Error('설치된 프린터를 선택해 주세요.');
 if(!Number.isInteger(value.copies)||value.copies<1||value.copies>999)throw Error('인쇄 매수는 1~999를 입력해 주세요.');
 if(typeof value.collate!=='boolean'||typeof value.color!=='boolean'||!['simplex','longEdge','shortEdge'].includes(value.duplexMode))throw Error('인쇄 설정을 확인해 주세요.');
 const paper=value.paper;
 if(!paper||!Number.isInteger(paper.width)||!Number.isInteger(paper.height)||paper.width<1000||paper.height<1000||paper.width>2000000||paper.height>2000000)throw Error('인쇄 용지 크기를 확인해 주세요.');
 return {silent:true,deviceName:value.printer,copies:value.copies,collate:value.collate,color:value.color,duplexMode:value.duplexMode,printBackground:true,margins:{marginType:'none'},scaleFactor:100,pagesPerSheet:1,landscape:paper.width>paper.height,pageSize:{width:Math.min(paper.width,paper.height),height:Math.max(paper.width,paper.height)}};
}
module.exports={printOptions};
