import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceBlock,runRustTests} from './harness.mjs';
const root=process.argv[2]||process.env.PWH_ENGINE_SOURCE;if(!root)throw Error('Pass candidate source root');
const source=await fs.readFile(root+'/src/renderer/layout/table_layout.rs','utf8');
const existing=await fs.readFile(new URL('./stored-nested-forward-tail-source.mjs',import.meta.url),'utf8');
const model=existing.slice(existing.indexOf('mod model {'),existing.indexOf('\nmod engine {'));
const code=model+String.raw`
use model::{control::Control,paragraph::{Paragraph,LineSeg,ColumnBreakType},table::{Table,Common,TablePageBreak,Padding},shape::*};
struct ResolvedStyleSet;
struct Engine{authentic_minimum:bool}
impl Engine {
 fn stored_owned_tail_row_physical_minimum(&self,_t:&Table,_row:usize,_start:&[usize],_end:&[usize],_s:&ResolvedStyleSet)->Option<f64>{self.authentic_minimum.then_some(100.0)}
 SOURCE
}
fn host()->Paragraph{
 let t=Table{common:Common{treat_as_char:false,flow_with_text:true,allow_overlap:false,text_wrap:TextWrap::TopAndBottom,vert_rel_to:VertRelTo::Para,vert_align:VertAlign::Top,vertical_offset:0,height:10000},caption:None,row_count:6,col_count:1,padding:Padding{top:100,bottom:100},page_break:TablePageBreak::RowBreak,cell_spacing:0,outer_margin_top:120,outer_margin_bottom:270,cells:vec![],raw:vec![],headers:vec![]};
 Paragraph{text:String::new(),dirty:false,cell_format_vpos_dirty:false,source_frame_reflowed:false,layout_space_metrics:vec![],line_segs:vec![LineSeg{vertical_pos:0,line_height:1000,line_spacing:600,segment_width:0,tag:0}],controls:vec![Control::Table(Box::new(t))],column_type:ColumnBreakType::None,para_shape_id:0,raw_break_type:0}
}
fn table(h:&Paragraph)->&Table{let Control::Table(t)=&h.controls[0]else{panic!()};t}
fn table_mut(h:&mut Paragraph)->&mut Table{let Control::Table(t)=&mut h.controls[0]else{panic!()};t}
fn run(h:&Paragraph)->bool{Engine{authentic_minimum:true}.saved_nested_owned_tail_outer_frame(h,table(h),1,3,&[1],&[2],&ResolvedStyleSet)}
fn rejects(f:impl FnOnce(&mut Paragraph)){let mut h=host();f(&mut h);assert!(!run(&h));}
#[test]fn source_owned_continuation_has_outer_frame(){assert!(run(&host()));}
#[test]fn first_opening_is_not_a_continuation(){let h=host();for start in [vec![],vec![0]]{assert!(!Engine{authentic_minimum:true}.saved_nested_owned_tail_outer_frame(&h,table(&h),0,3,&start,&[2],&ResolvedStyleSet));}}
#[test]fn same_row_nonzero_cursor_can_own_continuation(){let h=host();assert!(Engine{authentic_minimum:true}.saved_nested_owned_tail_outer_frame(&h,table(&h),0,1,&[1],&[2],&ResolvedStyleSet));}
#[test]fn missing_actual_source_minimum_rejects(){let h=host();assert!(!Engine{authentic_minimum:false}.saved_nested_owned_tail_outer_frame(&h,table(&h),1,3,&[1],&[2],&ResolvedStyleSet));}
#[test]fn another_identical_owner_rejects(){let h=host();let other=host();assert!(!Engine{authentic_minimum:true}.saved_nested_owned_tail_outer_frame(&h,table(&other),1,3,&[1],&[2],&ResolvedStyleSet));}
#[test]fn terminal_empty_end_rejects(){let h=host();assert!(!Engine{authentic_minimum:true}.saved_nested_owned_tail_outer_frame(&h,table(&h),1,3,&[1],&[],&ResolvedStyleSet));}
#[test]fn invalid_row_range_rejects(){let h=host();for(start,end)in[(3,3),(4,3),(1,7)]{assert!(!Engine{authentic_minimum:true}.saved_nested_owned_tail_outer_frame(&h,table(&h),start,end,&[1],&[2],&ResolvedStyleSet));}}
#[test]fn mixed_text_rejects(){rejects(|h|h.text="TEXT".into());}
#[test]fn extra_control_rejects(){rejects(|h|h.controls.push(Control::Other));}
#[test]fn dirty_partition_rejects(){rejects(|h|h.dirty=true);}
#[test]fn dirty_position_rejects(){rejects(|h|h.cell_format_vpos_dirty=true);}
#[test]fn reflowed_metrics_rejects(){rejects(|h|h.layout_space_metrics.push(()));}
#[test]fn synthetic_lines_rejects(){rejects(|h|h.line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY);}
#[test]fn missing_lines_rejects(){rejects(|h|h.line_segs.clear());}
#[test]fn multiple_lines_rejects(){rejects(|h|h.line_segs.push(h.line_segs[0].clone()));}
#[test]fn invalid_source_line_rejects(){rejects(|h|h.line_segs[0].vertical_pos=-1);rejects(|h|h.line_segs[0].line_height=0);rejects(|h|h.line_segs[0].segment_width=1);}
#[test]fn caption_rejects(){rejects(|h|table_mut(h).caption=Some(()));}
#[test]fn inline_owner_rejects(){rejects(|h|table_mut(h).common.treat_as_char=true);}
#[test]fn independent_position_rejects(){rejects(|h|table_mut(h).common.vertical_offset=1);rejects(|h|table_mut(h).common.vert_rel_to=VertRelTo::Page);rejects(|h|table_mut(h).common.vert_align=VertAlign::Center);}
#[test]fn nonflow_overlap_rejects(){rejects(|h|table_mut(h).common.flow_with_text=false);rejects(|h|table_mut(h).common.allow_overlap=true);rejects(|h|table_mut(h).common.text_wrap=TextWrap::Square);}
#[test]fn history_host_cannot_borrow_margin(){rejects(|h|h.source_frame_reflowed=true);}

`;
await runRustTests({name:'forward-tail-margin-owner',sourceSha256:createHash('sha256').update(source).digest('hex'),code:code.replace(' SOURCE\n',sourceBlock(source,'pub(crate) fn saved_nested_owned_tail_outer_frame(')+'\n')});
