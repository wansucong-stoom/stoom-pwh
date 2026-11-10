import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceBlock,runRustTests} from './harness.mjs';
const root=process.argv[2]||process.env.PWH_ENGINE_SOURCE;if(!root)throw Error('Pass candidate source root');
const source=await fs.readFile(root+'/src/renderer/layout/table_layout.rs','utf8');
const code=String.raw`
mod model {
 pub mod table {
  pub struct Table {pub caption:Option<()>,pub common:super::Common,pub page_break:super::TablePageBreak,pub cells:Vec<Cell>,pub col_count:u16,pub content:f64,pub boundary:bool,pub inline_height:Option<i64>,pub direct:Option<usize>,pub dirty:bool}
  pub struct Cell {pub paragraphs:Vec<super::Paragraph>,pub units:Vec<super::CellUnit>,pub height:u32,pub col_span:u16}
 }
 pub struct Common{pub treat_as_char:bool}
 #[derive(PartialEq)]pub enum TablePageBreak{RowBreak,CellBreak}
 pub struct Paragraph{pub controls:Vec<Control>}
 pub enum Control{Table(Box<table::Table>)}
 pub struct Fragment{pub start_cut:Vec<usize>,pub end_cut:Vec<usize>,pub terminal:bool}
 pub struct CellUnit{pub nested_row:Option<usize>,pub para_idx:usize,pub nested_table_fragment:Option<Fragment>}
}
use model::{Paragraph,Control,Common,TablePageBreak,CellUnit,Fragment,table::{Table,Cell}};
struct ResolvedStyleSet;
#[derive(Clone,Copy)]struct Profile{stored:bool,edited:bool}
impl Profile {fn hwpx_stored_layout(self)->bool{self.stored}fn hwp5_stored_pagination_layout(self)->bool{false}fn session_edited(self)->bool{self.edited}}
struct Normalization;impl Normalization{fn table_text_reflowed(&self,t:&Table)->bool{t.dirty}}
struct Frame{tail_start_row:usize}
struct Engine{profile:std::cell::Cell<Profile>,render_normalization:std::cell::RefCell<Normalization>,dpi:f64}
fn hwpunit_to_px(h:i32,dpi:f64)->f64{f64::from(h)*dpi/7200.0}
impl Engine{
 fn saved_complete_row_frame_boundary(&self,t:&Table,_r:usize,_cut:&[usize],_s:&ResolvedStyleSet)->Option<i64>{t.inline_height}
 fn saved_plain_split_cursor_owner(&self,_:&Cell,_:&CellUnit,_:&Table,_:usize)->bool{false}
 fn row_cut_cell_order(t:&Table,_r:usize)->Vec<usize>{(0..t.cells.len()).collect()}
 fn cell_units<'a>(&self,c:&'a Cell,_t:&Table,_s:&ResolvedStyleSet)->&'a [CellUnit]{&c.units}
 fn saved_nested_tail_opening_frame(&self,_p:&Table,_c:&Cell,_h:&Paragraph,_n:Option<&Paragraph>,t:&Table,_s:&ResolvedStyleSet)->Option<Frame>{t.direct.map(|tail_start_row|Frame{tail_start_row})}
 fn nested_row_cut_owned_tail_frame_boundary(&self,t:&Table,_r:usize,cut:&[usize],_s:&ResolvedStyleSet)->Option<bool>{Some(t.boundary && cut.len()==t.cells.len())}
 fn row_cut_content_height(&self,t:&Table,_r:usize,_a:&[usize],_b:&[usize],_s:&ResolvedStyleSet)->f64{t.content}
 SOURCE_ONE
 SOURCE_TWO
}
fn engine()->Engine{Engine{profile:std::cell::Cell::new(Profile{stored:true,edited:false}),render_normalization:std::cell::RefCell::new(Normalization),dpi:7200.0}}
fn atom()->CellUnit{CellUnit{nested_row:None,para_idx:0,nested_table_fragment:None}}
fn table()->Table{
 let grandchild=Table{caption:None,common:Common{treat_as_char:false},page_break:TablePageBreak::RowBreak,cells:vec![],col_count:1,content:1.0,boundary:false,inline_height:None,direct:Some(2),dirty:false};
 Table{caption:None,common:Common{treat_as_char:false},page_break:TablePageBreak::RowBreak,col_count:1,content:50.0,boundary:true,inline_height:None,direct:None,dirty:false,
 cells:vec![Cell{height:120,col_span:1,paragraphs:vec![Paragraph{controls:vec![Control::Table(Box::new(grandchild))]},Paragraph{controls:vec![]}],
 units:vec![atom(),atom(),CellUnit{nested_row:Some(2),para_idx:0,nested_table_fragment:None}]}]}
}
fn frame(e:&Engine,t:&Table,start:&[usize],available:f64)->Option<f64>{e.stored_owned_tail_row_frame_height(t,0,start,&[2],&ResolvedStyleSet,available)}
fn wrapper(child:Table)->Table{
 Table{caption:None,common:Common{treat_as_char:false},page_break:TablePageBreak::RowBreak,col_count:1,content:90.0,boundary:true,inline_height:None,direct:None,dirty:false,
 cells:vec![Cell{height:1000,col_span:1,paragraphs:vec![Paragraph{controls:vec![Control::Table(Box::new(child))]}],
 units:vec![CellUnit{nested_row:Some(0),para_idx:0,nested_table_fragment:Some(Fragment{start_cut:vec![],end_cut:vec![2],terminal:false})},atom()]}]}
}
fn wrapped(e:&Engine,t:&Table,available:f64)->Option<f64>{e.stored_owned_tail_row_frame_height(t,0,&[],&[1],&ResolvedStyleSet,available)}
${source.includes('fn saved_complete_row_frame_boundary(') ? String.raw`
#[test]fn proven_inline_opening_caps_first_fragment_only(){
 let e=engine();
 let mut t=table(); t.boundary=false; t.inline_height=Some(120);
 assert_eq!(frame(&e,&t,&[0],80.0),Some(80.0));
 assert_eq!(frame(&e,&t,&[1],80.0),None);
}
` : ''}
#[test]fn direct_declared_minimum(){assert_eq!(frame(&engine(),&table(),&[],200.0),Some(120.0));}
#[test]fn zero_first_cursor(){assert_eq!(frame(&engine(),&table(),&[0],200.0),Some(120.0));}
#[test]fn minimum_caps_to_real_available(){assert_eq!(frame(&engine(),&table(),&[],80.0),Some(80.0));}
#[test]fn never_cap_content(){assert_eq!(frame(&engine(),&table(),&[],40.0),None);}
#[test]fn exact_content_boundary_has_no_extra(){assert_eq!(frame(&engine(),&table(),&[],50.0),None);}
#[test]fn available_zero_has_no_reservation(){assert_eq!(frame(&engine(),&table(),&[],0.0),None);}
#[test]fn invalid_available_has_no_reservation(){for a in [f64::NAN,f64::INFINITY,-1.0]{assert_eq!(frame(&engine(),&table(),&[],a),None);}}
#[test]fn declared_equal_content_unchanged(){let mut t=table();t.cells[0].height=50;assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn declared_below_content_unchanged(){let mut t=table();t.cells[0].height=40;assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn continuation_cannot_reuse_original_minimum(){assert_eq!(frame(&engine(),&table(),&[1],200.0),None);}
#[test]fn mismatched_start_vector_rejects(){assert_eq!(frame(&engine(),&table(),&[0,0],200.0),None);}
#[test]fn missing_source_boundary_rejects(){let mut t=table();t.boundary=false;assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn edited_source_rejects(){let e=engine();e.profile.set(Profile{stored:true,edited:true});assert_eq!(frame(&e,&table(),&[],200.0),None);}
#[test]fn no_stored_source_rejects(){let e=engine();e.profile.set(Profile{stored:false,edited:false});assert_eq!(frame(&e,&table(),&[],200.0),None);}
#[test]fn reflowed_source_rejects(){let mut t=table();t.dirty=true;assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn inline_parent_rejects(){let mut t=table();t.common.treat_as_char=true;assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn caption_parent_rejects(){let mut t=table();t.caption=Some(());assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn nonrowbreak_parent_rejects(){let mut t=table();t.page_break=TablePageBreak::CellBreak;assert_eq!(frame(&engine(),&t,&[],200.0),None);}
#[test]fn projection_keeps_existing_margins_once(){assert_eq!(wrapped(&engine(),&wrapper(table()),300.0),Some(160.0));}
#[test]fn projection_does_not_add_parent_declared_height(){let mut t=wrapper(table());t.cells[0].height=30000;assert_eq!(wrapped(&engine(),&t,300.0),Some(160.0));}
#[test]fn projection_caps_after_existing_owner_padding(){assert_eq!(wrapped(&engine(),&wrapper(table()),130.0),Some(130.0));}
#[test]fn projection_continuation_child_cannot_borrow(){let mut t=wrapper(table());t.cells[0].units[0].nested_table_fragment.as_mut().unwrap().start_cut=vec![1];assert_eq!(wrapped(&engine(),&t,300.0),None);}
#[test]fn projection_terminal_child_rejects(){let mut t=wrapper(table());t.cells[0].units[0].nested_table_fragment.as_mut().unwrap().terminal=true;assert_eq!(wrapped(&engine(),&t,300.0),None);}
#[test]fn projection_multiple_columns_rejects(){let mut t=wrapper(table());t.col_count=2;assert_eq!(wrapped(&engine(),&t,300.0),None);}
#[test]fn projection_merged_cell_rejects(){let mut t=wrapper(table());t.cells[0].col_span=2;assert_eq!(wrapped(&engine(),&t,300.0),None);}
#[test]fn projected_dirty_child_rejects(){let mut child=table();child.dirty=true;assert_eq!(wrapped(&engine(),&wrapper(child),300.0),None);}
`.replace('SOURCE_ONE',sourceBlock(source,'fn stored_owned_tail_row_physical_minimum(')).replace('SOURCE_TWO',sourceBlock(source,'pub(crate) fn stored_owned_tail_row_frame_height('));
await runRustTests({name:'forward-tail-physical',sourceSha256:createHash('sha256').update(source).digest('hex'),code});

