/** Border selection uses CSS pixels, including at low zoom. Text beside an
 * edge has a smaller inward allowance so enlarging the target does not turn
 * the first letters of a cell into table-object selection. */
export function isPointNearBoxBorder(pageX, pageY, bbox, zoom = 1) {
  if (![pageX,pageY,bbox?.x,bbox?.y,bbox?.width,bbox?.height,zoom].every(Number.isFinite)
    || bbox.width <= 0 || bbox.height <= 0 || zoom <= 0) return false;
  const outward = 10 / zoom, inward = 3 / zoom;
  const right = bbox.x + bbox.width, bottom = bbox.y + bbox.height;
  const inVertical = pageY >= bbox.y - outward && pageY <= bottom + outward;
  const inHorizontal = pageX >= bbox.x - outward && pageX <= right + outward;
  return inVertical && (pageX >= bbox.x - outward && pageX <= bbox.x + inward
    || pageX >= right - inward && pageX <= right + outward)
    || inHorizontal && (pageY >= bbox.y - outward && pageY <= bbox.y + inward
    || pageY >= bottom - inward && pageY <= bottom + outward);
}
