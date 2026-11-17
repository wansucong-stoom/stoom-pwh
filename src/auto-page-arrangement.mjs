// Earlier versions persisted their implicit single-page default as a preference.
// A user's explicit layout choice is kept once it has been recorded.
export function initialPageArrangement(view={},fallback={kind:'auto'}){
 const arrangement=view.pageArrangement??fallback;
 if(view.pageMovement?.direction==='horizontal')return arrangement;
 if(arrangement?.kind==='single'&&view.pageArrangementChosen!==true)return{kind:'auto'};
 return arrangement;
}
