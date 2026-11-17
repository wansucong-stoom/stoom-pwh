import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchTableResizeGrid(studio) {
  const file = path.join(studio, 'src/engine/input-handler-table.ts');
  let source = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const marker = '// Pwh logical table resize height';
  if (source.includes(marker)) return;
  const changes = [
    ['targetProps.width : targetProps.height', 'targetProps.width : (targetProps.resizeHeight ?? targetProps.height)'],
    ['neighborProps.width : neighborProps.height', 'neighborProps.width : (neighborProps.resizeHeight ?? neighborProps.height)'],
    ['return props[axis] ?? NaN;', "return (axis === 'height' ? props.resizeHeight ?? props.height : props.width) ?? NaN;"],
    ['return cell[axis];', "return axis === 'height' ? cell.resizeHeight ?? cell.height : cell.width;"],
  ];
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw Error('Unsupported table resize source: ' + before);
    source = source.replace(before, () => after);
  }
  await fs.writeFile(file, marker + '\n' + source);
}
