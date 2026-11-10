
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceBlock,runRustTests} from './harness.mjs';
const root=process.argv[2];
const source=await fs.readFile(root+'/src/renderer/layout/table_layout.rs','utf8');
const code=String.raw`
mod model {
 pub mod paragraph {
  pub struct LineSeg {pub tag:u32,pub vertical_pos:i32,pub line_height:i32,pub line_spacing:i32}
  impl LineSeg {pub const TAG_IMPLEMENTATION_PROPERTY:u32=1<<31;}
 }
 pub mod table {
  pub struct Cell {pub paragraphs:Vec<super::super::Paragraph>,pub height:u32,pub padding:i32}
  impl Cell {pub fn effective_vertical_padding_hu(&self,_:&i32)->i32{self.padding}}
  pub struct Table {
   pub common:super::super::Common, pub caption:Option<()>, pub row_count:u16,
   pub page_break:super::super::TablePageBreak,pub outer_margin_top:i16,
   pub outer_margin_bottom:i16,pub padding:i32,pub measured:f64,
  }
 }
}
mod renderer {
 pub mod float_placement {
  use crate::*;
  fn para_has_non_whitespace_text(p:&Paragraph)->bool{!p.text.trim().is_empty()}
  fn is_para_topbottom_float(c:&Common)->bool{!c.treat_as_char}
  fn signed_hwpunit(offset:u32)->i32{offset as i32}
  FLOAT_SOURCE
 }
}
use model::{paragraph::LineSeg,table::{Cell,Table}};
struct Columns {column_count:u16}
enum Control {ColumnDef(Columns),Table(Box<Table>),Other}
#[derive(PartialEq)]
enum TablePageBreak { RowBreak }
#[derive(PartialEq)]
enum VertAlign { Top }
struct Common {
 treat_as_char:bool, flow_with_text:bool, allow_overlap:bool,
 height:u32, vertical_offset:u32, vert_align:VertAlign,
}
struct Paragraph {
 line_segs:Vec<LineSeg>,controls:Vec<Control>,text:String,
 cell_format_vpos_dirty:bool, source_frame_reflowed:bool, layout_space_metrics:Vec<()>,
}
impl Paragraph {fn stored_text_partition_is_dirty(&self)->bool{false}}
struct CellUnit {
 hard_break_before:bool,page_frame_reset_before:bool,vis_start:usize,vis_end:usize,
 mixed_nested_fragment:bool,non_inline_control_range:Option<()>,nested_row:Option<usize>,
 nested_table_fragment:Option<()>,para_idx:usize,
}
struct Engine {dpi:f64}
struct ResolvedStyleSet;
fn hwpunit_to_px(units:i32,dpi:f64)->f64{f64::from(units)*dpi/7200.0}
impl Engine {
 fn calc_nested_table_height(&self,table:&Table,_:&ResolvedStyleSet)->f64{table.measured}
 SOURCE
}
fn paragraph(vertical_pos:i32,line_height:i32,line_spacing:i32)->Paragraph {
 Paragraph {line_segs:vec![LineSeg{vertical_pos,line_height,line_spacing,tag:0}],controls:vec![],
  text:"visible".into(),cell_format_vpos_dirty:false,source_frame_reflowed:false,layout_space_metrics:vec![]}
}
fn table(inline:bool,height:u32)->Table {
 Table {common:Common {treat_as_char:inline,flow_with_text:true,allow_overlap:false,
  height,vertical_offset:0,vert_align:VertAlign::Top}, caption:None, row_count:2,
  page_break:TablePageBreak::RowBreak,outer_margin_top:70,outer_margin_bottom:50,
  padding:0,measured:hwpunit_to_px(height as i32+120,96.0)}
}
fn fixture(lines:usize)->(Cell,CellUnit) {
 let mut paragraphs=(0..lines).map(|i|paragraph((i as i32)*1237,975,262)).collect::<Vec<_>>();
 paragraphs.push(paragraph(0,875,121));
 paragraphs.push(paragraph(996,894,106));
 let unit=CellUnit{hard_break_before:true,page_frame_reset_before:true,vis_start:0,vis_end:1,
   mixed_nested_fragment:false,non_inline_control_range:None,nested_row:None,nested_table_fragment:None,para_idx:lines};
 (Cell{paragraphs,height:0,padding:0},unit)
}
fn proof(c:&Cell,u:&CellUnit)->Option<bool> {
 Engine{dpi:96.0}.saved_contiguous_frame_opening(c,&table(false,0),u,&ResolvedStyleSet)
}
fn accepts(c:&Cell,u:&CellUnit)->bool {proof(c,u)==Some(false)}
#[test]fn accepts_distinct_prefix_lengths_and_metrics(){for n in [2,3,5,8]{let (c,u)=fixture(n);assert!(accepts(&c,&u));}}
#[test]fn leading_one_column_is_neutral(){let (mut c,u)=fixture(3);c.paragraphs[0].controls.push(Control::ColumnDef(Columns{column_count:1}));assert!(accepts(&c,&u));}
#[test]fn real_column_split_is_not_neutral(){let (mut c,u)=fixture(3);c.paragraphs[0].controls.push(Control::ColumnDef(Columns{column_count:2}));assert!(!accepts(&c,&u));}
#[test]fn other_control_does_not_supply_plain_geometry(){let (mut c,u)=fixture(3);c.paragraphs[0].controls.push(Control::Other);assert!(!accepts(&c,&u));}
#[test]fn leading_control_inside_prefix_rejects(){let (mut c,u)=fixture(3);c.paragraphs[1].controls.push(Control::ColumnDef(Columns{column_count:1}));assert!(!accepts(&c,&u));}
#[test]fn requires_exact_prefix(){let (mut c,u)=fixture(3);c.paragraphs[1].line_segs[0].vertical_pos+=1;assert!(!accepts(&c,&u));}
#[test]fn requires_exact_reset(){let (mut c,u)=fixture(3);c.paragraphs[3].line_segs[0].vertical_pos=1;assert!(!accepts(&c,&u));}
#[test]fn requires_original_next_line(){let (mut c,u)=fixture(3);c.paragraphs[4].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;assert!(!accepts(&c,&u));}
#[test]fn requires_verified_next_stride(){let (mut c,u)=fixture(3);c.paragraphs[4].line_segs[0].vertical_pos+=1;assert!(!accepts(&c,&u));}
#[test]fn blank_line_does_not_supply_plain_witness(){let (mut c,u)=fixture(3);c.paragraphs[3].text=" ".into();assert!(!accepts(&c,&u));}
#[test]fn missing_reset_metadata_rejects(){let (c,mut u)=fixture(3);u.page_frame_reset_before=false;assert!(!accepts(&c,&u));}
fn object_fixture()->(Cell,CellUnit) {
 let (mut c,u)=fixture(3);
 c.paragraphs[1].controls.push(Control::Table(Box::new(table(false,2880))));
 c.paragraphs[1].line_segs[0].vertical_pos+=3000;
 c.paragraphs[2].line_segs[0].vertical_pos+=3000;
 c.paragraphs[4].controls.push(Control::Table(Box::new(table(true,1880))));
 c.paragraphs[4].text.clear();
 c.paragraphs[4].line_segs[0].line_height=2000;
 c.padding=150;
 c.height=6710;
 (c,u)
}
#[test]fn closed_float_and_exact_inline_successor(){
 let (c,u)=object_fixture();
 assert_eq!(proof(&c,&u),Some(true));
}
#[test]fn reflowed_float_does_not_authenticate_stored_frame(){
 let (mut c,u)=object_fixture();
 c.paragraphs[1].source_frame_reflowed=true;
 assert_eq!(proof(&c,&u),None);
}
#[test]fn changed_float_measurement_rejects_stored_frame(){
 let (mut c,u)=object_fixture();
 let Control::Table(child)=&mut c.paragraphs[1].controls[0] else {unreachable!()};
 child.measured+=1.0;
 assert_eq!(proof(&c,&u),None);
}
#[test]fn original_row_must_cover_visible_content(){
 let (mut c,u)=object_fixture();
 c.height=6580;
 assert_eq!(proof(&c,&u),None);
}
#[test]fn inline_box_must_close_its_own_line(){
 let (mut c,u)=object_fixture();
 c.paragraphs[4].line_segs[0].line_height-=1;
 assert_eq!(proof(&c,&u),None);
}
`.replace('FLOAT_SOURCE', sourceBlock(await fs.readFile(root+'/src/renderer/float_placement.rs','utf8'),
  'pub(crate) fn stored_cell_line_after_nested_table_at('))
  .replace('SOURCE',sourceBlock(source,'fn saved_contiguous_frame_opening('));
await runRustTests({name:'original-plain-frame-boundary',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
