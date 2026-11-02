import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {sourceBlock,runRustTests} from './harness.mjs';
const input=process.argv[2]||process.env.PWH_ENGINE_SOURCE;
if(!input)throw Error('Pass the candidate engine source root or set PWH_ENGINE_SOURCE.');
const root=path.resolve(input);
const source=await fs.readFile(path.join(root,'src/renderer/float_placement.rs'),'utf8');
const pagination=await fs.readFile(path.join(root,'src/renderer/pagination.rs'),'utf8');
const code=`
mod model {
 pub type ColorRef=u32;
 pub mod paragraph {
  #[derive(Clone)]pub struct LineSeg {pub vertical_pos:i32,pub line_height:i32,pub tag:u32}
  impl LineSeg{pub const TAG_IMPLEMENTATION_PROPERTY:u32=0x80000000;}
  #[derive(Clone)]pub struct Paragraph {pub dirty:bool,pub cell_format_vpos_dirty:bool,pub line_segs:Vec<LineSeg>,pub coanchored:bool}
  impl Paragraph{pub fn stored_text_partition_is_dirty(&self)->bool{self.dirty}}
 }
 pub mod table {
  #[derive(Clone,PartialEq)]pub enum VerticalAlign {Top,Center}
  #[derive(Clone,PartialEq)]pub enum TablePageBreak {RowBreak,CellBreak}
  #[derive(Clone)]pub struct Common {pub vertical_offset:u32,pub height:u32}
  #[derive(Clone)]pub struct Cell {pub row:u16,pub row_span:u16,pub col:u16,pub col_span:u16,pub height:u32,pub dirty_flag:bool,pub vertical_align:VerticalAlign,pub paragraphs:Vec<super::paragraph::Paragraph>}
  #[derive(Clone)]pub struct Table {pub common:Common,pub repeat_header:bool,pub page_break:TablePageBreak,pub cell_spacing:u16,pub outer_margin_top:u16,pub outer_margin_bottom:u16,pub row_count:u16,pub col_count:u16,pub cells:Vec<Cell>,pub headers:Vec<usize>}
  impl Table {
   pub fn leading_header_rows(&self)->Vec<usize>{self.headers.clone()}
   pub fn get_raw_row_heights(&self)->Vec<u32>{(0..self.row_count).map(|row|self.cells.iter().filter(|c|c.row==row&&c.row_span==1).map(|c|c.height).max().unwrap_or(0)).collect()}
  }
 }
}
use model::paragraph::{Paragraph,LineSeg};
use model::table::{Table,Common,Cell,VerticalAlign,TablePageBreak};
fn signed_hwpunit(value:u32)->i32{value as i32}
fn hwpunit_to_px(value:i32,dpi:f64)->f64{f64::from(value)*dpi/7200.0}
// Coanchored-host qualification is an independently tested existing predicate.
// This fixture flag is an input oracle, not a duplicate of that implementation.
fn stored_coanchored_block_table_frame(para:&Paragraph,_:&Table)->bool{para.coanchored&&!para.dirty&&!para.cell_format_vpos_dirty}
${sourceBlock(source,'pub(crate) fn stored_coanchored_parallel_row_frame(')}
${sourceBlock(source,'pub(crate) fn stored_parallel_row_page_reset(')}
${sourceBlock(source,'pub(crate) fn stored_parallel_row_fragment_height(')}
${sourceBlock(pagination,'pub enum PageItem {')}
impl PageItem {
 ${sourceBlock(pagination,'pub fn with_offset(')}
 ${sourceBlock(pagination,'fn matches_with_offset(')}
}
fn host()->Paragraph{Paragraph{dirty:false,cell_format_vpos_dirty:false,line_segs:vec![],coanchored:true}}
fn cell(row:u16,col:u16,span:u16,height:u32,frames:usize)->Cell{
 let line_segs=(0..frames).flat_map(|_|[LineSeg{vertical_pos:0,line_height:100,tag:0},LineSeg{vertical_pos:1200,line_height:100,tag:0}]).collect();
 Cell{row,row_span:1,col,col_span:span,height,dirty_flag:false,vertical_align:VerticalAlign::Top,paragraphs:vec![Paragraph{dirty:false,cell_format_vpos_dirty:false,line_segs,coanchored:false}]}
}
fn table()->Table{Table{common:Common{vertical_offset:0,height:1900},repeat_header:true,page_break:TablePageBreak::RowBreak,cell_spacing:0,outer_margin_top:20,outer_margin_bottom:30,row_count:3,col_count:6,headers:vec![0,1],cells:vec![cell(0,0,6,100,1),cell(1,0,6,200,1),cell(2,0,2,5700,4),cell(2,2,1,5700,1),cell(2,3,3,5700,2)]}}
fn proof(t:&Table)->Option<(f64,f64)>{stored_coanchored_parallel_row_frame(&host(),t,2,2100.0,7200.0,true,false)}
fn close(a:f64,b:f64){assert!((a-b).abs()<0.000001,"actual={a} expected={b}")}
#[test]fn unequal_width_owners_form_one_complete_saved_row_band(){assert_eq!(proof(&table()),Some((1900.0,5700.0)));}
#[test]fn four_physical_fragments_conserve_total_minimum_not_four_full_frames(){let mut used=0.0;for (i,expected) in [1600.0,1600.0,1600.0,900.0].into_iter().enumerate(){let height=stored_parallel_row_fragment_height(5700.0,used,1900.0,300.0,2100.0,600.0,i==3).unwrap();close(height,expected);used+=height;}close(used,5700.0);}
#[test]fn unequal_declared_heights_cannot_invent_a_shared_minimum(){let mut t=table();t.cells[3].height-=1;assert_eq!(proof(&t),None);}
#[test]fn crossing_rowspan_is_not_a_parallel_row_owner(){let mut t=table();t.cells[3].row_span=2;assert_eq!(proof(&t),None);}
#[test]fn overlapping_or_missing_column_ownership_rejects_the_frame(){let mut t=table();t.cells[3].col=1;assert_eq!(proof(&t),None);t=table();t.cells[4].col_span=2;assert_eq!(proof(&t),None);}
#[test]fn edited_or_implementation_line_data_never_authenticates_source_frames(){let mut t=table();t.cells[3].paragraphs[0].dirty=true;assert_eq!(proof(&t),None);t=table();t.cells[3].paragraphs[0].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;assert_eq!(proof(&t),None);assert_eq!(stored_coanchored_parallel_row_frame(&host(),&table(),2,2100.0,7200.0,true,true),None);assert_eq!(stored_coanchored_parallel_row_frame(&host(),&table(),2,2100.0,7200.0,false,false),None);}
#[test]fn reset_count_must_authenticate_the_declared_physical_frame_count(){let mut t=table();t.cells[2]=cell(2,0,2,5700,3);assert_eq!(proof(&t),None);}
#[test]fn centered_content_cannot_be_moved_by_blank_band_reservation(){let mut t=table();t.cells[2].vertical_align=VerticalAlign::Center;assert_eq!(proof(&t),None);}
#[test]fn a_frame_that_does_not_fit_the_page_cannot_justify_paint_extension(){assert_eq!(stored_coanchored_parallel_row_frame(&host(),&table(),2,1900.0,7200.0,true,false),None);}
#[test]fn missing_repeated_header_or_unqualified_host_retains_legacy_layout(){let mut t=table();t.repeat_header=false;assert_eq!(proof(&t),None);let mut h=host();h.coanchored=false;assert_eq!(stored_coanchored_parallel_row_frame(&h,&table(),2,2100.0,7200.0,true,false),None);}
#[test]fn content_is_never_compressed_and_page_budget_is_never_exceeded(){close(stored_parallel_row_fragment_height(5700.0,4800.0,1900.0,300.0,2100.0,1200.0,true).unwrap(),1200.0);assert_eq!(stored_parallel_row_fragment_height(5700.0,0.0,1900.0,300.0,2100.0,1900.0,false),None);assert_eq!(stored_parallel_row_fragment_height(5700.0,0.0,1900.0,300.0,2100.0,600.0,true),None);}
#[test]fn nonfinite_or_negative_budgets_cannot_create_a_physical_box(){assert_eq!(stored_parallel_row_fragment_height(f64::NAN,0.0,1900.0,300.0,2100.0,600.0,false),None);assert_eq!(stored_parallel_row_fragment_height(5700.0,-1.0,1900.0,300.0,2100.0,600.0,false),None);}
#[test]fn negative_or_zero_height_source_lines_do_not_authenticate_a_frame(){for invalid in [-1,0]{let mut t=table();if invalid<0{t.cells[2].paragraphs[0].line_segs[2].vertical_pos=invalid;}else{t.cells[2].paragraphs[0].line_segs[2].line_height=0;}assert_eq!(proof(&t),None);}}
#[test]fn positive_decreases_are_not_page_origin_resets(){let mut t=table();for (i,line) in t.cells[2].paragraphs[0].line_segs.iter_mut().enumerate(){if i>0&&i%2==0{line.vertical_pos=100;}}assert_eq!(proof(&t),None);}
#[test]fn short_paragraph_local_zero_origins_cannot_impersonate_a_physical_page(){let mut t=table();for (i,line) in t.cells[2].paragraphs[0].line_segs.iter_mut().enumerate(){if i%2==1{line.vertical_pos=100;}}assert_eq!(proof(&t),None);}
#[test]fn reset_origin_must_match_the_initial_source_origin(){let mut t=table();t.cells[2].paragraphs[0].line_segs[0].vertical_pos=10;assert_eq!(proof(&t),None);}
#[test]fn reset_requires_original_nonnegative_lines_and_a_substantial_preceding_frame(){let previous=LineSeg{vertical_pos:1200,line_height:100,tag:0};let mut current=LineSeg{vertical_pos:0,line_height:100,tag:0};assert!(stored_parallel_row_page_reset(&previous,&current,1600));current.vertical_pos=100;assert!(!stored_parallel_row_page_reset(&previous,&current,1600));current.vertical_pos=-1;assert!(!stored_parallel_row_page_reset(&previous,&current,1600));}
fn partial(accepted:bool)->PageItem{PageItem::PartialTable{para_index:3,control_index:2,start_row:2,end_row:3,is_continuation:true,start_cut:vec![4,2],end_cut:vec![6,3],is_block_split:false,start_cut_is_block:false,row_cursor_is_nested:false,source_parallel_frame:accepted,end_row_height_override:Some(1600.0),start_row_height_override:None}}
#[test]fn only_an_explicit_accepted_frame_survives_item_transport_as_owned(){for accepted in [true,false]{let copied=partial(accepted).with_offset(7);assert!(matches!(copied,PageItem::PartialTable{para_index:10,source_parallel_frame:flag,..}if flag==accepted));}}
#[test]fn same_numeric_override_without_accepted_ownership_cannot_reuse_frame_geometry(){assert!(!partial(true).matches_with_offset(&partial(false),0));assert!(partial(true).matches_with_offset(&partial(true),0));}
`;
await runRustTests({name:'declared-frame',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
