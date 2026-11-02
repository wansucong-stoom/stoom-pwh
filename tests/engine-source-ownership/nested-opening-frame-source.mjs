import {loadEngineSource, sourceBlock, runRustTests} from './harness.mjs';

const {source, sourceSha256} = await loadEngineSource();
const code = String.raw`
mod model {
    pub mod shape { #[derive(Clone,Copy,PartialEq)] pub enum VertAlign {Top,Center} }
    pub mod paragraph { pub struct LineSeg; impl LineSeg {pub const TAG_IMPLEMENTATION_PROPERTY:u32=1<<31;} }
    pub mod table { use super::shape::VertAlign; pub struct Common {pub flow_with_text:bool,pub allow_overlap:bool,pub vert_align:VertAlign} pub struct Table {pub common:Common,pub caption:Option<()>} }
}
use model::table::Table;
enum Control {Table(Box<Table>),Other}
struct Line {vertical_pos:i32,line_height:i32,segment_width:i32,tag:u32}
struct Paragraph {text:String,dirty:bool,cell_format_vpos_dirty:bool,layout_space_metrics:Vec<()>,controls:Vec<Control>,line_segs:Vec<Line>}
impl Paragraph {fn stored_text_partition_is_dirty(&self)->bool{self.dirty}}
struct ResolvedStyleSet;
struct Engine{accepted:bool}
impl Engine {
fn saved_nested_inline_owner_opening_frame_height(&self,_t:&Table,a:usize,b:usize,c:&[usize],d:&[usize],_:&ResolvedStyleSet)->Option<f64>{assert_eq!((a,b,c,d),(0,3,&[][..],&[1,2][..]));self.accepted.then_some(136.0)}
${sourceBlock(source, 'pub(crate) fn saved_nested_opening_outer_frame_height(')}
}
fn fixture()->Paragraph{Paragraph{text:String::new(),dirty:false,cell_format_vpos_dirty:false,layout_space_metrics:Vec::new(),controls:vec![Control::Table(Box::new(Table{common:model::table::Common{flow_with_text:true,allow_overlap:false,vert_align:model::shape::VertAlign::Top},caption:None}))],line_segs:vec![Line{vertical_pos:1600,line_height:1000,segment_width:0,tag:0}]}}
fn run(p:&Paragraph,accepted:bool)->Option<f64>{let Control::Table(t)=&p.controls[0]else{panic!()};Engine{accepted}.saved_nested_opening_outer_frame_height(p,t,0,3,&[],&[1,2],&ResolvedStyleSet)}
#[test]fn accepts_original_owned_empty_host(){assert_eq!(run(&fixture(),true),Some(136.0));}
#[test]fn rejects_unaccepted_physical_frame(){assert_eq!(run(&fixture(),false),None);}
#[test]fn rejects_visible_host(){let mut p=fixture();p.text="text".into();assert_eq!(run(&p,true),None);}
#[test]fn rejects_changed_text_partition(){let mut p=fixture();p.dirty=true;assert_eq!(run(&p,true),None);}
#[test]fn rejects_republished_clean_rows_with_original_tag(){let mut p=fixture();p.layout_space_metrics.push(());assert!(!p.dirty);assert_eq!(p.line_segs[0].tag,0);assert_eq!(run(&p,true),None);}
#[test]fn rejects_changed_source_positions(){let mut p=fixture();p.cell_format_vpos_dirty=true;assert_eq!(run(&p,true),None);}
#[test]fn rejects_caption(){let mut p=fixture();let Control::Table(t)=&mut p.controls[0]else{panic!()};t.caption=Some(());assert_eq!(run(&p,true),None);}
#[test]fn rejects_nonflow(){let mut p=fixture();let Control::Table(t)=&mut p.controls[0]else{panic!()};t.common.flow_with_text=false;assert_eq!(run(&p,true),None);}
#[test]fn rejects_overlap(){let mut p=fixture();let Control::Table(t)=&mut p.controls[0]else{panic!()};t.common.allow_overlap=true;assert_eq!(run(&p,true),None);}
#[test]fn rejects_non_top_anchor(){let mut p=fixture();let Control::Table(t)=&mut p.controls[0]else{panic!()};t.common.vert_align=model::shape::VertAlign::Center;assert_eq!(run(&p,true),None);}
#[test]fn rejects_another_identical_table_pointer(){let p=fixture();let q=fixture();let Control::Table(t)=&q.controls[0]else{panic!()};assert_eq!(Engine{accepted:true}.saved_nested_opening_outer_frame_height(&p,t,0,3,&[],&[1,2],&ResolvedStyleSet),None);}
#[test]fn rejects_multiple_controls(){let mut p=fixture();p.controls.push(Control::Other);assert_eq!(run(&p,true),None);}
#[test]fn rejects_no_stored_source_line(){let mut p=fixture();p.line_segs.clear();assert_eq!(run(&p,true),None);}
#[test]fn rejects_multiple_lines(){let mut p=fixture();p.line_segs.push(Line{vertical_pos:2600,line_height:1000,segment_width:0,tag:0});assert_eq!(run(&p,true),None);}
#[test]fn rejects_synthetic_source_line(){let mut p=fixture();p.line_segs[0].tag=model::paragraph::LineSeg::TAG_IMPLEMENTATION_PROPERTY;assert_eq!(run(&p,true),None);}
#[test]fn rejects_text_width(){let mut p=fixture();p.line_segs[0].segment_width=100;assert_eq!(run(&p,true),None);}
#[test]fn rejects_negative_source_origin(){let mut p=fixture();p.line_segs[0].vertical_pos=-1;assert_eq!(run(&p,true),None);}
#[test]fn rejects_zero_line_height(){let mut p=fixture();p.line_segs[0].line_height=0;assert_eq!(run(&p,true),None);}
`;
await runRustTests({name: 'nested-opening-outer-frame-source', sourceSha256, code});
