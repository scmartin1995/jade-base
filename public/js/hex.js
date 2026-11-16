// A joined-up honeycomb of flat-topped hexagons, for canvas backdrops. Each hexagon draws only its top three edges;
// the hexagons below supply the rest, so every edge is drawn once and the lines stay an even brightness.
// (ox, oy) is any point on the lattice (a hexagon centre), so the grid can move with a pan or zoom.
export function honeycomb(ctx, W, H, r, ox = 0, oy = 0) {
  if (r < 4) return;
  const colW = r * 1.5, rowH = r * Math.sqrt(3);
  const c0 = Math.floor((0 - ox) / colW) - 1, c1 = Math.ceil((W - ox) / colW) + 1;
  ctx.beginPath();
  for (let c = c0; c <= c1; c++) {
    const x = ox + c * colW, shift = (c & 1) ? rowH / 2 : 0;
    const r0 = Math.floor((0 - oy - shift) / rowH) - 1, r1 = Math.ceil((H - oy - shift) / rowH) + 1;
    for (let k = r0; k <= r1; k++) {
      const y = oy + k * rowH + shift;
      ctx.moveTo(x - r, y);                                    // left point
      ctx.lineTo(x - r / 2, y - rowH / 2);                     // up to the top-left corner
      ctx.lineTo(x + r / 2, y - rowH / 2);                     // across the top
      ctx.lineTo(x + r, y);                                    // down to the right point
    }
  }
}
