import test from 'node:test';
import {loadEngineSource, sourceBlock, runRustTests} from './engine-source-ownership/harness.mjs';

test('original row-frame ownership preserves ink and rejects ambiguous label tails', {
  skip: !process.env.PWH_ENGINE_SOURCE && 'Requires PWH_ENGINE_SOURCE and a Rust compiler',
}, async () => {
  const {source, sourceSha256} = await loadEngineSource();
  const code = `
mod model {
 pub mod paragraph {
  #[derive(Clone)] pub struct LineSeg {pub vertical_pos:i32,pub line_height:i32,pub line_spacing:i32}
  #[derive(Clone)] pub struct Paragraph {pub line_segs:Vec<LineSeg>,pub controls:Vec<()>,pub original:bool}
 }
 pub mod table {
  use super::paragraph::Paragraph;
  #[derive(Clone,Copy)] pub struct Padding {pub top:u16,pub bottom:u16}
  #[derive(Clone)] pub struct Common {pub height:u32}
  #[derive(Clone)] pub struct Cell {pub row:u16,pub row_span:u16,pub dirty_flag:bool,pub paragraphs:Vec<Paragraph>,pub padding:Padding}
  impl Cell {pub fn effective_padding(&self,_:&Padding)->Padding{self.padding}}
  #[derive(Clone)] pub struct Table {pub cells:Vec<Cell>,pub common:Common,pub padding:Padding,pub cell_spacing:u16,pub raw:Vec<u32>}
  // Raw row sizes are an independent source-geometry input oracle.
  impl Table {pub fn get_raw_row_heights(&self)->Vec<u32>{self.raw.clone()}}
 }
}
use model::paragraph::{Paragraph,LineSeg};
use model::table::{Table,Cell,Common,Padding};
// Existing mutation provenance is tested independently by the engine suite.
fn stored_float_frame_owner_is_original(p:&Paragraph)->bool{p.original}
${sourceBlock(source, 'fn stored_label_row_frame_excludes_tail_spacing(')}
fn line(v:i32)->LineSeg{LineSeg{vertical_pos:v,line_height:1000,line_spacing:500}}
fn cell()->Cell{Cell{row:2,row_span:1,dirty_flag:false,paragraphs:vec![Paragraph{line_segs:vec![line(0)],controls:vec![],original:true}],padding:Padding{top:141,bottom:141}}}
fn fixture()->Table{let active=Cell{paragraphs:vec![Paragraph{line_segs:vec![line(0),line(6908)],controls:vec![],original:true}],..cell()};Table{cells:vec![cell(),active],common:Common{height:16909},padding:Padding{top:141,bottom:141},cell_spacing:0,raw:vec![2414,6065,10053]}}
fn proof(t:&Table)->bool{stored_label_row_frame_excludes_tail_spacing(t,&t.cells[1],&line(6908))}
#[test]fn frame_ending_after_ink_but_before_tail_spacing_owns_only_the_ink(){assert!(proof(&fixture()));}
#[test]fn full_spacing_inside_the_frame_cannot_be_discarded(){let mut t=fixture();t.common.height=17169;assert!(!proof(&t));}
#[test]fn exact_ink_edge_is_valid_but_ink_outside_the_frame_is_not(){let mut t=fixture();t.common.height=16669;assert!(proof(&t));t.common.height-=1;assert!(!proof(&t));}
#[test]fn original_row_spacing_is_part_of_the_same_frame(){let mut t=fixture();t.cell_spacing=20;t.common.height+=40;assert!(proof(&t));}
#[test]fn a_second_active_source_cell_requires_its_own_paired_frame_evidence(){let mut t=fixture();let extra=t.cells[0].paragraphs[0].clone();t.cells[0].paragraphs.push(extra);assert!(!proof(&t));}
#[test]fn merged_rows_cannot_be_reinterpreted_as_completed_label_cells(){let mut t=fixture();t.cells[0].row_span=2;assert!(!proof(&t));}
#[test]fn edits_and_reflowed_source_never_authenticate_the_original_frame(){let mut t=fixture();t.cells[1].dirty_flag=true;assert!(!proof(&t));t=fixture();t.cells[1].paragraphs[0].original=false;assert!(!proof(&t));t=fixture();t.cells[0].paragraphs[0].original=false;assert!(!proof(&t));}
#[test]fn controls_and_multiple_label_lines_are_ambiguous(){let mut t=fixture();t.cells[0].paragraphs[0].controls.push(());assert!(!proof(&t));t=fixture();t.cells[0].paragraphs[0].line_segs.push(line(1500));assert!(!proof(&t));}
#[test]fn malformed_dimensions_are_rejected(){for h in [0,u32::MAX]{let mut t=fixture();t.common.height=h;assert!(!proof(&t));}let mut t=fixture();t.raw[0]=0;assert!(!proof(&t));}
#[test]fn oversized_row_spans_do_not_overflow_the_ownership_check(){let mut t=fixture();t.cells[0].row=u16::MAX;t.cells[0].row_span=u16::MAX;let _=proof(&t);}
`;
  await runRustTests({name: 'stored-label-frame', sourceSha256, code});
});

