import {inspectTablePlan as inspectOriginal} from '../release-source/src/table-style.mjs';

// Keep the inspected document revision with the location of every table.
// Identical tables remain distinct by address; any intervening document edit
// invalidates the plan rather than guessing at an intended target.
export async function inspectDesktopTablePlan(w,context){
 const state=context?.documentState;
 if(!Number.isSafeInteger(state?.documentEpoch)||!Number.isSafeInteger(state?.changeSeq)||typeof state?.documentSha256!=='string')throw Error('Document revision is required');
 return {...await inspectOriginal(w,context),revision:{epoch:state.documentEpoch,seq:state.changeSeq,sha256:state.documentSha256}};
}
export async function resolveDesktopTablePlan(w,plan,current,scope,tableIndex){
 const state=current?.documentState,rev=plan?.revision;
 if(!rev||state?.documentEpoch!==rev.epoch||state?.changeSeq!==rev.seq||state?.documentSha256!==rev.sha256)throw Error('Table plan expired or document changed');
 if(scope==='document'&&plan.unsupported)throw Error('Nested/non-body tables need a supported table path before document-wide styling');
 const latest=await inspectOriginal(w,current);
 if(latest.unsupported!==plan.unsupported||latest.refs.length!==plan.refs.length)throw Error('Document table set changed');
 for(let i=0;i<plan.refs.length;i++){const a=plan.refs[i],b=latest.refs[i];if(!b||a.sec!==b.sec||a.ppi!==b.ppi||a.ci!==b.ci||a.sha256!==b.sha256)throw Error('Table changed or is ambiguous');}
 if(scope==='document')return latest.refs;
 if(scope!=='table'||!Number.isSafeInteger(tableIndex)||tableIndex<0||tableIndex>=latest.refs.length)throw Error('Unknown table index');
 return [latest.refs[tableIndex]];
}
