import fs from 'node:fs/promises';
import path from 'node:path';
import {loadEngineSource, sourceBlock, runRustTests} from './harness.mjs';
const {root,source,sourceSha256}=await loadEngineSource();
const paragraphSource=await fs.readFile(path.join(root,'src/model/paragraph.rs'),'utf8');
const extract=marker=>sourceBlock(source,marker);
const constant=paragraphSource.match(/pub const TAG_IMPLEMENTATION_PROPERTY: u32 = [^;]+;/)?.[0];if(!constant)throw Error('Original synthetic-line constant missing');
const fixtureModels=`
mod model {
 pub mod paragraph {
  pub struct LineSeg { pub vertical_pos:i32, pub tag:u32 }
  impl LineSeg { ${constant} }
  pub struct Paragraph { pub text:String,pub controls:Vec<()>,pub line_segs:Vec<LineSeg>,pub text_partition_dirty:bool,pub cell_format_vpos_dirty:bool }
  impl Paragraph {pub fn stored_text_partition_is_dirty(&self)->bool{self.text_partition_dirty}}
 }
 pub mod table {
  pub struct Cell {pub row:u16,pub col:u16,pub row_span:u16,pub paragraphs:Vec<super::paragraph::Paragraph>,pub units:Vec<crate::extracted::CellUnit>}
  pub struct Table {pub cells:Vec<Cell>}
 }
}
`;
const types=[
 'type RowCut=Vec<usize>;',
 '#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]\n'+extract('enum RecursiveBlockPreludeRole {'),
 extract('pub(super) struct CellUnit {'),
 '#[derive(Debug,Clone)]\n'+extract('struct NestedTableUnitCut {'),
 'struct ResolvedStyleSet; struct LayoutEngine;',
 'impl LayoutEngine {\n'+[
  // Fixture injection only: unit construction/measurement is outside this
  // predicate harness and must be tested by real-engine integration tests.
  'fn cell_units<\'a>(&self,cell:&\'a crate::model::table::Cell,_table:&crate::model::table::Table,_styles:&ResolvedStyleSet)->&\'a Vec<CellUnit>{&cell.units}',
  extract('pub(crate) fn row_cut_cell_order('),
  extract('fn cell_unit_has_visible_content('),
  extract('pub(super) fn nested_row_cut_plain_source_frame_boundary('),
 ].join('\n\n')+'\n}',
 extract('fn saved_reset_unit('),
];
const tests=`
use crate::model::paragraph::{Paragraph,LineSeg};
use crate::model::table::{Cell,Table};
fn paragraph(pos:i32)->Paragraph{Paragraph{text:"source".into(),controls:vec![],line_segs:vec![LineSeg{vertical_pos:pos,tag:0}],text_partition_dirty:false,cell_format_vpos_dirty:false}}
fn owner(col:u16,positions:&[i32])->Cell{let paragraphs=positions.iter().map(|&p|paragraph(p)).collect();let units=(0..positions.len()).map(|i|saved_reset_unit(16.0,i,1,false)).collect();Cell{row:0,col,row_span:1,paragraphs,units}}
fn result(table:&Table,cut:&[usize])->Option<bool>{LayoutEngine.nested_row_cut_plain_source_frame_boundary(table,0,cut,&ResolvedStyleSet)}
#[test]
fn completed_labels_do_not_invalidate_the_remaining_plain_restart(){let t=Table{cells:vec![owner(0,&[0]),owner(1,&[0]),owner(2,&[1600,0])]};assert_eq!(result(&t,&[1,1,1]),Some(true));}
#[test]
fn nested_host_fragment_repetition_is_not_a_plain_source_frame(){let mut c=owner(0,&[0,1600,0]);for unit in &mut c.units{unit.para_idx=2;unit.mixed_nested_fragment=true;}let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn remaining_ordinary_visible_sibling_prevents_synchronized_restart(){let t=Table{cells:vec![owner(0,&[1600,0]),owner(1,&[1600,3200])]};assert_eq!(result(&t,&[1,1]),Some(false));}
#[test]
fn two_active_plain_reset_cells_synchronize_the_same_cut(){let t=Table{cells:vec![owner(0,&[1600,0]),owner(1,&[1200,0])]};assert_eq!(result(&t,&[1,1]),Some(true));}
#[test]
fn synthetic_line_cannot_authorize_a_source_frame(){let mut c=owner(0,&[1600,0]);c.paragraphs[1].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn previous_control_host_is_not_a_plain_previous_source(){let mut c=owner(0,&[1600,0]);c.paragraphs[0].controls.push(());let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn empty_spacer_sibling_is_not_a_remaining_visible_owner(){let mut spacer=owner(0,&[0]);spacer.paragraphs[0].text.clear();spacer.units[0].empty_spacer=true;let t=Table{cells:vec![spacer,owner(1,&[1600,0])]};assert_eq!(result(&t,&[0,1]),Some(true));}
#[test]
fn cursor_beyond_available_units_is_rejected(){let t=Table{cells:vec![owner(0,&[1600,0])]};assert_eq!(result(&t,&[3]),None);}
#[test]
fn future_nested_content_does_not_erase_the_plain_current_owner(){let mut c=owner(0,&[1600,0,1600]);c.units[2].nested_row=Some(0);let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),Some(true));}
#[test]
fn synthetic_previous_line_cannot_authorize_a_source_frame(){let mut c=owner(0,&[1600,0]);c.paragraphs[0].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn repeated_zero_origins_do_not_prove_a_rewind(){let t=Table{cells:vec![owner(0,&[0,0])]};assert_eq!(result(&t,&[1]),Some(false));}
#[test]
fn mid_paragraph_continuation_is_not_a_plain_paragraph_restart(){let mut c=owner(0,&[1600,0]);c.units[1].vis_start=1;c.units[1].vis_end=2;let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),Some(false));}
#[test]
fn mismatched_or_empty_row_cursor_is_inconclusive(){let t=Table{cells:vec![owner(0,&[1600,0])]};assert_eq!(result(&t,&[]),None);assert_eq!(result(&Table{cells:vec![]},&[]),None);}
#[test]
fn crossing_rowspan_is_inconclusive(){let mut c=owner(0,&[1600,0]);c.row_span=2;let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn no_remaining_owner_does_not_create_an_empty_page_boundary(){let t=Table{cells:vec![owner(0,&[1600,0])]};assert_eq!(result(&t,&[2]),None);}
#[test]
fn cell_order_uses_columns_instead_of_storage_order(){let t=Table{cells:vec![owner(2,&[1600,0]),owner(0,&[0])]};assert_eq!(result(&t,&[1,1]),Some(true));}
#[test]
fn rowspan_from_an_earlier_row_does_not_authorize_a_local_boundary(){let mut above=owner(0,&[0]);above.row_span=2;let mut current=owner(1,&[1600,0]);current.row=1;let t=Table{cells:vec![above,current]};assert_eq!(LayoutEngine.nested_row_cut_plain_source_frame_boundary(&t,1,&[1],&ResolvedStyleSet),None);}
#[test]
fn skipping_an_empty_unit_cannot_cross_its_distinct_source_boundary(){let mut c=owner(0,&[1600,0]);let mut separator=saved_reset_unit(0.0,0,0,true);separator.empty_spacer=true;c.units.insert(1,separator);let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn non_inline_control_atom_at_cursor_is_inconclusive(){let mut c=owner(0,&[1600,0]);c.units[1].non_inline_control_range=Some((0,0));let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn edited_text_invalidates_the_stored_source_frame(){let mut c=owner(0,&[1600,0]);c.paragraphs[1].text_partition_dirty=true;let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
#[test]
fn edited_cell_format_invalidates_the_stored_source_frame(){let mut c=owner(0,&[1600,0]);c.paragraphs[0].cell_format_vpos_dirty=true;let t=Table{cells:vec![c]};assert_eq!(result(&t,&[1]),None);}
`;
await runRustTests({name:'source-frame',sourceSha256,code:fixtureModels+'\nmod extracted {\n'+types.join('\n\n')+'\n'+tests+'\n}\n'});
