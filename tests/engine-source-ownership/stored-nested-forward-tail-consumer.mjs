import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceBlock,runRustTests} from './harness.mjs';
const root=process.argv[2]||process.env.PWH_ENGINE_SOURCE;if(!root)throw Error('Pass candidate source root');
const source=await fs.readFile(root+'/src/renderer/layout/table_layout.rs','utf8');
const code=String.raw`
mod model {
 pub mod table {pub struct Table{pub cols:usize}pub struct Cell{pub paragraphs:Vec<super::Paragraph>}}
 pub struct Paragraph{pub controls:Vec<Control>}
 pub enum Control{Table(Box<table::Table>),Other}
}
use model::{Paragraph,Control,table::{Table,Cell}};
struct ResolvedStyleSet;
struct Fragment{start_cut:Vec<usize>}
struct CellUnit{hard_break_before:bool,stored_frame_break_before:bool,mixed_nested_fragment:bool,non_inline_control_range:Option<()>,nested_row:Option<usize>,para_idx:usize,nested_table_fragment:Option<Fragment>}
struct Frame{tail_start_row:usize}
struct Engine{direct:Option<usize>,recursive:Option<bool>,direct_calls:std::cell::Cell<usize>,recursive_calls:std::cell::Cell<usize>}
impl Engine{
 fn row_cut_cell_order(table:&Table,_row:usize)->Vec<usize>{(0..table.cols).collect()}
 fn saved_nested_tail_opening_frame(&self,_p:&Table,_c:&Cell,_h:&Paragraph,_n:Option<&Paragraph>,_t:&Table,_s:&ResolvedStyleSet)->Option<Frame>{self.direct_calls.set(self.direct_calls.get()+1);self.direct.map(|tail_start_row|Frame{tail_start_row})}
 fn nested_row_cut_owned_tail_frame_boundary(&self,_t:&Table,_r:usize,_cut:&[usize],_s:&ResolvedStyleSet)->Option<bool>{self.recursive_calls.set(self.recursive_calls.get()+1);self.recursive}
 ${sourceBlock(source,'fn cell_unit_starts_owned_nested_tail_frame(')}
}
fn engine()->Engine{Engine{direct:Some(2),recursive:Some(false),direct_calls:std::cell::Cell::new(0),recursive_calls:std::cell::Cell::new(0)}}
fn owner()->Cell{Cell{paragraphs:vec![Paragraph{controls:vec![Control::Table(Box::new(Table{cols:3}))]},Paragraph{controls:vec![]}]}}
fn unit(cut:Option<Vec<usize>>)->CellUnit{CellUnit{hard_break_before:true,stored_frame_break_before:true,mixed_nested_fragment:false,non_inline_control_range:None,nested_row:Some(2),para_idx:0,nested_table_fragment:cut.map(|start_cut|Fragment{start_cut})}}
fn run(e:&Engine,u:&CellUnit)->bool{e.cell_unit_starts_owned_nested_tail_frame(&Table{cols:1},&owner(),u,&ResolvedStyleSet)}
#[test]fn legacy_whole_row_owner_still_accepts(){assert!(run(&engine(),&unit(None)));}
#[test]fn empty_projected_start_keeps_direct_whole_row_owner(){let e=engine();assert!(run(&e,&unit(Some(vec![]))));assert_eq!(e.recursive_calls.get(),0);}
#[test]fn complete_zero_projected_start_keeps_direct_owner(){let e=engine();assert!(run(&e,&unit(Some(vec![0,0,0]))));assert_eq!(e.recursive_calls.get(),0);}
#[test]fn nonzero_cursor_cannot_borrow_direct_owner(){let e=engine();assert!(!run(&e,&unit(Some(vec![0,1,0]))));assert_eq!(e.direct_calls.get(),0);}
#[test]fn incomplete_zero_cursor_cannot_borrow_direct_owner(){assert!(!run(&engine(),&unit(Some(vec![0,0]))));}
#[test]fn excessive_zero_cursor_cannot_borrow_direct_owner(){assert!(!run(&engine(),&unit(Some(vec![0,0,0,0]))));}
#[test]fn later_cursor_keeps_independent_recursive_owner(){let mut e=engine();e.recursive=Some(true);assert!(run(&e,&unit(Some(vec![0,1,0]))));assert_eq!(e.direct_calls.get(),0);}
#[test]fn zero_cursor_can_fall_back_to_independent_recursive_owner(){let mut e=engine();e.direct=None;e.recursive=Some(true);assert!(run(&e,&unit(Some(vec![0,0,0]))));}
#[test]fn wrong_direct_row_cannot_be_used(){let mut e=engine();e.direct=Some(1);assert!(!run(&e,&unit(Some(vec![0,0,0]))));}
#[test]fn absent_direct_witness_does_not_accept_zero_cursor(){let mut e=engine();e.direct=None;assert!(!run(&e,&unit(Some(vec![0,0,0]))));}
#[test]fn unknown_recursive_witness_is_not_authority(){let mut e=engine();e.recursive=None;assert!(!run(&e,&unit(Some(vec![1,0,0]))));}
#[test]fn missing_hard_break_rejects(){let mut u=unit(None);u.hard_break_before=false;assert!(!run(&engine(),&u));}
#[test]fn missing_stored_boundary_rejects(){let mut u=unit(None);u.stored_frame_break_before=false;assert!(!run(&engine(),&u));}
#[test]fn mixed_fragment_rejects(){let mut u=unit(None);u.mixed_nested_fragment=true;assert!(!run(&engine(),&u));}
#[test]fn noninline_other_control_rejects(){let mut u=unit(None);u.non_inline_control_range=Some(());assert!(!run(&engine(),&u));}
#[test]fn missing_nested_row_rejects(){let mut u=unit(None);u.nested_row=None;assert!(!run(&engine(),&u));}
#[test]fn unknown_host_rejects(){let mut u=unit(None);u.para_idx=4;assert!(!run(&engine(),&u));}
#[test]fn ambiguous_host_owner_rejects(){let mut c=owner();c.paragraphs[0].controls.push(Control::Other);assert!(!engine().cell_unit_starts_owned_nested_tail_frame(&Table{cols:1},&c,&unit(None),&ResolvedStyleSet));}
`;
await runRustTests({name:'forward-tail-consumer',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
