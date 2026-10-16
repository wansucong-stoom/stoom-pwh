import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stylesForTheme,validateTheme,validateTableStyles} from '../src/table-style.mjs';
import {editorCapture,editorRequest,editorTables,editorTableStyle,editorPoll,editorResult} from '../src/editor-session.mjs';
const theme={header:{fontFamily:'Test Font',fontSize:1100,bold:true,textColor:'#ffffff',fillColor:'#173654',alignment:'center'},body:{fontFamily:'Test Font',fontSize:1000,bold:false,textColor:'#243747',fillColor:'#f3f7fa',alignment:'left'},border:{color:'#b4c7d5',width:1,type:1,outerLeft:false,outerRight:false,vertical:true},headerRows:1};
test('merged tables use roles and actual outer edges independently of column count',()=>{
 const ref={snapshot:{dimensions:{rowCount:3,colCount:5},cells:[{geometry:{row:0,col:0,rowSpan:1,colSpan:5},properties:{}},{geometry:{row:1,col:0,rowSpan:2,colSpan:2},properties:{}},{geometry:{row:1,col:2,rowSpan:1,colSpan:3},properties:{}}]}};
 const styles=stylesForTheme(ref,theme);
 assert.equal(styles[0].fillColor,theme.header.fillColor);assert.equal(styles[1].fillColor,theme.body.fillColor);
 assert.equal(styles[0].borders.Left.type,0);assert.equal(styles[0].borders.Right.type,0);
 assert.equal(styles[1].borders.Right.type,1);assert.equal(styles[2].borders.Right.type,0);
 assert.equal(stylesForTheme(ref,theme,0)[0].fillColor,theme.body.fillColor);
});
test('invalid fonts, colors, borders and unselected cells cannot queue changes',()=>{
 assert.throws(()=>validateTheme({...theme,header:{...theme.header,fontSize:0}}));
 assert.throws(()=>validateTheme({...theme,border:{...theme.border,outerLeft:'no'}}));
 assert.throws(()=>validateTableStyles([{cellIndex:2,fillColor:'#ffffff'}],[1]));
 assert.throws(()=>validateTableStyles([{cellIndex:1,fillColor:'red'}],[1]));
});
test('table inspection does not complete a request; actual style acknowledgement does',async()=>{
 const sessionId=randomUUID(),context={ready:true,kind:'cell_block',requestScope:'selection',documentState:{documentEpoch:1},table:{selectedCellsComplete:true,selectedCells:[{cellIndex:1}]},target:{kind:'table_cells',epoch:1,cells:[1]}};
 const request=editorCapture({sessionId,context,note:'Style selected cells'}),expected=editorRequest(request).context;
 const inspect=editorTables({sessionId,expected,requestId:request.requestId});
 editorPoll({sessionId,context,receipt:{ticketId:inspect.ticketId,ok:true,tablePlan:{planId:'plan'}}});
 assert.equal(editorRequest(request).status,'requested');
 const ticket=await editorTableStyle({sessionId,expected,requestId:request.requestId,planId:'plan',scope:'document',theme});
 assert.equal(editorRequest(request).status,'queued');assert.equal(editorResult(ticket).status,'pending');
 const commands=editorPoll({sessionId,context}).commands;assert.equal(commands[0].type,'tableStyle');
 editorPoll({sessionId,context,receipt:{ticketId:ticket.ticketId,ok:true,undoSteps:1}});
 assert.equal(editorRequest(request).status,'applied');
 await assert.rejects(editorTableStyle({sessionId,expected:{documentState:{documentEpoch:2}},planId:'plan',scope:'document',theme}),/changed/);
});
