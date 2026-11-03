import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceBlock, runRustTests} from './harness.mjs';
const root=process.argv[2]||process.env.PWH_ENGINE_SOURCE;
if(!root)throw Error('An explicit candidate source tree is required');
const source=await fs.readFile(root+'/src/renderer/layout/table_layout.rs','utf8');
const sourceSha256=createHash('sha256').update(source).digest('hex');
const code=String.raw`
mod model {
 pub mod shape {
  #[derive(Clone,Copy,PartialEq)] pub enum TextWrap {TopAndBottom,Square}
  #[derive(Clone,Copy,PartialEq)] pub enum VertRelTo {Para,Page}
  #[derive(Clone,Copy,PartialEq)] pub enum VertAlign {Top,Center}
 }
 pub mod paragraph {
  use super::control::Control;
  #[derive(Clone,Copy,PartialEq)] pub enum ColumnBreakType{None,Page,Section,Column,MultiColumn}
  #[derive(Clone)] pub struct LineSeg{pub vertical_pos:i32,pub line_height:i32,pub line_spacing:i32,pub segment_width:i32,pub tag:u32}
  impl LineSeg{pub const TAG_IMPLEMENTATION_PROPERTY:u32=1<<31;}
  #[derive(Clone)] pub struct Paragraph{pub text:String,pub dirty:bool,pub cell_format_vpos_dirty:bool,pub source_frame_reflowed:bool,pub layout_space_metrics:Vec<()>,pub line_segs:Vec<LineSeg>,pub controls:Vec<Control>,pub column_type:ColumnBreakType,pub para_shape_id:u16,pub raw_break_type:u8}
  impl Paragraph{pub fn stored_text_partition_is_dirty(&self)->bool{self.dirty}}
 }
 pub mod control {use super::table::Table;#[derive(Clone)] pub enum Control{Table(Box<Table>),ColumnDef(Columns),Other} #[derive(Clone)] pub struct Columns{pub column_count:u16}}
 pub mod table {
  use super::paragraph::Paragraph;use super::shape::*;
  #[derive(Clone,Copy,PartialEq)] pub enum TablePageBreak{RowBreak,None}
  #[derive(Clone)] pub struct Common{pub treat_as_char:bool,pub flow_with_text:bool,pub allow_overlap:bool,pub text_wrap:TextWrap,pub vert_rel_to:VertRelTo,pub vert_align:VertAlign,pub vertical_offset:u32,pub height:u32}
  #[derive(Clone)] pub struct Cell{pub dirty_flag:bool,pub row:u16,pub col:u16,pub col_span:u16,pub text_direction:u8,pub height:u32,pub padding:Padding,pub apply_inner_margin:bool,pub row_span:u16,pub paragraphs:Vec<Paragraph>} #[derive(Clone,Copy)] pub struct Padding{pub top:i16,pub bottom:i16} impl Cell{pub fn effective_padding(&self,table:&Padding)->Padding{if self.apply_inner_margin {self.padding}else{*table}}}
  #[derive(Clone)] pub struct Table{pub common:Common,pub caption:Option<()>,pub row_count:u16,pub col_count:u16,pub padding:Padding,pub page_break:TablePageBreak,pub cell_spacing:u16,pub outer_margin_top:i16,pub outer_margin_bottom:i16,pub cells:Vec<Cell>,pub raw:Vec<u32>,pub headers:Vec<usize>}
  impl Table{pub fn get_raw_row_heights(&self)->Vec<u32>{self.raw.clone()} pub fn leading_header_rows(&self)->Vec<usize>{self.headers.clone()}}
 }
}
mod engine {
use crate::model::{control::Control,paragraph::{Paragraph,LineSeg,ColumnBreakType},table::{Table,Cell,Common,TablePageBreak,Padding},shape::*};
#[derive(Clone,Copy,Debug)]
${sourceBlock(source,'pub(super) struct StoredNestedTailOpeningFrame {')}
${sourceBlock(source,'impl StoredNestedTailOpeningFrame {')}
${sourceBlock(source,'fn stored_nested_tail_table_is_original(')}
${sourceBlock(source,'fn stored_nested_tail_cell_prefix_is_original(')}
${sourceBlock(source,'fn stored_nested_inline_tail_row_is_closed(')}
${sourceBlock(source,'fn stored_nested_tail_opening_frame_source(')}
fn paragraph(text:&str,vpos:i32,width:i32)->Paragraph{Paragraph{text:text.into(),dirty:false,cell_format_vpos_dirty:false,source_frame_reflowed:false,layout_space_metrics:vec![],line_segs:vec![LineSeg{vertical_pos:vpos,line_height:1000,line_spacing:600,segment_width:width,tag:0}],controls:vec![],column_type:ColumnBreakType::None,para_shape_id:0,raw_break_type:0}}
fn child()->Table{Table{common:Common{treat_as_char:false,flow_with_text:true,allow_overlap:false,text_wrap:TextWrap::TopAndBottom,vert_rel_to:VertRelTo::Para,vert_align:VertAlign::Top,vertical_offset:0,height:10000},caption:None,row_count:6,col_count:1,padding:Padding{top:100,bottom:100},page_break:TablePageBreak::RowBreak,cell_spacing:0,outer_margin_top:100,outer_margin_bottom:100,cells:(0..6).map(|row|Cell{dirty_flag:false,row,col:0,col_span:1,text_direction:0,height:1000,padding:Padding{top:0,bottom:0},apply_inner_margin:false,row_span:1,paragraphs:vec![paragraph("row",0,18000)]}).collect(),raw:vec![1200,2000,2500,1500,2200,3000],headers:vec![]}}
struct Fixture{host:Paragraph,next:Paragraph,measured:Vec<i64>}
fn fixture()->Fixture{let table=child();let mut host=paragraph("",4800,0);host.controls=vec![Control::Table(Box::new(table))];Fixture{host,next:paragraph("AFTER",3200,18000),measured:vec![1200,2000,2500,1500,2200,3000]}}
fn table(f:&Fixture)->&Table{let Control::Table(t)=&f.host.controls[0]else{panic!()};t}
fn table_mut(f:&mut Fixture)->&mut Table{let Control::Table(t)=&mut f.host.controls[0]else{panic!()};t}
fn run(f:&Fixture)->Option<StoredNestedTailOpeningFrame>{stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),table(f),&f.measured,true,false,false,true,[0.0;3])}
fn rejects(change:impl FnOnce(&mut Fixture)){let mut f=fixture();change(&mut f);assert!(run(&f).is_none());}

#[test]fn accepts_independent_opening_and_full_tail(){let p=run(&fixture()).unwrap();assert_eq!((p.tail_start_row,p.row_count,p.opening_height_hu,p.tail_height_hu),(5,6,10000,3000));}
#[test]fn accepts_measured_prefix_different_from_raw_auto_rows(){let mut f=fixture();table_mut(&mut f).raw=vec![282,1282,1282,2864,1432,1282];table_mut(&mut f).common.height=19257;table_mut(&mut f).outer_margin_top=141;table_mut(&mut f).outer_margin_bottom=141;f.measured=vec![1282,1282,1282,1432,13075,1282];f.host.line_segs[0].vertical_pos=3200;f.next.line_segs[0].vertical_pos=1564;assert_eq!(run(&f).unwrap().tail_start_row,5);}
#[test]fn accepts_exact_prefix_boundary(){let mut f=fixture();table_mut(&mut f).common.height=9400;assert!(run(&f).is_some());}
#[test]fn accepts_asymmetric_outer_margins(){let mut f=fixture();table_mut(&mut f).outer_margin_top=150;table_mut(&mut f).outer_margin_bottom=300;f.next.line_segs[0].vertical_pos=3450;assert!(run(&f).is_some());}
#[test]fn accepts_zero_outer_margins(){let mut f=fixture();table_mut(&mut f).outer_margin_top=0;table_mut(&mut f).outer_margin_bottom=0;f.next.line_segs[0].vertical_pos=3000;assert!(run(&f).is_some());}
#[test]fn accepts_unique_multiple_row_tail(){let mut f=fixture();table_mut(&mut f).common.height=8000;f.host.line_segs[0].vertical_pos=8000;f.next.line_segs[0].vertical_pos=5400;let p=run(&f).unwrap();assert_eq!((p.tail_start_row,p.tail_height_hu),(4,5200));}
#[test]fn opening_body_requires_the_exact_owned_cut(){let p=run(&fixture()).unwrap();assert_eq!(p.body_for_cut(0,5,&[],&[],72.0),Some(100.0));assert!(p.body_for_cut(0,4,&[],&[],72.0).is_none());assert!(p.body_for_cut(0,6,&[],&[],72.0).is_none());}
#[test]fn tail_body_requires_the_exact_owned_cut(){let p=run(&fixture()).unwrap();assert_eq!(p.body_for_cut(5,6,&[],&[],72.0),Some(30.0));assert!(p.body_for_cut(4,6,&[],&[],72.0).is_none());assert!(p.body_for_cut(5,5,&[],&[],72.0).is_none());}
#[test]fn partial_row_cursors_cannot_expand_the_source_frame(){let p=run(&fixture()).unwrap();assert!(p.body_for_cut(0,5,&[0],&[],96.0).is_none());assert!(p.body_for_cut(0,5,&[],&[0],96.0).is_none());}
#[test]fn invalid_dpi_cannot_produce_physical_space(){let p=run(&fixture()).unwrap();for dpi in [0.0,-96.0,f64::NAN,f64::INFINITY]{assert!(p.body_for_cut(0,5,&[],&[],dpi).is_none());}}
#[test]fn nonstored_profile_rejects(){let f=fixture();assert!(stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),table(&f),&f.measured,false,false,false,true,[0.0;3]).is_none());}
#[test]fn edited_session_rejects(){let f=fixture();assert!(stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),table(&f),&f.measured,true,true,false,true,[0.0;3]).is_none());}
#[test]fn reflowed_owner_rejects(){let f=fixture();assert!(stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),table(&f),&f.measured,true,false,true,true,[0.0;3]).is_none());}
#[test]fn nonoriginal_local_origin_rejects(){let f=fixture();assert!(stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),table(&f),&f.measured,true,false,false,false,[0.0;3]).is_none());}
#[test]fn paragraph_spacing_is_not_folded_into_object_tail(){let f=fixture();for spacing in [[1.0,0.0,0.0],[0.0,1.0,0.0],[0.0,0.0,1.0],[f64::NAN,0.0,0.0]]{assert!(stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),table(&f),&f.measured,true,false,false,true,spacing).is_none());}}
#[test]fn missing_successor_rejects(){let f=fixture();assert!(stored_nested_tail_opening_frame_source(&f.host,None,table(&f),&f.measured,true,false,false,true,[0.0;3]).is_none());}
#[test]fn another_identical_table_is_not_the_owned_pointer(){let f=fixture();let other=child();assert!(stored_nested_tail_opening_frame_source(&f.host,Some(&f.next),&other,&f.measured,true,false,false,true,[0.0;3]).is_none());}
#[test]fn mixed_host_text_rejects(){rejects(|f|f.host.text="HOST".into());}
#[test]fn extra_host_control_rejects(){rejects(|f|f.host.controls.push(Control::Other));}
#[test]fn changed_host_partition_rejects(){rejects(|f|f.host.dirty=true);}
#[test]fn changed_host_source_position_rejects(){rejects(|f|f.host.cell_format_vpos_dirty=true);}
#[test]fn clean_republished_host_metrics_reject(){rejects(|f|f.host.layout_space_metrics.push(()));}
#[test]fn missing_host_line_rejects(){rejects(|f|f.host.line_segs.clear());}
#[test]fn multiline_host_rejects(){rejects(|f|f.host.line_segs.push(f.host.line_segs[0].clone()));}
#[test]fn synthetic_host_line_rejects(){rejects(|f|f.host.line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY);}
#[test]fn nonpositive_host_source_rejects(){for v in [0,-1]{rejects(|f|f.host.line_segs[0].vertical_pos=v);}}
#[test]fn host_without_positive_line_box_rejects(){rejects(|f|f.host.line_segs[0].line_height=0);}
#[test]fn negative_host_line_spacing_rejects(){rejects(|f|f.host.line_segs[0].line_spacing=-1);}
#[test]fn host_text_width_rejects(){rejects(|f|f.host.line_segs[0].segment_width=1);}
#[test]fn invisible_successor_rejects(){rejects(|f|f.next.text.clear());}
#[test]fn successor_control_rejects(){rejects(|f|f.next.controls.push(Control::Other));}
#[test]fn changed_successor_partition_rejects(){rejects(|f|f.next.dirty=true);}
#[test]fn changed_successor_source_position_rejects(){rejects(|f|f.next.cell_format_vpos_dirty=true);}
#[test]fn clean_republished_successor_metrics_reject(){rejects(|f|f.next.layout_space_metrics.push(()));}
#[test]fn missing_successor_line_rejects(){rejects(|f|f.next.line_segs.clear());}
#[test]fn multiline_successor_rejects(){rejects(|f|f.next.line_segs.push(f.next.line_segs[0].clone()));}
#[test]fn synthetic_successor_line_rejects(){rejects(|f|f.next.line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY);}
#[test]fn successor_does_not_rewind_rejects(){rejects(|f|f.next.line_segs[0].vertical_pos=4800);}
#[test]fn nonpositive_successor_position_rejects(){rejects(|f|f.next.line_segs[0].vertical_pos=0);}
#[test]fn successor_without_positive_line_box_rejects(){rejects(|f|f.next.line_segs[0].line_height=0);}
#[test]fn successor_without_visible_width_rejects(){rejects(|f|f.next.line_segs[0].segment_width=0);}
#[test]fn one_hu_tail_closure_mismatch_rejects(){rejects(|f|f.next.line_segs[0].vertical_pos+=1);}
#[test]fn measured_tail_cannot_substitute_for_different_declared_tail(){rejects(|f|{f.measured[5]=3001;f.next.line_segs[0].vertical_pos=3201;});}
#[test]fn prefix_cannot_overflow_the_source_opening(){rejects(|f|f.measured[4]+=1000);}
#[test]fn complete_object_height_is_not_an_opening_frame(){rejects(|f|table_mut(f).common.height=12400);}
#[test]fn zero_object_height_rejects(){rejects(|f|table_mut(f).common.height=0);}
#[test]fn invalid_object_height_rejects(){rejects(|f|table_mut(f).common.height=i32::MAX as u32+1);}
#[test]fn inline_object_rejects(){rejects(|f|table_mut(f).common.treat_as_char=true);}
#[test]fn nonflow_object_rejects(){rejects(|f|table_mut(f).common.flow_with_text=false);}
#[test]fn overlap_object_rejects(){rejects(|f|table_mut(f).common.allow_overlap=true);}
#[test]fn different_wrap_rejects(){rejects(|f|table_mut(f).common.text_wrap=TextWrap::Square);}
#[test]fn nonparagraph_reference_rejects(){rejects(|f|table_mut(f).common.vert_rel_to=VertRelTo::Page);}
#[test]fn nontop_anchor_rejects(){rejects(|f|table_mut(f).common.vert_align=VertAlign::Center);}
#[test]fn positioned_offset_rejects(){rejects(|f|table_mut(f).common.vertical_offset=100);}
#[test]fn caption_rejects(){rejects(|f|table_mut(f).caption=Some(()));}
#[test]fn nonsplittable_object_rejects(){rejects(|f|table_mut(f).page_break=TablePageBreak::None);}
#[test]fn interrow_spacing_rejects(){rejects(|f|table_mut(f).cell_spacing=10);}
#[test]fn real_repeated_leading_header_rejects(){rejects(|f|table_mut(f).headers=vec![0]);}
#[test]fn boundary_crossing_merged_cell_rejects(){rejects(|f|table_mut(f).cells[4].row_span=2);}
#[test]fn missing_measurement_rejects(){rejects(|f|{f.measured.pop();});}
#[test]fn nonpositive_measurement_rejects(){for h in [0,-1]{rejects(|f|f.measured[2]=h);}}
#[test]fn changed_child_cell_rejects(){rejects(|f|table_mut(f).cells[2].dirty_flag=true);}
#[test]fn changed_child_partition_rejects(){rejects(|f|table_mut(f).cells[2].paragraphs[0].dirty=true);}
#[test]fn changed_child_position_rejects(){rejects(|f|table_mut(f).cells[2].paragraphs[0].cell_format_vpos_dirty=true);}
#[test]fn clean_republished_child_rejects(){rejects(|f|table_mut(f).cells[2].paragraphs[0].layout_space_metrics.push(()));}
#[test]fn synthetic_child_line_rejects(){rejects(|f|table_mut(f).cells[2].paragraphs[0].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY);}
#[test]fn missing_child_lines_rejects(){rejects(|f|table_mut(f).cells[2].paragraphs[0].line_segs.clear());}
#[test]fn deep_republished_descendant_rejects(){rejects(|f|{let mut deep=child();deep.cells[0].paragraphs[0].layout_space_metrics.push(());table_mut(f).cells[2].paragraphs[0].controls.push(Control::Table(Box::new(deep)));});}
#[test]fn explicit_page_break_cannot_be_transferred(){rejects(|f|f.next.column_type=ColumnBreakType::Page);}
#[test]fn explicit_section_break_cannot_be_transferred(){rejects(|f|f.next.column_type=ColumnBreakType::Section);}
#[test]fn explicit_column_break_cannot_be_transferred(){rejects(|f|f.next.column_type=ColumnBreakType::Column);}
#[test]fn explicit_multicolumn_break_cannot_be_transferred(){rejects(|f|f.next.column_type=ColumnBreakType::MultiColumn);}
#[test]fn explicit_host_page_break_rejects(){rejects(|f|f.host.column_type=ColumnBreakType::Page);}
fn prefix_fixture()->Cell{let f=fixture();Cell{dirty_flag:false,row:0,col:0,col_span:1,text_direction:0,height:1000,padding:Padding{top:0,bottom:0},apply_inner_margin:false,row_span:1,paragraphs:vec![paragraph("PREFIX",0,18000),f.host,f.next]}}
fn prefix_rejects(change:impl FnOnce(&mut Cell)){let mut cell=prefix_fixture();change(&mut cell);assert!(!stored_nested_tail_cell_prefix_is_original(&cell,&cell.paragraphs[1]));}
#[test]fn accepts_original_containing_prefix(){let cell=prefix_fixture();assert!(stored_nested_tail_cell_prefix_is_original(&cell,&cell.paragraphs[1]));}
#[test]fn prefix_host_must_be_the_exact_owner(){let cell=prefix_fixture();let other=cell.paragraphs[1].clone();assert!(!stored_nested_tail_cell_prefix_is_original(&cell,&other));}
#[test]fn dirty_containing_cell_rejects(){prefix_rejects(|cell|cell.dirty_flag=true);}
#[test]fn nonzero_containing_origin_rejects(){prefix_rejects(|cell|cell.paragraphs[0].line_segs[0].vertical_pos=100);}
#[test]fn dirty_preceding_partition_rejects(){prefix_rejects(|cell|cell.paragraphs[0].dirty=true);}
#[test]fn changed_preceding_source_position_rejects(){prefix_rejects(|cell|cell.paragraphs[0].cell_format_vpos_dirty=true);}
#[test]fn clean_republished_preceding_metrics_reject(){prefix_rejects(|cell|cell.paragraphs[0].layout_space_metrics.push(()));}
#[test]fn missing_preceding_source_lines_rejects(){prefix_rejects(|cell|cell.paragraphs[0].line_segs.clear());}
#[test]fn synthetic_preceding_source_lines_reject(){prefix_rejects(|cell|cell.paragraphs[0].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY);}
#[test]fn deep_republished_preceding_control_rejects(){prefix_rejects(|cell|{let mut t=child();t.cells[0].paragraphs[0].layout_space_metrics.push(());cell.paragraphs[0].controls.push(Control::Table(Box::new(t)));});}


// Unrelated synthetic dimensions: the successor closes the tail, not the
// host's local coordinate. An ordinary forward flow closes the full object.
#[test]fn forward_closed_tail_accepts_exact_opening(){let mut f=fixture();table_mut(&mut f).common.height=9400;f.host.line_segs[0].vertical_pos=2000;assert_eq!(run(&f).unwrap().tail_start_row,5);}
#[test]fn equal_closed_tail_accepts_exact_opening(){let mut f=fixture();table_mut(&mut f).common.height=9400;f.host.line_segs[0].vertical_pos=3200;assert_eq!(run(&f).unwrap().tail_start_row,5);}
#[test]fn forward_closed_tail_does_not_invent_blank_opening(){let mut f=fixture();f.host.line_segs[0].vertical_pos=2000;assert!(run(&f).is_none());}
#[test]fn equal_closed_tail_does_not_invent_blank_opening(){let mut f=fixture();f.host.line_segs[0].vertical_pos=3200;assert!(run(&f).is_none());}
#[test]fn ordinary_forward_flow_owns_full_height_not_tail(){let mut f=fixture();table_mut(&mut f).common.height=9400;f.host.line_segs[0].vertical_pos=2000;f.next.line_segs[0].vertical_pos=14600;assert!(run(&f).is_none());}
#[test]fn ordinary_same_position_without_exact_tail_closure_rejects(){let mut f=fixture();table_mut(&mut f).common.height=9400;f.host.line_segs[0].vertical_pos=3100;f.next.line_segs[0].vertical_pos=3100;assert!(run(&f).is_none());}
fn expanded_fixture()->Fixture{
 let mut f=fixture();f.measured=vec![1200,2000,2500,1500,5200,3000];
 let t=table_mut(&mut f);t.common.height=7200;t.raw[4]=1200;
 let mut inline=child();inline.common.treat_as_char=true;inline.common.height=4800;
 let mut para=paragraph("",0,18000);para.line_segs[0].line_height=5000;
 para.controls=vec![Control::ColumnDef(crate::model::control::Columns{column_count:1}),Control::Table(Box::new(inline))];
 t.cells[4].paragraphs=vec![para];f.host.line_segs[0].vertical_pos=2000;f.next.line_segs[0].vertical_pos=8400;f
}
fn expanded_rejects(change:impl FnOnce(&mut Fixture)){let mut f=expanded_fixture();change(&mut f);assert!(run(&f).is_none());}
fn expanded_inline(f:&mut Fixture)->&mut Table{let Control::Table(t)=&mut table_mut(f).cells[4].paragraphs[0].controls[1]else{panic!()};t}
#[test]fn expanded_inline_tail_closes_independent_source_band(){let f=expanded_fixture();let p=run(&f).unwrap();assert_eq!((p.tail_start_row,p.tail_height_hu),(4,8200));}
#[test]fn expanded_tail_accepts_inherited_padding(){let f=expanded_fixture();assert!(stored_nested_inline_tail_row_is_closed(table(&f),4,5200));}
#[test]fn expanded_tail_accepts_explicit_equivalent_padding(){let mut f=expanded_fixture();let c=&mut table_mut(&mut f).cells[4];c.apply_inner_margin=true;c.padding=Padding{top:70,bottom:130};assert!(run(&f).is_some());}
#[test]fn expanded_tail_rejects_changed_explicit_padding(){expanded_rejects(|f|{let c=&mut table_mut(f).cells[4];c.apply_inner_margin=true;c.padding=Padding{top:0,bottom:0};});}
#[test]fn expanded_tail_rejects_one_hu_inline_geometry_mismatch(){expanded_rejects(|f|expanded_inline(f).common.height+=1);}
#[test]fn expanded_tail_rejects_text_owner(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs[0].text="MIXED".into());}
#[test]fn expanded_tail_rejects_caption(){expanded_rejects(|f|expanded_inline(f).caption=Some(()));}
#[test]fn expanded_tail_rejects_noninline_owner(){expanded_rejects(|f|expanded_inline(f).common.treat_as_char=false);}
#[test]fn expanded_tail_rejects_negative_outer_margin(){expanded_rejects(|f|expanded_inline(f).outer_margin_top=-1);}
#[test]fn expanded_tail_rejects_overlap(){expanded_rejects(|f|expanded_inline(f).common.allow_overlap=true);}
#[test]fn expanded_tail_rejects_extra_paragraph(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs.push(paragraph("TAIL",0,1000)));}
#[test]fn expanded_tail_rejects_extra_line(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs[0].line_segs.push(paragraph("X",0,1000).line_segs[0].clone()));}
#[test]fn expanded_tail_rejects_merged_row(){expanded_rejects(|f|table_mut(f).cells[4].row_span=2);}
#[test]fn expanded_tail_rejects_merged_column(){expanded_rejects(|f|table_mut(f).cells[4].col_span=2);}
#[test]fn expanded_tail_rejects_vertical_text(){expanded_rejects(|f|table_mut(f).cells[4].text_direction=1);}
#[test]fn expanded_tail_rejects_unknown_control(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs[0].controls.push(Control::Other));}
#[test]fn expanded_tail_rejects_multi_column_metadata(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs[0].controls[0]=Control::ColumnDef(crate::model::control::Columns{column_count:2}));}
#[test]fn expanded_tail_rejects_repeated_column_metadata(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs[0].controls.push(Control::ColumnDef(crate::model::control::Columns{column_count:1})));}
#[test]fn expanded_tail_rejects_descendant_reflow(){expanded_rejects(|f|expanded_inline(f).cells[0].paragraphs[0].layout_space_metrics.push(()));}
#[test]fn expanded_tail_rejects_descendant_dirty(){expanded_rejects(|f|expanded_inline(f).cells[0].dirty_flag=true);}
#[test]fn expanded_tail_rejects_descendant_synthetic_line(){expanded_rejects(|f|expanded_inline(f).cells[0].paragraphs[0].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY);}
#[test]fn expanded_tail_rejects_sibling_owned_row_max(){expanded_rejects(|f|{let t=table_mut(f);t.col_count=2;let mut sibling=t.cells[4].clone();sibling.col=1;sibling.height=6000;sibling.paragraphs=vec![paragraph("OTHER",0,1000)];t.cells.push(sibling);});}
#[test]fn expanded_tail_rejects_duplicate_column(){expanded_rejects(|f|{let t=table_mut(f);t.col_count=2;t.cells.push(t.cells[4].clone());});}
#[test]fn expanded_tail_rejects_missing_column(){expanded_rejects(|f|table_mut(f).col_count=2);}
#[test]fn expanded_tail_accepts_short_sibling_closed_inside_band(){let mut f=expanded_fixture();let t=table_mut(&mut f);t.col_count=2;let mut sibling=t.cells[4].clone();sibling.col=1;sibling.height=1200;sibling.paragraphs=vec![paragraph("OTHER",0,1000)];t.cells.push(sibling);assert!(run(&f).is_some());}
#[test]fn expanded_tail_rejects_source_height_shrink(){expanded_rejects(|f|table_mut(f).cells[4].height=6000);}
#[test]fn expanded_tail_accepts_parsed_single_column_metadata(){let mut f=expanded_fixture();let p=&mut table_mut(&mut f).cells[4].paragraphs[0];p.column_type=ColumnBreakType::MultiColumn;p.raw_break_type=0x02;assert!(run(&f).is_some());}
#[test]fn expanded_tail_rejects_explicit_page_column_section_breaks(){for (kind,raw) in [(ColumnBreakType::Page,6),(ColumnBreakType::Column,10),(ColumnBreakType::Section,3)]{expanded_rejects(|f|{let p=&mut table_mut(f).cells[4].paragraphs[0];p.column_type=kind;p.raw_break_type=raw;});}}
#[test]fn expanded_tail_rejects_unwitnessed_multicolumn_break(){expanded_rejects(|f|{let p=&mut table_mut(f).cells[4].paragraphs[0];p.column_type=ColumnBreakType::MultiColumn;p.raw_break_type=2;p.controls.remove(0);});}
#[test]fn expanded_tail_rejects_wrong_metadata_break_bits(){for raw in [0,1,3,4,8,10]{expanded_rejects(|f|{let p=&mut table_mut(f).cells[4].paragraphs[0];p.column_type=ColumnBreakType::MultiColumn;p.raw_break_type=raw;});}}
#[test]fn expanded_tail_rejects_parsed_two_column_declaration(){expanded_rejects(|f|{let p=&mut table_mut(f).cells[4].paragraphs[0];p.column_type=ColumnBreakType::MultiColumn;p.raw_break_type=2;p.controls[0]=Control::ColumnDef(crate::model::control::Columns{column_count:2});});}

#[derive(Clone,Copy)]struct Profile;
impl Profile{fn hwpx_stored_layout(self)->bool{true}fn hwp5_stored_pagination_layout(self)->bool{false}fn session_edited(self)->bool{false}}
struct Overlay{body:u32}
impl Overlay{fn table_text_reflowed(&self,_table:&Table)->bool{false}fn source_body_height_hu(&self,_table:&Table)->Option<u32>{Some(self.body)}}
struct ParaStyle{spacing_before:f64,spacing_after:f64}
struct ResolvedStyleSet{para_styles:Vec<ParaStyle>}
struct Engine{profile:std::cell::Cell<Profile>,render_normalization:std::cell::RefCell<Overlay>,dpi:f64,measured_override:Option<Vec<i64>>,declared_trust_allowed:std::cell::Cell<bool>}
impl Engine{
fn resolve_row_heights(&self,_table:&Table,_cols:usize,_rows:usize,_measured:Option<&()>,_styles:&ResolvedStyleSet,_relaxed:bool)->Vec<f64>{
 // Faithful legacy ambient-state behavior; the extracted new helper must isolate it.
 self.declared_trust_allowed.set(true);
 self.measured_override.clone().unwrap_or_else(||vec![1200,2000,2500,1500,2200,3000]).into_iter().map(|h|h as f64*self.dpi/7200.0).collect()
}
${sourceBlock(source,'pub(super) fn saved_nested_tail_opening_frame(')}
}
fn wrapper_fixture(body:u32)->(Engine,Cell,Table,ResolvedStyleSet){(Engine{profile:std::cell::Cell::new(Profile),render_normalization:std::cell::RefCell::new(Overlay{body}),dpi:96.0,measured_override:None,declared_trust_allowed:std::cell::Cell::new(false)},prefix_fixture(),child(),ResolvedStyleSet{para_styles:vec![ParaStyle{spacing_before:0.0,spacing_after:0.0}]})}
#[test]fn accepted_helper_preserves_ambient_false_trust_context(){let(engine,cell,parent,styles)=wrapper_fixture(22000);let host=&cell.paragraphs[1];let Control::Table(table)=&host.controls[0]else{panic!()};assert!(engine.saved_nested_tail_opening_frame(&parent,&cell,host,Some(&cell.paragraphs[2]),table,&styles).is_some());assert!(!engine.declared_trust_allowed.get(),"A successful source proof must restore its caller's false context");}
#[test]fn rejected_helper_preserves_ambient_false_trust_context(){let(engine,cell,parent,styles)=wrapper_fixture(12000);let host=&cell.paragraphs[1];let Control::Table(table)=&host.controls[0]else{panic!()};assert!(engine.saved_nested_tail_opening_frame(&parent,&cell,host,Some(&cell.paragraphs[2]),table,&styles).is_none());assert!(!engine.declared_trust_allowed.get(),"A rejected source proof must not change its caller's false context");}

#[test]fn accepted_helper_preserves_ambient_true_trust_context(){let(engine,cell,parent,styles)=wrapper_fixture(22000);engine.declared_trust_allowed.set(true);let host=&cell.paragraphs[1];let Control::Table(table)=&host.controls[0]else{panic!()};assert!(engine.saved_nested_tail_opening_frame(&parent,&cell,host,Some(&cell.paragraphs[2]),table,&styles).is_some());assert!(engine.declared_trust_allowed.get(),"A successful proof must restore its caller's true context");}
#[test]fn rejected_helper_preserves_ambient_true_trust_context(){let(engine,cell,parent,styles)=wrapper_fixture(12000);engine.declared_trust_allowed.set(true);let host=&cell.paragraphs[1];let Control::Table(table)=&host.controls[0]else{panic!()};assert!(engine.saved_nested_tail_opening_frame(&parent,&cell,host,Some(&cell.paragraphs[2]),table,&styles).is_none());assert!(engine.declared_trust_allowed.get(),"A rejected proof must restore its caller's true context");}

fn expanded_wrapper(body:u32)->(Engine,Cell,Table,ResolvedStyleSet){
 let (mut e,mut c,p,mut s)=wrapper_fixture(body);let mut f=expanded_fixture();
 table_mut(&mut f).cells[4].paragraphs[0].para_shape_id=1;
 e.measured_override=Some(f.measured.clone());c.paragraphs[1]=f.host;c.paragraphs[2]=f.next;
 s.para_styles.push(ParaStyle{spacing_before:0.0,spacing_after:0.0});(e,c,p,s)
}
fn expanded_wrapper_run(e:&Engine,c:&Cell,p:&Table,s:&ResolvedStyleSet)->Option<StoredNestedTailOpeningFrame>{let h=&c.paragraphs[1];let Control::Table(t)=&h.controls[0]else{panic!()};e.saved_nested_tail_opening_frame(p,c,h,Some(&c.paragraphs[2]),t,s)}
#[test]fn forward_expanded_wrapper_passes_real_source_gate(){let(e,c,p,s)=expanded_wrapper(22000);assert!(expanded_wrapper_run(&e,&c,&p,&s).is_some());assert!(!e.declared_trust_allowed.get());}
#[test]fn forward_expanded_wrapper_requires_tail_fit_actual_source_body(){let(e,c,p,s)=expanded_wrapper(8300);assert!(expanded_wrapper_run(&e,&c,&p,&s).is_none());assert!(!e.declared_trust_allowed.get());}
#[test]fn forward_expanded_wrapper_requires_opening_fit_actual_source_body(){let(e,c,p,s)=expanded_wrapper(9300);assert!(expanded_wrapper_run(&e,&c,&p,&s).is_none());}
#[test]fn forward_expanded_wrapper_rejects_inline_paragraph_spacing(){for before in [true,false]{let(e,c,p,mut s)=expanded_wrapper(22000);if before{s.para_styles[1].spacing_before=1.0;}else{s.para_styles[1].spacing_after=1.0;}assert!(expanded_wrapper_run(&e,&c,&p,&s).is_none());}}
#[test]fn forward_expanded_wrapper_rejects_missing_inline_source_style(){let(e,c,p,mut s)=expanded_wrapper(22000);s.para_styles.truncate(1);assert!(expanded_wrapper_run(&e,&c,&p,&s).is_none());}

// Serialized reflow history cannot regain original source-frame authority.
#[test]fn history_host_cannot_regain_source(){rejects(|f|f.host.source_frame_reflowed=true);}
#[test]fn history_successor_cannot_regain_source(){rejects(|f|f.next.source_frame_reflowed=true);}
#[test]fn history_child_cannot_regain_source(){rejects(|f|table_mut(f).cells[2].paragraphs[0].source_frame_reflowed=true);}
#[test]fn history_prefix_cannot_regain_source(){prefix_rejects(|cell|cell.paragraphs[0].source_frame_reflowed=true);}
#[test]fn history_expanded_owner_cannot_regain_source(){expanded_rejects(|f|table_mut(f).cells[4].paragraphs[0].source_frame_reflowed=true);}
#[test]fn history_deep_inline_cannot_regain_source(){expanded_rejects(|f|expanded_inline(f).cells[0].paragraphs[0].source_frame_reflowed=true);}

}
`;
await runRustTests({name:'stored-nested-tail-wrapper-state',sourceSha256,code});
