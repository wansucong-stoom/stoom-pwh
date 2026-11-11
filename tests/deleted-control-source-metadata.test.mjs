import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sourceBlock,runRustTests} from './engine-source-ownership/harness.mjs';

test('object deletion keeps raw UTF-16, HWPX line axes, field ownership and logical positions consistent',{
 skip:!process.env.PWH_ENGINE_SOURCE,
},async()=>{
 const source=await fs.readFile(path.join(process.env.PWH_ENGINE_SOURCE,'src/model/paragraph.rs'),'utf8');
 const methods=['pub(crate) fn remove_control(','fn remove_stream_slot(','fn stored_text_starts_on_hwp5_axis(','fn is_hwp5_slot_boundary(','fn char_stream_len(','fn char_utf16_len('].map(m=>sourceBlock(source,m)).join('\n');
 await runRustTests({name:'deleted-control-metadata',sourceSha256:createHash('sha256').update(source).digest('hex'),code:`
const CTRL_CHAR_CODE_UNITS:u32=8;
#[derive(Debug,Clone,Default)] struct Control;
impl Control { fn is_logical_inline(&self)->bool {true} }
#[derive(Debug,Clone,Default)] struct CharShapeRef { start_pos:u32, id:u32 }
#[derive(Debug,Clone,Default)] struct Mark {char_idx:usize,utf16_pos:Option<u32>}
#[derive(Debug,Clone,Default)] struct Range {start:u32,end:u32}
#[derive(Debug,Clone,Default)] struct Line {text_start:u32}
#[derive(Debug,Clone,Default)] struct Field {control_idx:usize,inner_slot_count:usize,start_char_idx:usize,end_char_idx:usize}
#[derive(Default)] struct Paragraph {text:String,char_offsets:Vec<u32>,controls:Vec<Control>,ctrl_data_records:Vec<Option<()>>,field_ranges:Vec<Field>,char_count:u32,hwpx_axis_shift:u32,markpen_marks:Vec<Mark>,char_shapes:Vec<CharShapeRef>,range_tags:Vec<Range>,line_segs:Vec<Line>,layout_space_metrics:Vec<(u32,())>}
impl Paragraph {
${methods}
}
#[test] fn mixed_width_text_and_owned_fields_move_together() {
 let mut p=Paragraph{text:"A😀\\tBC".into(),char_offsets:vec![16,17,19,35,36],controls:vec![Control;4],char_count:46,
 markpen_marks:vec![Mark{char_idx:3,utf16_pos:Some(35)}],char_shapes:vec![CharShapeRef{start_pos:16,id:1},CharShapeRef{start_pos:35,id:2}],
 range_tags:vec![Range{start:27,end:38}],line_segs:vec![Line{text_start:0},Line{text_start:35}],layout_space_metrics:vec![(35,())],
 field_ranges:vec![Field{control_idx:1,inner_slot_count:1,start_char_idx:2,end_char_idx:4},Field{control_idx:3,..Field::default()}],..Paragraph::default()};
 p.remove_control(2);assert_eq!(p.char_offsets,vec![16,17,19,27,28]);assert_eq!(p.char_count,38);
 assert_eq!(p.markpen_marks[0].char_idx,3);assert_eq!(p.markpen_marks[0].utf16_pos,Some(27));
 assert_eq!((p.range_tags[0].start,p.range_tags[0].end),(27,30));assert_eq!(p.char_shapes[1].start_pos,27);
 assert_eq!(p.line_segs[1].text_start,27);assert_eq!(p.layout_space_metrics[0].0,27);
 assert_eq!(p.field_ranges[0].inner_slot_count,0);assert_eq!((p.field_ranges[0].start_char_idx,p.field_ranges[0].end_char_idx),(2,4));assert_eq!(p.field_ranges[1].control_idx,2);
 assert_eq!(p.text,"A😀\\tBC");
}
#[test] fn duplicate_style_boundaries_keep_the_style_to_the_right() {
 let mut p=Paragraph{text:"AB".into(),char_offsets:vec![0,9],controls:vec![Control],char_count:11,char_shapes:vec![CharShapeRef{start_pos:0,id:1},CharShapeRef{start_pos:1,id:2},CharShapeRef{start_pos:9,id:3}],..Paragraph::default()};
 p.remove_control(0);assert_eq!(p.char_shapes.len(),2);assert_eq!((p.char_shapes[1].start_pos,p.char_shapes[1].id),(1,3));
}
#[test] fn adjacent_trailing_controls_can_be_deleted_in_reverse_order() {
 let mut p=Paragraph{text:"AB".into(),char_offsets:vec![0,1],controls:vec![Control;2],char_count:19,char_shapes:vec![CharShapeRef{start_pos:18,id:7}],..Paragraph::default()};
 p.remove_control(1);assert_eq!(p.char_count,11);assert_eq!(p.char_shapes[0].start_pos,10);
 p.remove_control(0);assert_eq!(p.char_count,3);assert_eq!(p.char_offsets,vec![0,1]);assert_eq!(p.char_shapes[0].start_pos,2);
}
#[test] fn raw_hwpx_line_starts_and_metric_keys_stay_on_their_original_axis() {
 let mut p=Paragraph{text:"ABCD".into(),char_offsets:vec![16,17,26,27],controls:vec![Control;3],char_count:29,hwpx_axis_shift:16,line_segs:vec![Line{text_start:0},Line{text_start:10}],layout_space_metrics:vec![(0,()),(10,())],..Paragraph::default()};
 assert!(!p.stored_text_starts_on_hwp5_axis());p.remove_control(2);
 assert_eq!(p.char_offsets,vec![16,17,18,19]);assert_eq!(p.line_segs[0].text_start,0);assert_eq!(p.line_segs[1].text_start,2);assert_eq!(p.layout_space_metrics[1].0,2);assert_eq!(p.hwpx_axis_shift,16);
}
#[test] fn hwpx_producer_already_using_hwp5_starts_is_not_shifted_twice() {
 let mut p=Paragraph{text:"ABCD".into(),char_offsets:vec![16,17,26,27],controls:vec![Control;3],char_count:29,hwpx_axis_shift:16,line_segs:vec![Line{text_start:0},Line{text_start:26}],layout_space_metrics:vec![(26,())],..Paragraph::default()};
 assert!(p.stored_text_starts_on_hwp5_axis());p.remove_control(2);assert_eq!(p.line_segs[1].text_start,18);assert_eq!(p.layout_space_metrics[0].0,18);
}
`});
});
