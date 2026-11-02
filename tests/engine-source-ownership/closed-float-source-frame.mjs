import {loadEngineSource,sourceBlock,runRustTests} from './harness.mjs';
const {source,sourceSha256}=await loadEngineSource();
const code=`
mod model {
 pub mod paragraph {
  #[derive(Clone)]pub struct LineSeg {pub vertical_pos:i32,pub line_height:i32,pub segment_width:i32,pub line_spacing:i32,pub tag:u32}
  impl LineSeg{pub const TAG_IMPLEMENTATION_PROPERTY:u32=0x80000000;}
  #[derive(Clone)]pub struct Paragraph {pub text:String,pub controls:Vec<super::control::Control>,pub line_segs:Vec<LineSeg>,pub dirty:bool,pub cell_format_vpos_dirty:bool,pub layout_space_metrics:Vec<u8>}
  impl Paragraph {pub fn stored_text_partition_is_dirty(&self)->bool{self.dirty}}
 }
 pub mod shape{
  #[derive(Clone,PartialEq)]pub enum TextWrap{TopAndBottom,Square}
  #[derive(Clone,PartialEq)]pub enum VertRelTo{Para,Paper}
  #[derive(Clone,PartialEq)]pub enum VertAlign{Top,Bottom}
 }
 pub mod table {
  #[derive(Clone)]pub struct Common {pub treat_as_char:bool,pub flow_with_text:bool,pub allow_overlap:bool,pub text_wrap:super::shape::TextWrap,pub vert_rel_to:super::shape::VertRelTo,pub vert_align:super::shape::VertAlign,pub height:u32,pub vertical_offset:u32}
  #[derive(Clone)]pub struct Cell{pub dirty_flag:bool,pub paragraphs:Vec<super::paragraph::Paragraph>}
  #[derive(Clone)]pub struct Table {pub common:Common,pub caption:Option<u8>,pub cells:Vec<Cell>,pub outer_margin_top:u16,pub outer_margin_bottom:u16}
 }
 pub mod control {#[derive(Clone)]pub enum Control{Table(Box<super::table::Table>),Other}}
}
use model::paragraph::{Paragraph,LineSeg};use model::control::Control;
use model::table::{Table,Common,Cell};use model::shape::{TextWrap,VertRelTo,VertAlign};
fn signed_hwpunit(value:u32)->i32{value as i32}
mod renderer {pub mod float_placement {
 #[derive(Clone,Copy,Debug)]pub enum ParagraphFloatFlow {Exclusion}
 #[derive(Clone,Copy,Debug)]pub struct ParagraphFloatPlacement {pub flow:ParagraphFloatFlow,pub anchor_y:f64,pub stored_host_origin:Option<f64>,pub stored_successor_line_origin:Option<f64>,pub table_left:Option<f64>,pub table_top:f64,pub occupied_bottom:f64}
}}
#[derive(Clone,Copy,Debug)]
${sourceBlock(source,'struct StoredLeadingHostFloatFrame {')}
${sourceBlock(source,'impl StoredLeadingHostFloatFrame {')}
${sourceBlock(source,'fn stored_leading_host_float_frame(')}
#[derive(Clone)]struct ComposedTextRun {text:String}
#[derive(Clone)]struct ComposedLine {runs:Vec<ComposedTextRun>,line_height:i32,segment_width:i32,line_spacing:i32,char_start:usize}
${sourceBlock(source,'fn stored_float_frame_composed_line_agrees(')}
${sourceBlock(source,'fn stored_float_frame_fits_original_body(')}
${sourceBlock(source,'fn stored_float_frame_owner_is_original(')}
${sourceBlock(source,'fn stored_float_frame_geometry_agrees(')}
${sourceBlock(source,'fn stored_float_anchor_has_leading_host_line(')}
fn line(vpos:i32)->LineSeg{LineSeg{vertical_pos:vpos,line_height:1100,segment_width:18000,line_spacing:600,tag:0}}
fn paragraph(vpos:i32)->Paragraph{Paragraph{text:"VISIBLE".into(),controls:vec![],line_segs:vec![line(vpos)],dirty:false,cell_format_vpos_dirty:false,layout_space_metrics:vec![]}}
fn subject()->(Paragraph,Paragraph){let t=Table{common:Common{treat_as_char:false,flow_with_text:true,allow_overlap:false,text_wrap:TextWrap::TopAndBottom,vert_rel_to:VertRelTo::Para,vert_align:VertAlign::Top,height:4800,vertical_offset:1200},caption:None,cells:vec![Cell{dirty_flag:false,paragraphs:vec![paragraph(0)]}],outer_margin_top:0,outer_margin_bottom:0};let mut p=paragraph(1100);p.controls.push(Control::Table(Box::new(t)));(p,paragraph(7100))}
fn table(p:&Paragraph)->&Table{let Control::Table(t)=&p.controls[0]else{panic!()};t}
fn table_mut(p:&mut Paragraph)->&mut Table{let Control::Table(t)=&mut p.controls[0]else{panic!()};t}
fn prove(p:&Paragraph,n:&Paragraph)->bool{stored_float_anchor_has_leading_host_line(p,Some(n),table(p),true,false,false)}
#[test]fn an_original_successor_closes_a_float_below_its_host_line(){let(p,n)=subject();assert!(prove(&p,&n));}
#[test]fn object_margins_belong_to_the_closed_frame(){let(mut p,mut n)=subject();let t=table_mut(&mut p);t.outer_margin_top=141;t.outer_margin_bottom=141;n.line_segs[0].vertical_pos+=282;assert!(prove(&p,&n));n.line_segs[0].vertical_pos-=141;assert!(!prove(&p,&n));}
#[test]fn closure_tolerance_is_two_original_units_not_pixel_slack(){let(p,n)=subject();for delta in [-2,-1,0,1,2]{let mut next=n.clone();next.line_segs[0].vertical_pos+=delta;assert!(prove(&p,&next));}for delta in [-3,3]{let mut next=n.clone();next.line_segs[0].vertical_pos+=delta;assert!(!prove(&p,&next));}}
#[test]fn a_positive_offset_does_not_reorder_an_actual_table_first_source(){let(mut p,mut n)=subject();p.line_segs[0].vertical_pos=7100;n.line_segs[0].vertical_pos=8200;assert!(!prove(&p,&n));}
#[test]fn the_existing_zero_offset_table_before_text_fixture_keeps_projection(){let(mut p,mut n)=subject();table_mut(&mut p).common.vertical_offset=0;p.line_segs[0].vertical_pos=5900;n.line_segs[0].vertical_pos=7000;assert!(!prove(&p,&n));}
#[test]fn a_closed_frame_that_overlaps_the_visible_host_line_is_not_proof(){let(mut p,mut n)=subject();table_mut(&mut p).common.vertical_offset=500;n.line_segs[0].vertical_pos=6400;assert!(!prove(&p,&n));}
#[test]fn a_table_touching_the_visible_line_bottom_can_keep_its_anchor(){let(mut p,mut n)=subject();table_mut(&mut p).common.vertical_offset=1100;n.line_segs[0].vertical_pos=7000;assert!(prove(&p,&n));}
#[test]fn missing_or_nonoriginal_successor_cannot_close_a_frame(){let(p,mut n)=subject();assert!(!stored_float_anchor_has_leading_host_line(&p,None,table(&p),true,false,false));n.line_segs.clear();assert!(!prove(&p,&n));}
#[test]fn multiline_hosts_do_not_create_an_invented_paragraph_origin(){let(mut p,n)=subject();p.line_segs.push(line(2700));assert!(!prove(&p,&n));}
#[test]fn dirty_and_reflowed_inputs_keep_the_existing_projection_contract(){let(mut p,mut n)=subject();p.dirty=true;assert!(!prove(&p,&n));p.dirty=false;p.cell_format_vpos_dirty=true;assert!(!prove(&p,&n));p.cell_format_vpos_dirty=false;n.dirty=true;assert!(!prove(&p,&n));n.dirty=false;n.cell_format_vpos_dirty=true;assert!(!prove(&p,&n));n.cell_format_vpos_dirty=false;assert!(!stored_float_anchor_has_leading_host_line(&p,Some(&n),table(&p),true,true,false));assert!(!stored_float_anchor_has_leading_host_line(&p,Some(&n),table(&p),true,false,true));assert!(!stored_float_anchor_has_leading_host_line(&p,Some(&n),table(&p),false,false,false));}
#[test]fn synthetic_host_and_successor_lines_are_not_geometry_evidence(){let(mut p,mut n)=subject();p.line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;assert!(!prove(&p,&n));p.line_segs[0].tag=0;n.line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;assert!(!prove(&p,&n));}
#[test]fn dirty_or_synthetic_table_content_cannot_authenticate_saved_height(){let(mut p,n)=subject();table_mut(&mut p).cells[0].dirty_flag=true;assert!(!prove(&p,&n));table_mut(&mut p).cells[0].dirty_flag=false;table_mut(&mut p).cells[0].paragraphs[0].dirty=true;assert!(!prove(&p,&n));table_mut(&mut p).cells[0].paragraphs[0].dirty=false;table_mut(&mut p).cells[0].paragraphs[0].line_segs[0].tag=LineSeg::TAG_IMPLEMENTATION_PROPERTY;assert!(!prove(&p,&n));}
#[test]fn invalid_source_lines_never_define_a_frame_origin(){for value in [-1,0]{let(mut p,n)=subject();if value<0{p.line_segs[0].vertical_pos=value;}else{p.line_segs[0].line_height=0;}assert!(!prove(&p,&n));}let(mut p,n)=subject();p.line_segs[0].segment_width=0;assert!(!prove(&p,&n));}
#[test]fn wrong_reference_alignment_or_wrap_does_not_change_source_order(){let(mut p,n)=subject();table_mut(&mut p).common.vert_rel_to=VertRelTo::Paper;assert!(!prove(&p,&n));table_mut(&mut p).common.vert_rel_to=VertRelTo::Para;table_mut(&mut p).common.vert_align=VertAlign::Bottom;assert!(!prove(&p,&n));table_mut(&mut p).common.vert_align=VertAlign::Top;table_mut(&mut p).common.text_wrap=TextWrap::Square;assert!(!prove(&p,&n));}
#[test]fn caption_inline_overlap_and_nonflow_objects_keep_their_existing_paths(){let(mut p,n)=subject();table_mut(&mut p).caption=Some(1);assert!(!prove(&p,&n));table_mut(&mut p).caption=None;table_mut(&mut p).common.treat_as_char=true;assert!(!prove(&p,&n));table_mut(&mut p).common.treat_as_char=false;table_mut(&mut p).common.allow_overlap=true;assert!(!prove(&p,&n));table_mut(&mut p).common.allow_overlap=false;table_mut(&mut p).common.flow_with_text=false;assert!(!prove(&p,&n));}
#[test]fn zero_negative_and_invalid_declared_dimensions_are_rejected(){let(mut p,n)=subject();for value in [0u32,(-1i32)as u32]{table_mut(&mut p).common.height=value;assert!(!prove(&p,&n));}table_mut(&mut p).common.height=4800;table_mut(&mut p).common.vertical_offset=(-1200i32)as u32;assert!(!prove(&p,&n));}
#[test]fn another_object_or_successor_anchor_cannot_supply_the_source_frame(){let(mut p,mut n)=subject();p.controls.push(Control::Other);assert!(!prove(&p,&n));p.controls.pop();n.controls.push(Control::Other);assert!(!prove(&p,&n));}
#[test]fn table_identity_is_the_owned_control_not_a_matching_clone(){let(p,n)=subject();let detached=table(&p).clone();assert!(!stored_float_anchor_has_leading_host_line(&p,Some(&n),&detached,true,false,false));}
#[test]fn empty_visible_text_and_negative_successor_origin_reject_geometry_proof(){let(mut p,mut n)=subject();p.text=" ".into();assert!(!prove(&p,&n));p.text="VISIBLE".into();n.text="".into();assert!(!prove(&p,&n));n.text="VISIBLE".into();n.line_segs[0].vertical_pos=-1;assert!(!prove(&p,&n));}

fn physical_subject()->(Paragraph,Paragraph){let(mut p,mut n)=subject();p.line_segs[0].vertical_pos=1800;p.line_segs[0].line_height=1200;let t=table_mut(&mut p);t.common.vertical_offset=1400;t.common.height=5000;t.outer_margin_top=100;t.outer_margin_bottom=200;n.line_segs[0].vertical_pos=8500;(p,n)}
#[test]fn one_source_witness_reserves_the_exact_frame_for_measure_and_paint(){let(p,n)=physical_subject();let source=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();assert_eq!(source.table_top_hu,1500);assert_eq!(source.occupied_bottom_hu,6700);let frame=source.resolve(200.0,96.0).unwrap();let host_advance=frame.table_top-200.0;let table_advance=frame.occupied_bottom-frame.table_top;assert!((host_advance+table_advance-6700.0/75.0).abs()<1e-10);assert!((frame.table_top-220.0).abs()<1e-10);assert!((table_advance-5200.0/75.0).abs()<1e-10);}
#[test]fn trailing_line_spacing_does_not_move_a_source_closed_object(){for spacing in [0,100,233,600,4000]{let(mut p,n)=physical_subject();p.line_segs[0].line_spacing=spacing;let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap().resolve(0.0,96.0).unwrap();assert!((frame.table_top-20.0).abs()<1e-10);assert!((frame.occupied_bottom-(6700.0/75.0)).abs()<1e-10);assert!(frame.table_top>=1200.0/75.0);}}
#[test]fn only_unused_trailing_spacing_may_be_reclaimed(){let(mut p,mut n)=physical_subject();table_mut(&mut p).common.vertical_offset=1000;n.line_segs[0].vertical_pos=8100;assert!(!prove(&p,&n));table_mut(&mut p).common.vertical_offset=1100;n.line_segs[0].vertical_pos=8200;let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();assert_eq!(frame.table_top_hu,1200);}
#[test]fn negative_trailing_spacing_is_not_authenticated(){let(mut p,n)=physical_subject();p.line_segs[0].line_spacing=-1;assert!(!prove(&p,&n));}
#[test]fn resolve_rejects_invalid_runtime_origins_and_scale(){let(p,n)=physical_subject();let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();for dpi in [0.0,-1.0,f64::NAN,f64::INFINITY]{assert!(frame.resolve(0.0,dpi).is_none());}for origin in [f64::NAN,f64::INFINITY,f64::NEG_INFINITY]{assert!(frame.resolve(origin,96.0).is_none());}}
#[test]fn source_frame_scales_once_and_never_uses_a_rendered_successor(){let(p,n)=physical_subject();let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();for dpi in [72.0,96.0,150.0,300.0]{let resolved=frame.resolve(50.0,dpi).unwrap();assert!((resolved.table_top-50.0-1500.0*dpi/7200.0).abs()<1e-10);assert!((resolved.occupied_bottom-50.0-6700.0*dpi/7200.0).abs()<1e-10);assert!(resolved.stored_successor_line_origin.is_none());}}

#[test]fn measurement_must_still_match_the_declared_physical_body(){let body=5000.0/75.0;assert!(stored_float_frame_geometry_agrees(5000,body,96.0,[0.0;3]));assert!(stored_float_frame_geometry_agrees(5000,body+1.0/75.0,96.0,[0.0;3]));assert!(!stored_float_frame_geometry_agrees(5000,body+3.0/75.0,96.0,[0.0;3]));for bad in [f64::NAN,f64::INFINITY,0.0,-1.0]{assert!(!stored_float_frame_geometry_agrees(5000,bad,96.0,[0.0;3]));}}
#[test]fn paragraph_margins_require_another_explicit_source_contract(){let body=5000.0/75.0;for index in 0..3{for value in [1.0,-1.0,f64::NAN,f64::INFINITY]{let mut spacing=[0.0;3];spacing[index]=value;assert!(!stored_float_frame_geometry_agrees(5000,body,96.0,spacing));}}}

fn composed(p:&Paragraph)->ComposedLine{let l=&p.line_segs[0];ComposedLine{runs:vec![ComposedTextRun{text:p.text.clone()}],line_height:l.line_height,segment_width:l.segment_width,line_spacing:l.line_spacing,char_start:0}}
#[test]fn actual_width_recomposition_must_keep_one_original_visible_line(){let(p,n)=physical_subject();let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();let line=composed(&p);assert!(stored_float_frame_composed_line_agrees(&p,&[line.clone()],frame));assert!(!stored_float_frame_composed_line_agrees(&p,&[],frame));assert!(!stored_float_frame_composed_line_agrees(&p,&[line.clone(),line.clone()],frame));for field in 0..5{let mut changed=line.clone();match field{0=>changed.line_height+=1,1=>changed.segment_width-=1,2=>changed.char_start=1,3=>changed.line_spacing+=1,_=>changed.runs[0].text=" ".into()};assert!(!stored_float_frame_composed_line_agrees(&p,&[changed],frame));}}
#[test]fn composed_visible_height_cannot_be_hidden_inside_a_shorter_frame(){let(mut p,n)=physical_subject();let mut frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();let line=composed(&p);frame.table_top_hu=999;assert!(!stored_float_frame_composed_line_agrees(&p,&[line],frame));p.line_segs[0].line_height=0;let line=composed(&p);assert!(!stored_float_frame_composed_line_agrees(&p,&[line],frame));}

#[test]fn original_source_origin_and_whole_occupied_end_must_fit_the_physical_body(){let(p,n)=subject();let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();for page in [2500,4000,6000]{assert!(!stored_float_frame_fits_original_body(&p,frame,page as f64/75.0,96.0));}for page in [7100,7200,9300]{assert!(stored_float_frame_fits_original_body(&p,frame,page as f64/75.0,96.0));}assert!(!stored_float_frame_fits_original_body(&p,frame,6000.0/75.0,96.0),"The object alone fits, but its real source origin and preceding offset do not");}
#[test]fn missing_or_invalid_physical_body_is_not_a_source_fit_estimate(){let(p,n)=subject();let frame=stored_leading_host_float_frame(&p,Some(&n),table(&p),true,false,false).unwrap();for height in [0.0,-1.0,f64::NAN,f64::INFINITY]{assert!(!stored_float_frame_fits_original_body(&p,frame,height,96.0));}}

#[test]fn current_composition_metrics_reject_unchanged_source_tags(){let(mut p,mut n)=subject();assert!(stored_float_frame_owner_is_original(&p));p.layout_space_metrics.push(1);assert!(!stored_float_frame_owner_is_original(&p));p.layout_space_metrics.clear();assert!(stored_float_frame_owner_is_original(&p));n.layout_space_metrics.push(1);assert!(!stored_float_frame_owner_is_original(&n));}
#[test]fn a_deep_edited_owner_cannot_authenticate_the_same_measured_height(){let(mut p,_)=subject();table_mut(&mut p).cells[0].paragraphs[0].layout_space_metrics.push(1);assert!(!stored_float_frame_owner_is_original(&p));table_mut(&mut p).cells[0].paragraphs[0].layout_space_metrics.clear();let(mut deep,_)=subject();deep.layout_space_metrics.push(1);let common=table(&p).common.clone();table_mut(&mut p).cells[0].paragraphs[0].controls.push(Control::Table(Box::new(Table{common,caption:None,cells:vec![Cell{dirty_flag:false,paragraphs:vec![deep]}],outer_margin_top:0,outer_margin_bottom:0})));assert!(!stored_float_frame_owner_is_original(&p));}
`;
await runRustTests({name:'closed-float-source-frame',sourceSha256,code});
