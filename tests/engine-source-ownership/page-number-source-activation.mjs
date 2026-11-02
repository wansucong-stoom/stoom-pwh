import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {sourceBlock,runRustTests} from './harness.mjs';
const input=process.argv[2]||process.env.PWH_ENGINE_SOURCE;
if(!input)throw Error('Pass the candidate engine source root or set PWH_ENGINE_SOURCE.');
const source=await fs.readFile(path.join(path.resolve(input),'src/renderer/page_number.rs'),'utf8');
const unchangedContracts={
  "fn collect_control(": "5b56bbcf9ddadd96c1790877376aeed603558a21d425dff431975814ab56fcf9",
  "fn control_page(": "5cc68e50361abe1a1b99e21f2be4ad9b22cf91571681ef856871040bd8038790",
  "pub fn assign(": "c43ff6cabf81f9125301277e58c2230ce917523ef3ef071ba5f6685e18a898de",
  "pub fn should_hide_page_number(": "65102e9ec4c9ac9f2b5524182c1aefcca2809b31398bc693997170eea06d9734"
};
for(const [marker,expected]of Object.entries(unchangedContracts)){
 assert.equal(createHash('sha256').update(sourceBlock(source,marker)).digest('hex'),expected,'Existing resolver/number/hide contract must remain unchanged: '+marker);
}
const adapters=`
mod model {
 pub mod control {
  #[derive(Clone,Debug,PartialEq)]pub struct PageNumberPos{pub position:u8}
  #[derive(Clone,Debug,PartialEq)]pub struct PageHide{pub hide_page_number:bool}
  #[derive(Clone,Debug,PartialEq)]pub enum AutoNumberType{Page,Other}
  #[derive(Clone,Debug)]pub struct NewNumber{pub number_type:AutoNumberType,pub number:u16}
  pub struct Cell{pub paragraphs:Vec<super::paragraph::Paragraph>}
  pub struct Common{pub treat_as_char:bool,pub flow_with_text:bool,pub text_wrap:super::shape::TextWrap}
  pub struct Table{pub cells:Vec<Cell>,pub common:Common}
  pub enum Control{PageNumberPos(PageNumberPos),PageHide(PageHide),NewNumber(NewNumber),Table(Table),Other}
 }
 pub mod shape{#[derive(PartialEq)]pub enum TextWrap{TopAndBottom,Square}}
 pub mod paragraph {
  #[derive(Default)]pub struct Paragraph{pub text:String,pub controls:Vec<super::control::Control>,pub char_offsets:Vec<u32>,pub char_count:u32,pub line_segs:Vec<u32>}
  impl Paragraph{pub fn control_utf16_positions(&self)->Vec<u32>{(0..self.controls.len()).map(|i|i as u32*8).collect()}pub fn line_seg_text_start(&self,line:usize)->u32{self.line_segs[line]}}
 }
}
mod renderer{pub mod pagination{
 #[derive(Debug)]pub enum PageItem{FullParagraph{para_index:usize},PartialParagraph{para_index:usize,start_line:usize,end_line:usize},Table{para_index:usize,control_index:usize},PartialTable{para_index:usize,control_index:usize,is_continuation:bool},Shape{para_index:usize,control_index:usize},EndnoteSeparator{}}
 impl PageItem{pub fn para_index(&self)->usize{match self{Self::FullParagraph{para_index}|Self::PartialParagraph{para_index,..}|Self::Table{para_index,..}|Self::PartialTable{para_index,..}|Self::Shape{para_index,..}=>*para_index,_=>usize::MAX}}}
 pub struct ColumnContent{pub items:Vec<PageItem>}
 #[derive(Default)]pub struct PageContent{pub column_contents:Vec<ColumnContent>,pub page_number_pos:Option<crate::model::control::PageNumberPos>,pub page_hide:Option<crate::model::control::PageHide>}
}}
`;
const production=source.slice(0,source.indexOf('#[cfg(test)]')).replace(/^\/\/!.*\r?\n/gm,'');
const tests=`
use model::control::{Control,PageNumberPos,PageHide,NewNumber,AutoNumberType};
use model::paragraph::Paragraph;
use renderer::pagination::ColumnContent;
fn block()->Control{Control::Table(model::control::Table{cells:vec![],common:model::control::Common{treat_as_char:false,flow_with_text:true,text_wrap:model::shape::TextWrap::TopAndBottom}})}
fn empty()->Paragraph{Paragraph{controls:(0..8).map(|_|block()).collect(),line_segs:vec![0],..Default::default()}}
fn position(value:u8)->Control{Control::PageNumberPos(PageNumberPos{position:value})}
fn restart(number:u16)->Control{Control::NewNumber(NewNumber{number_type:AutoNumberType::Page,number})}
fn para(controls:Vec<Control>)->Paragraph{Paragraph{char_count:controls.len()as u32*8,controls,line_segs:vec![0],..Default::default()}}
fn table(ci:usize,continuation:bool)->PageItem{PageItem::PartialTable{para_index:0,control_index:ci,is_continuation:continuation}}
fn page(items:Vec<PageItem>)->PageContent{PageContent{column_contents:vec![ColumnContent{items}],..Default::default()}}
fn prior()->Option<PageNumberPos>{Some(PageNumberPos{position:9})}
fn events(positions:Vec<(usize,u8)>,new_numbers:Vec<(usize,u16)>)->PageControlEvents{PageControlEvents{number_positions:positions.into_iter().map(|(page,position)|(page,PageNumberPos{position})).collect(),new_numbers,..Default::default()}}
#[test]fn between_objects_uses_the_preceding_objects_final_fragment(){let a=table(0,false);let ac=table(0,true);let b=table(2,false);let bc=table(2,true);assert_eq!(page_number_position_page(&empty(),1,&[(0,&a),(1,&ac),(2,&b),(3,&bc)]),Some(1));}
#[test]fn before_first_object_uses_first_page(){let a=table(1,false);let b=table(1,true);assert_eq!(page_number_position_page(&empty(),0,&[(0,&a),(1,&b)]),Some(0));}
#[test]fn trailing_position_uses_previous_objects_final_fragment(){let a=table(0,false);let b=table(0,true);assert_eq!(page_number_position_page(&empty(),1,&[(0,&a),(1,&b)]),Some(1));}
#[test]fn shared_physical_page_does_not_delay_activation(){let a=table(0,false);let ac=table(0,true);let b=table(2,false);assert_eq!(page_number_position_page(&empty(),1,&[(0,&a),(1,&ac),(1,&b)]),Some(1));}
#[test]fn text_paragraphs_keep_existing_line_resolver(){let p=Paragraph{text:"source text".into(),controls:vec![Control::Other,position(2)],line_segs:vec![0,8],..Default::default()};let a=PageItem::PartialParagraph{para_index:0,start_line:0,end_line:1};let b=PageItem::PartialParagraph{para_index:0,start_line:1,end_line:2};assert_eq!(page_number_position_page(&p,1,&[(0,&a),(2,&b)]),Some(2));}
#[test]fn no_owned_item_has_no_activation_page(){assert_eq!(page_number_position_page(&empty(),1,&[]),None);}
#[test]fn unplaced_control_is_recorded_but_does_not_activate(){let ps=vec![para(vec![position(2)]),empty()];let pages=vec![page(vec![PageItem::FullParagraph{para_index:1}])];let e=PageControlEvents::collect(&pages,&ps);assert_eq!(e.number_positions[0].0,usize::MAX);assert!(e.number_position_at(0,&prior()).is_none());}
#[test]fn inactive_prefix_and_all_later_continuations(){let e=events(vec![(2,7)],vec![]);assert!(e.number_position_at(0,&None).is_none());assert!(e.number_position_at(1,&None).is_none());for page in 2..8{assert_eq!(e.number_position_at(page,&None).unwrap().position,7);}}
#[test]fn same_page_last_source_event_wins(){let e=events(vec![(0,1),(2,2),(2,3),(usize::MAX,4)],vec![]);assert_eq!(e.number_position_at(1,&None).unwrap().position,1);assert_eq!(e.number_position_at(2,&None).unwrap().position,3);assert_eq!(e.number_position_at(5,&None).unwrap().position,3);}
#[test]fn fallback_only_for_no_source_event(){assert_eq!(events(vec![],vec![]).number_position_at(0,&prior()).unwrap().position,9);assert!(events(vec![(usize::MAX,2)],vec![]).number_position_at(0,&prior()).is_none());}
#[test]fn preceding_section_format_survives_only_until_own_event(){let ps=vec![para(vec![block(),position(2),block()])];let mut pages=vec![page(vec![table(0,false)]),page(vec![table(0,true)]),page(vec![table(2,false)]),page(vec![table(2,true)])];let e=PageControlEvents::collect(&pages,&ps);for(i,p)in pages.iter_mut().enumerate(){p.page_number_pos=e.number_position_at(i,&None);}inherit_number_position_prefix(&mut pages,&ps,&prior());assert_eq!(pages.iter().map(|p|p.page_number_pos.as_ref().unwrap().position).collect::<Vec<_>>(),vec![9,2,2,2]);}
#[test]fn unknown_own_event_does_not_remove_previous_section_format(){let ps=vec![para(vec![position(2)]),empty()];let mut pages=vec![page(vec![PageItem::FullParagraph{para_index:1}])];inherit_number_position_prefix(&mut pages,&ps,&prior());assert_eq!(pages[0].page_number_pos.as_ref().unwrap().position,9);}
#[test]fn no_previous_section_format_keeps_prefix_blank(){let ps=vec![para(vec![block(),position(2),block()])];let mut pages=vec![page(vec![table(0,false)]),page(vec![table(2,false)])];inherit_number_position_prefix(&mut pages,&ps,&None);assert!(pages.iter().all(|p|p.page_number_pos.is_none()));}
#[test]fn new_number_still_hides_before_first_restart_and_resets_once(){let mut a=PageNumberAssigner::new_for_pages(&[(2,10)],1);let p=page(vec![]);assert_eq!(a.assign(&p),1);assert!(a.should_hide_page_number());assert_eq!(a.assign(&p),2);assert!(a.should_hide_page_number());assert_eq!(a.assign(&p),10);assert!(!a.should_hide_page_number());assert!(a.last_restarted());assert_eq!(a.assign(&p),11);assert!(!a.last_restarted());let e=events(vec![(3,2)],vec![(2,10)]);assert!(!e.should_inherit_number_position(0));assert!(!e.should_inherit_number_position(1));assert!(e.should_inherit_number_position(2));assert!(!e.should_inherit_number_position(3));}
#[test]fn unplaced_new_number_preserves_existing_hide_contract(){let e=events(vec![],vec![(usize::MAX,2)]);for i in 0..5{assert!(!e.should_inherit_number_position(i));}}
#[test]fn hide_and_restart_source_mapping_unchanged_by_position_event(){let ps=vec![para(vec![block(),position(2),Control::PageHide(PageHide{hide_page_number:true}),restart(5),block()])];let pages=vec![page(vec![table(0,false)]),page(vec![table(0,true)]),page(vec![table(4,false)])];let e=PageControlEvents::collect(&pages,&ps);assert_eq!(e.number_positions[0].0,1);assert_eq!(e.hides,vec![(0,PageHide{hide_page_number:true})]);assert_eq!(e.new_numbers,vec![(0,5)]);}
#[test]fn multiple_source_lines_keep_original_source_position_authority(){let mut p=para(vec![block(),position(2),block()]);p.line_segs=vec![0,8,16];let a=table(0,false);let ac=table(0,true);let b=table(2,false);let items=[(0,&a),(1,&ac),(2,&b)];assert_eq!(page_number_position_page(&p,1,&items),control_page(&p,1,&items));}
#[test]fn nonflow_table_retains_legacy_source_mapping(){let mut p=para(vec![block(),position(2)]);let Control::Table(ref mut t)=p.controls[0]else{panic!()};t.common.flow_with_text=false;let a=table(0,false);let ac=table(0,true);let items=[(0,&a),(1,&ac)];assert_eq!(page_number_position_page(&p,1,&items),Some(0));}
#[test]fn shape_ownership_is_not_broadened_to_final_fragment(){let p=para(vec![Control::Other,position(2)]);let a=PageItem::Shape{para_index:0,control_index:0};let items=[(0,&a),(2,&a)];assert_eq!(page_number_position_page(&p,1,&items),control_page(&p,1,&items));assert_eq!(page_number_position_page(&p,1,&items),Some(0));}
#[test]fn mixed_shape_and_flow_table_retains_legacy_mapping(){let p=para(vec![Control::Other,position(2),block()]);let a=PageItem::Shape{para_index:0,control_index:0};let b=table(2,false);let items=[(0,&a),(2,&b)];assert_eq!(page_number_position_page(&p,1,&items),control_page(&p,1,&items));assert_eq!(page_number_position_page(&p,1,&items),Some(0));}
#[test]fn mixed_nonflow_and_flow_tables_retain_legacy_mapping(){let mut p=para(vec![block(),position(2),block()]);let Control::Table(ref mut t)=p.controls[0]else{panic!()};t.common.flow_with_text=false;let a=table(0,false);let ac=table(0,true);let b=table(2,false);let items=[(0,&a),(1,&ac),(2,&b)];assert_eq!(page_number_position_page(&p,1,&items),control_page(&p,1,&items));assert_eq!(page_number_position_page(&p,1,&items),Some(0));}
#[test]fn inherited_format_does_not_overwrite_hide_flag(){let ps=vec![para(vec![Control::PageHide(PageHide{hide_page_number:true})])];let mut pages=vec![page(vec![PageItem::FullParagraph{para_index:0}])];pages[0].page_hide=Some(PageHide{hide_page_number:true});inherit_number_position_prefix(&mut pages,&ps,&prior());assert_eq!(pages[0].page_hide,Some(PageHide{hide_page_number:true}));assert_eq!(pages[0].page_number_pos.as_ref().unwrap().position,9);}
`;
await runRustTests({name:'page-number-source-owner',sourceSha256:createHash('sha256').update(source).digest('hex'),code:adapters+production+tests});
