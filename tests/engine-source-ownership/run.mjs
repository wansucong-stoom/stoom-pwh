import {loadEngineSource, sourceBlock, runRustTests} from './harness.mjs';
const {source,sourceSha256}=await loadEngineSource();
const extract=marker=>sourceBlock(source,marker);
const parts=[
 'type RowCut = Vec<usize>;',
 '#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]\n'+extract('enum RecursiveBlockPreludeRole {'),
 extract('pub(super) struct CellUnit {'),
 '#[derive(Debug, Clone)]\n'+extract('struct NestedTableUnitCut {'),
 extract('fn projected_table_owner_in_cut('),
 extract('fn saved_reset_unit('),
 '#[test]\n'+extract('fn projected_table_cut_does_not_let_text_atoms_repaint_the_table('),
 '#[test]\n'+extract('fn projected_table_cut_preserves_legacy_atoms_without_nested_provenance('),
 `#[test]
fn mixed_atoms_keep_ownership_separate_from_neighboring_text_and_paragraphs() {
 let before=saved_reset_unit(16.0,0,1,false);
 let mut table=saved_reset_unit(16.0,0,1,false);table.mixed_nested_fragment=true;
 let after=saved_reset_unit(16.0,0,1,false);
 let mut other=saved_reset_unit(16.0,1,1,false);other.nested_row=Some(0);
 let units=vec![before,table,after,other];
 assert_eq!(projected_table_owner_in_cut(&units,0,0,1),Some(false));
 assert_eq!(projected_table_owner_in_cut(&units,0,1,2),Some(true));
 assert_eq!(projected_table_owner_in_cut(&units,0,2,4),Some(false));
 assert_eq!(projected_table_owner_in_cut(&units,1,0,3),Some(false));
 assert_eq!(projected_table_owner_in_cut(&units,1,3,4),Some(true));
}
#[test]
fn recursive_cut_provenance_owns_table_without_a_nested_row_tag() {
 let mut table=saved_reset_unit(16.0,0,1,false);
 table.nested_table_fragment=Some(NestedTableUnitCut{start_cut:vec![0],end_cut:vec![1],terminal:false});
 let text=saved_reset_unit(16.0,0,1,false);let units=vec![table,text];
 assert_eq!(projected_table_owner_in_cut(&units,0,0,1),Some(true));
 assert_eq!(projected_table_owner_in_cut(&units,0,1,2),Some(false));
}
#[test]
fn empty_reversed_and_out_of_bounds_ranges_cannot_create_ownership() {
 let mut table=saved_reset_unit(16.0,0,1,false);table.nested_row=Some(0);
 let units=vec![table];
 assert_eq!(projected_table_owner_in_cut(&units,0,0,0),Some(false));
 assert_eq!(projected_table_owner_in_cut(&units,0,1,0),Some(false));
 assert_eq!(projected_table_owner_in_cut(&units,0,usize::MAX,usize::MAX),Some(false));
 assert_eq!(projected_table_owner_in_cut(&units,0,0,usize::MAX),Some(true));
}
#[test]
fn adjacent_fragment_windows_assign_each_projected_table_atom_once() {
 let before=saved_reset_unit(16.0,0,1,false);
 let mut row0=saved_reset_unit(16.0,0,1,false);row0.nested_row=Some(0);
 let mut row1=saved_reset_unit(16.0,0,1,false);row1.nested_row=Some(1);
 let after=saved_reset_unit(16.0,0,1,false);let units=vec![before,row0,row1,after];
 let owners=(0..units.len()).filter(|start|projected_table_owner_in_cut(&units,0,*start,*start+1)==Some(true)).count();
 assert_eq!(owners,2);
}
`
];
await runRustTests({name:'table-owner',sourceSha256,code:'mod extracted {\n'+parts.join('\n\n')+'\n}\n'});
