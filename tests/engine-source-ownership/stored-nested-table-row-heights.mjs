
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceBlock,runRustTests} from './harness.mjs';
const root=process.argv[2]||process.env.PWH_ENGINE_SOURCE;
if(!root)throw Error('Pass the candidate engine source');
const source=await fs.readFile(root+'/src/renderer/float_placement.rs','utf8');
const contiguousMarker='pub(crate) fn saved_contiguous_cell_ink_end(';
const code=String.raw`
mod model {
 pub mod table {pub(crate) use crate::Cell;}
 pub mod shape {
  #[derive(Clone,Copy,Default,PartialEq)]pub enum VertRelTo{#[default]Para,Page}
  #[derive(Clone,Copy,Default,PartialEq)]pub enum VertAlign{#[default]Top,Center}
 }
 pub mod paragraph {
  #[derive(Clone)]pub struct LineSeg{pub tag:u32,pub vertical_pos:i32,pub line_height:i32,pub line_spacing:i32}
  impl LineSeg{pub const TAG_IMPLEMENTATION_PROPERTY:u32=1<<31;}
 }
 pub mod control {
  #[derive(Clone,Copy,PartialEq)]pub enum FieldType{Formula,Hyperlink}
 }
}
use model::{shape::{VertRelTo,VertAlign},paragraph::LineSeg,control::FieldType};
#[derive(Clone,Copy,Default,PartialEq)]enum TextWrap{#[default]TopAndBottom,Square}
#[derive(Clone)]struct Columns{column_count:u16,spacing:i16}
#[derive(Clone)]struct Field{field_type:FieldType}
#[derive(Clone)]enum Control{ColumnDef(Columns),Field(Field),Picture}
#[derive(Clone)]struct Paragraph {
 text:String,line_segs:Vec<LineSeg>,controls:Vec<Control>,field_ranges:Vec<()>,
 orphan_field_ends:Vec<()>,layout_space_metrics:Vec<()>,source_frame_reflowed:bool,
 cell_format_vpos_dirty:bool,dirty:bool,
}
impl Paragraph{fn stored_text_partition_is_dirty(&self)->bool{self.dirty}}
#[derive(Clone)]pub(crate) struct Cell {
 row:u16,row_span:u16,text_direction:u8,dirty_flag:bool,height:u32,paragraphs:Vec<Paragraph>,
}
impl Cell{fn effective_vertical_padding_hu(&self,pad:&i32)->i32{*pad}}
#[derive(Default)]struct Common {
 height:u32,treat_as_char:bool,flow_with_text:bool,allow_overlap:bool,vert_rel_to:VertRelTo,
 vert_align:VertAlign,text_wrap:TextWrap,vertical_offset:u32,
}
struct Table {
 common:Common,raw_table_record_attr:u32,row_count:u16,cells:Vec<Cell>,
 padding:i32,cell_spacing:i16,caption:Option<()>,
}
fn signed_hwpunit(v:u32)->i32{v as i32}
fn hwpunit_to_px(h:i32,dpi:f64)->f64{f64::from(h)*dpi/7200.0}
 CONTIGUOUS_SOURCE
 INLINE_SOURCE
 STACKED_SOURCE
fn paragraph()->Paragraph {
 Paragraph{text:"stored text".into(),line_segs:vec![LineSeg{tag:0,vertical_pos:0,line_height:1000,line_spacing:200}],
  controls:vec![],field_ranges:vec![],orphan_field_ends:vec![],layout_space_metrics:vec![],
  source_frame_reflowed:false,cell_format_vpos_dirty:false,dirty:false}
}
fn cell(row:u16,height:u32)->Cell {
 Cell{row,row_span:1,height,text_direction:0,dirty_flag:false,paragraphs:vec![paragraph()]}
}
fn inline()->Table {
 let mut merged=cell(0,250);merged.row_span=2;
 Table{common:Common{height:3600,treat_as_char:true,..Default::default()},
  raw_table_record_attr:8,row_count:3,cells:vec![merged,cell(0,200),cell(1,200),cell(2,200)],
  padding:200,cell_spacing:0,caption:None}
}
fn stack()->Table {
 let mut long=cell(1,3400);
 long.paragraphs=vec![paragraph(),paragraph(),paragraph()];
 Table{common:Common{height:6600,flow_with_text:true,allow_overlap:true,vertical_offset:1500,..Default::default()},
  raw_table_record_attr:0,row_count:3,cells:vec![cell(0,1200),long,cell(2,1200)],
  padding:200,cell_spacing:0,caption:None}
}
fn formula(c:&mut Cell,kind:FieldType){
 c.paragraphs[0].controls.push(Control::Field(Field{field_type:kind}));
 c.paragraphs[0].field_ranges.push(());
}
#[test]fn inline_preserves_each_proven_row(){assert_eq!(saved_inline_no_adjust_row_heights(&inline(),7200.0),Some(vec![1200.0;3]));}
#[test]fn closed_formula_uses_its_original_text_box(){let mut t=inline();formula(&mut t.cells[3],FieldType::Formula);assert!(saved_inline_no_adjust_row_heights(&t,96.0).is_some());}
#[test]fn formula_without_paired_range_rejects(){let mut t=inline();formula(&mut t.cells[3],FieldType::Formula);t.cells[3].paragraphs[0].field_ranges.clear();assert!(saved_inline_no_adjust_row_heights(&t,96.0).is_none());}
#[test]fn different_field_is_not_a_formula(){let mut t=inline();formula(&mut t.cells[3],FieldType::Hyperlink);assert!(saved_inline_no_adjust_row_heights(&t,96.0).is_none());}
#[test]fn incompatible_span_rejects(){let mut t=inline();t.cells[0].height=2402;assert!(saved_inline_no_adjust_row_heights(&t,96.0).is_none());}
#[test]fn unrelated_object_height_rejects(){let mut t=inline();t.common.height+=10;assert!(saved_inline_no_adjust_row_heights(&t,96.0).is_none());}
#[test]fn stacked_row_owns_the_residual(){assert_eq!(saved_stacked_float_row_heights(&stack(),7200.0),Some(vec![1200.0,4200.0,1200.0]));}
#[test]fn one_column_is_transparent_but_real_columns_are_not(){let mut t=stack();for p in &mut t.cells[1].paragraphs {p.controls.push(Control::ColumnDef(Columns{column_count:1,spacing:0}));}assert!(saved_stacked_float_row_heights(&t,96.0).is_some());t.cells[1].paragraphs[0].controls[0]=Control::ColumnDef(Columns{column_count:2,spacing:0});assert!(saved_stacked_float_row_heights(&t,96.0).is_none());}
#[test]fn ambiguous_multiple_stacked_rows_reject(){let mut t=stack();t.cells[2].paragraphs.push(paragraph());assert!(saved_stacked_float_row_heights(&t,96.0).is_none());}
#[test]fn no_growing_beyond_saved_table_box(){let mut t=stack();t.common.height=5000;assert!(saved_stacked_float_row_heights(&t,96.0).is_none());}
#[test]fn edited_line_is_not_stored_evidence(){let mut t=stack();t.cells[1].paragraphs[0].source_frame_reflowed=true;assert!(saved_stacked_float_row_heights(&t,96.0).is_none());}
`.replace('CONTIGUOUS_SOURCE',source.includes(contiguousMarker)?sourceBlock(source,contiguousMarker):'')
 .replace('INLINE_SOURCE',sourceBlock(source,'pub(crate) fn saved_inline_no_adjust_row_heights('))
 .replace('STACKED_SOURCE',sourceBlock(source,'pub(crate) fn saved_stacked_float_row_heights('));
await runRustTests({name:'stored-nested-table-row-heights',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
