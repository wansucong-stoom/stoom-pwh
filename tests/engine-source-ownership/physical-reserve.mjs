import {loadEngineSource,sourceBlock,runRustTests} from './harness.mjs';
const {source,sourceSha256}=await loadEngineSource(),extract=marker=>sourceBlock(source,marker);
const models=`
mod model {
 pub mod paragraph {pub struct Paragraph {pub controls:Vec<crate::Control>,pub para_shape_id:u16,pub reflowed:bool}}
 pub mod table {
  pub struct Cell {pub paragraphs:Vec<super::paragraph::Paragraph>}
  pub struct Table {pub row_count:u16,pub col_count:u16,pub cell_spacing:u16,pub outer_margin_top:u16,pub outer_margin_bottom:u16,pub caption:Option<crate::Caption>,pub rows:Vec<f64>,pub measured:bool,pub outer_frame:bool,pub lead:f64}
 }
}
mod renderer {pub fn para_has_no_stored_line_segs(para:&crate::model::paragraph::Paragraph)->bool{para.reflowed}}
enum Control {Table(Box<model::table::Table>),Other}
#[derive(Clone,Copy)] enum CaptionDirection {Top,Bottom,Other}
struct Caption {spacing:u16,direction:CaptionDirection,height:f64}
struct ParaStyle {spacing_before:f64,spacing_after:f64}
struct ResolvedStyleSet {para_styles:Vec<ParaStyle>}
mod extracted {use super::*;
type RowCut=Vec<usize>;
#[derive(Debug,Clone,Copy,Default,PartialEq,Eq)] ${extract('enum RecursiveBlockPreludeRole {')}
${extract('pub(super) struct CellUnit {')}
#[derive(Debug,Clone)] ${extract('struct NestedTableUnitCut {')}
#[derive(Debug,Clone)] ${extract('pub(crate) struct NestedTableCut {')}
fn hwpunit_to_px(value:i32,dpi:f64)->f64{f64::from(value)*dpi/7200.0}
fn reflow_nested_table_has_outer_frame(_: &model::paragraph::Paragraph,table:&model::table::Table)->bool{table.outer_frame}
fn para_relative_float_table_lead(table:&model::table::Table,_:f64)->f64{table.lead}
struct LayoutEngine {dpi:f64}
impl LayoutEngine {
 // Independent physical-row fixture oracle: these values describe actual
 // child RowCut boxes, including their explicit cell padding. No unit-ledger
 // measurement or projection algorithm is reimplemented in this adapter.
 fn row_cut_content_height(&self,t:&model::table::Table,row:usize,_:&[usize],_:&[usize],_:&ResolvedStyleSet)->f64{t.rows[row]}
 fn reflowed_fragment_row_uses_measured_height(&self,t:&model::table::Table,_:usize)->bool{t.measured}
 fn resolve_row_heights(&self,t:&model::table::Table,_:usize,_:usize,_:Option<()>,_:&ResolvedStyleSet,_:bool)->Vec<f64>{t.rows.clone()}
 fn calculate_caption_height(&self,c:&Option<Caption>,_:&ResolvedStyleSet)->f64{c.as_ref().map(|c|c.height).unwrap_or(0.0)}
 ${extract('fn projected_recursive_run_extra(')}
}
`;
const tests=`
fn row(height:f64)->model::table::Table{model::table::Table{row_count:1,col_count:1,cell_spacing:0,outer_margin_top:0,outer_margin_bottom:0,caption:None,rows:vec![height],measured:false,outer_frame:false,lead:0.0}}
fn host(child:model::table::Table,reflowed:bool)->model::table::Cell{model::table::Cell{paragraphs:vec![model::paragraph::Paragraph{controls:vec![Control::Table(Box::new(child))],para_shape_id:0,reflowed}]}}
fn unit(height:f64)->CellUnit{CellUnit{height,hard_break_before:false,stored_frame_break_before:false,page_frame_reset_before:false,vpos_gap_before:false,para_idx:0,vis_start:0,vis_end:0,nested_row:Some(0),nested_table_fragment:Some(NestedTableUnitCut{start_cut:vec![2],end_cut:vec![4],terminal:false}),mixed_nested_fragment:false,mixed_nested_trailing:false,mixed_nested_content_height:0.0,mixed_nested_recursive:false,mixed_nested_starts_after_table:false,mixed_nested_source_para_idx:None,recursive_block_prelude_role:RecursiveBlockPreludeRole::None,top_and_bottom_flow:false,empty_spacer:false,non_inline_control_range:None}}
fn styles()->ResolvedStyleSet{ResolvedStyleSet{para_styles:vec![ParaStyle{spacing_before:16.0,spacing_after:10.6666666666667}]}}
fn reserve(cell:&model::table::Cell,units:&[CellUnit],lo:usize,hi:usize)->Option<f64>{LayoutEngine{dpi:96.0}.projected_recursive_run_extra(cell,&styles(),units,0,units.len(),lo,hi)}
fn close(a:f64,b:f64){assert!((a-b).abs()<0.00001,"actual {a}, expected {b}")}
#[test]fn stored_typed_partial_row_reserves_explicit_top_and_bottom_padding(){let c=host(row(46.4266666666667),false);close(reserve(&c,&[unit(42.6666666666667)],0,1).unwrap(),3.76);}
#[test]fn untyped_stored_scalar_does_not_claim_a_child_rowcut(){let c=host(row(46.4266666666667),false);let mut u=unit(42.6666666666667);u.nested_row=None;assert_eq!(reserve(&c,&[u],0,1),None);}
#[test]fn stored_text_atom_does_not_claim_the_nested_padding(){let c=host(row(46.4266666666667),false);let mut u=unit(42.6666666666667);u.vis_end=1;u.nested_row=None;u.nested_table_fragment=None;assert_eq!(reserve(&c,&[u],0,1),None);}
#[test]fn stored_empty_host_placeholder_with_exact_child_rowcut_reserves_padding(){let c=host(row(46.4266666666667),false);let mut u=unit(42.6666666666667);u.vis_end=1;close(reserve(&c,&[u],0,1).unwrap(),3.76);}
#[test]fn stored_placeholder_without_exact_child_rowcut_cannot_claim_padding(){let c=host(row(46.4266666666667),false);let mut u=unit(42.6666666666667);u.vis_end=1;u.nested_table_fragment=None;assert_eq!(reserve(&c,&[u],0,1),None);}
#[test]fn stored_mixed_atomic_and_partial_rows_keep_the_exact_partial_rowcut_reservation(){let mut child=row(20.0);child.row_count=2;child.rows.push(46.4266666666667);let c=host(child,false);let mut atomic=unit(20.0);atomic.vis_end=1;atomic.nested_table_fragment=None;let mut partial=unit(42.6666666666667);partial.vis_end=1;partial.nested_row=Some(1);let units=[atomic,partial];close(reserve(&c,&units,1,2).unwrap(),3.76);close(reserve(&c,&units,0,2).unwrap(),3.76);}
#[test]fn reflowed_recursive_path_retains_existing_physical_reservation(){let c=host(row(46.4266666666667),true);let mut u=unit(42.6666666666667);u.nested_row=None;u.nested_table_fragment=None;u.mixed_nested_fragment=true;u.mixed_nested_recursive=true;close(reserve(&c,&[u],0,1).unwrap(),3.76);}
#[test]fn typed_stored_host_spacing_is_already_owned_by_the_separate_text_atom(){let mut c=host(row(46.4266666666667),false);c.paragraphs.insert(0,model::paragraph::Paragraph{controls:vec![],para_shape_id:0,reflowed:false});c.paragraphs.push(model::paragraph::Paragraph{controls:vec![],para_shape_id:0,reflowed:false});let mut u=unit(42.6666666666667);u.para_idx=1;close(reserve(&c,&[u],0,1).unwrap(),3.76);}
#[test]fn no_extra_is_reserved_when_units_already_own_the_child_box(){let c=host(row(46.4266666666667),false);close(reserve(&c,&[unit(46.4266666666667)],0,1).unwrap(),0.0);}
#[test]fn empty_selected_window_owns_no_child_padding(){let c=host(row(46.4266666666667),false);close(reserve(&c,&[unit(42.6666666666667)],1,1).unwrap(),0.0);}
#[test]fn each_partial_physical_fragment_reserves_its_own_padding(){let c=host(row(23.2133333333333),false);let units=[unit(21.3333333333333),unit(21.3333333333333)];close(reserve(&c,&units,0,1).unwrap(),1.88);close(reserve(&c,&units,1,2).unwrap(),1.88);}
#[test]fn declared_outer_margins_are_added_only_at_the_owned_run_edges(){let mut child=row(46.4266666666667);child.outer_margin_top=150;child.outer_margin_bottom=225;let c=host(child,false);let units=[unit(42.6666666666667),unit(42.6666666666667),unit(42.6666666666667)];close(reserve(&c,&units,0,1).unwrap(),5.76);close(reserve(&c,&units,1,2).unwrap(),3.76);close(reserve(&c,&units,2,3).unwrap(),6.76);}
#[test]fn caption_reservation_is_not_added_twice_when_it_is_in_the_unit(){let mut child=row(46.4266666666667);child.caption=Some(Caption{spacing:150,direction:CaptionDirection::Top,height:10.0});let c=host(child,false);close(reserve(&c,&[unit(54.6666666666667)],0,1).unwrap(),3.76);}
`;
await runRustTests({name:'physical-reserve',sourceSha256,code:models+'\n'+tests+'\n}'});
