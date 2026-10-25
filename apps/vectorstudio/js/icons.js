/**
 * VectorStudio icon set.
 * Single-colour geometric glyphs drawn on a 24×24 grid, matching the
 * hairline tool language of a professional vector editor (Adobe Illustrator).
 */

const S = (body, opts = {}) =>
  `<svg viewBox="0 0 24 24" width="${opts.w || 18}" height="${opts.h || 18}" fill="none" stroke="currentColor" stroke-width="${opts.sw || 1.4}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const fillS = (body, w = 18) =>
  `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const icons = {
  /* ---------- tools ---------- */
  select: fillS('<path d="M5 3.2l13.2 8.1-6.1 1.1 3.2 6.4-2.2 1.1-3.2-6.5-4.9 3.9z"/>'),
  direct: fillS('<path d="M5.4 3l12.9 8.2-6 1-3.1 6.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  group: fillS('<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6"/><path d="M8 8h8v8H8z"/>'),
  pen: S('<path d="M12 2.6l4.4 8.2-4.4 5.6-4.4-5.6z"/><path d="M12 16.4V21"/><circle cx="12" cy="11" r="1.1" fill="currentColor" stroke="none"/>'),
  curvpen: S('<path d="M3.2 20.6C5.6 9.8 14 3.2 20.8 3.4"/><path d="M3.2 20.6c4-1.3 6.6-1.9 8.4-1.2M16.5 4.5c1.5 2.6 2.9 4.6 4.3 5.3"/><circle cx="3.2" cy="20.6" r="1" fill="currentColor"/><circle cx="20.8" cy="3.4" r="1" fill="currentColor"/>'),
  addanchor: S('<path d="M2.5 18.5c4-9 15-9 19 0"/><rect x="10.4" y="10.2" width="3.2" height="3.2" fill="currentColor" stroke="none"/><path d="M17.4 5.6h4M19.4 3.6v4"/>'),
  pencil: S('<path d="M4 20.2l2-4.6L17.1 4.1a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3L8.6 18.2z"/><path d="M15.4 6l2.6 2.6"/><path d="M6 15.6l2.4 2.4"/>'),
  smooth: S('<path d="M3 17c3-8 5.5 3 9-3s5.5-5 9-3"/><path d="M3 20.5h18" stroke-dasharray="2 2"/>'),
  brush: S('<path d="M15.8 3.6l4.6 4.6-8.2 8.2-4.6-4.6z"/><path d="M7.6 11.8c-2.8.7-4.2 4.6-4.4 8.4 3.8-.2 7.7-1.6 8.4-4.4z"/>'),
  blob: S('<path d="M12 3.4c4.4 0 8.2 2.6 8.2 6.5 0 4.8-3.6 10-8.2 10S3.8 14.7 3.8 9.9C3.8 6 7.6 3.4 12 3.4z"/>'),
  eraser: S('<path d="M8.4 20.4H20"/><path d="M13.6 3.8l6.6 6.6-8.8 8.8H7.2l-3-3z"/><path d="M9.4 8l6.6 6.6"/>'),
  rect: S('<rect x="4" y="6" width="16" height="12"/>'),
  roundrect: S('<rect x="4" y="6" width="16" height="12" rx="3.2"/>'),
  ellipse: S('<ellipse cx="12" cy="12" rx="8.2" ry="6.4"/>'),
  polygon: S('<path d="M12 3.6l8.3 6-3.2 9.8H6.9L3.7 9.6z"/>'),
  star: S('<path d="M12 3.4l2.7 5.6 6.1.8-4.5 4.3 1.2 6-5.5-3-5.5 3 1.2-6L3.2 9.8l6.1-.8z"/>'),
  line: S('<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.2" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.2" fill="currentColor" stroke="none"/>'),
  arc: S('<path d="M3.6 19.4A14 14 0 0 1 19.4 3.6"/><circle cx="3.6" cy="19.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="19.4" cy="3.6" r="1.2" fill="currentColor" stroke="none"/>'),
  spiral: S('<path d="M12.4 12.2a2.6 2.6 0 0 1 2.6 2.6 4.6 4.6 0 0 1-4.6 4.6 6.6 6.6 0 0 1-6.6-6.6 8.6 8.6 0 0 1 8.6-8.6"/>'),
  grid: S('<rect x="3.6" y="5.6" width="16.8" height="12.8"/><path d="M9.2 5.6v12.8M14.8 5.6v12.8M3.6 11.2h16.8M3.6 15.4h16.8"/>'),
  type: S('<path d="M4 6.6V4.4h16v2.2"/><path d="M12 4.8v14.8"/><path d="M8.6 19.6h6.8"/>'),
  typepath: S('<path d="M2.6 19.4c3.6-8.6 15.2-8.6 18.8 0"/><path d="M7.6 13.2V10h6v3.2"/><path d="M10.6 10v7.4"/>'),
  typearea: S('<rect x="3.6" y="5" width="16.8" height="14" stroke-dasharray="2 1.8"/><path d="M8 10.4V9h7v1.4M11.5 9v6M9.6 15h4"/>'),
  gradient: S('<rect x="3.6" y="5" width="16.8" height="14"/><path d="M6 16.6l12-9.2" /><path d="M3.6 19.4h16.8" stroke-width="3.2"/>'),
  swatch: S('<rect x="3.4" y="3.4" width="7" height="7"/><rect x="13.6" y="3.4" width="7" height="7"/><rect x="3.4" y="13.6" width="7" height="7"/><rect x="13.6" y="13.6" width="7" height="7" fill="currentColor"/>'),
  eyedropper: S('<path d="M15.4 3.4l5.2 5.2-2.4 2.4-5.2-5.2z"/><path d="M12.6 8.2l-8 8v4.4h4.4l8-8"/>'),
  blend: S('<circle cx="7.4" cy="16.6" r="3.6"/><circle cx="16.6" cy="7.4" r="3.6"/><path d="M9.6 9.6l4.8 4.8"/>'),
  width: S('<path d="M5 6h14M3.8 12h16.4M5 18h14"/><path d="M12 3.4v17.2"/>'),
  mesh: S('<path d="M3.6 8.4h16.8M3.6 15.6h16.8M8.4 3.6v16.8M15.6 3.6v16.8"/><circle cx="8.4" cy="8.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.6" cy="15.6" r="1.3" fill="currentColor" stroke="none"/>'),
  rotate: S('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.6h-4.6"/>'),
  scale: S('<rect x="4" y="12" width="8" height="8"/><rect x="12" y="4" width="8" height="8" stroke-dasharray="2 1.8"/><path d="M6.4 6.4h4M8.4 4.4v4"/>'),
  shear: S('<path d="M4 20h8V4h8"/><path d="M8 8h4M8 12h4M8 16h4" stroke-dasharray="2 1.8"/>'),
  reshape: S('<path d="M4 18c3-8 12-8 16-12"/><circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12.6" r="1.3" fill="currentColor" stroke="none"/>'),
  free: S('<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/><rect x="8.2" y="8.2" width="7.6" height="7.6"/>'),
  warp: S('<path d="M4 6c4 4 12-4 16 0M4 12c4 4 12-4 16 0M4 18c4 4 12-4 16 0"/>'),
  artboard: S('<rect x="3.4" y="5" width="17.2" height="14"/><path d="M3.4 9.2h17.2" stroke-width="0.8"/><path d="M6.6 2.6v2.2M17.4 2.6v2.2M6.6 19.2v2.2M17.4 19.2v2.2"/>'),
  slice: S('<path d="M4 4l7 7-7 7zM20 4l-7 7 7 7z" stroke-dasharray="2 1.8"/><path d="M11 11l2 2"/>'),
  hand: S('<path d="M7.6 12V6.4a1.6 1.6 0 1 1 3.2 0V11"/><path d="M10.8 10.4V5.2a1.6 1.6 0 1 1 3.2 0V11"/><path d="M14 10.6V7a1.6 1.6 0 1 1 3.2 0v7.4c0 3.4-2 6-5.4 6-2.8 0-4-1.6-5.4-4l-1.6-3a1.6 1.6 0 0 1 2.7-1.7l1.1 1.5"/>'),
  zoom: S('<circle cx="10.4" cy="10.4" r="6.4"/><path d="M15.2 15.2L21 21"/><path d="M7.6 10.4h5.6M10.4 7.6v5.6"/>'),
  measure: S('<path d="M3 17.4L17.4 3l3.6 3.6L6.6 21z"/><path d="M8 12.4l1.8 1.8M11.4 9l1.8 1.8M14.8 5.6L16.6 7.4"/>'),

  /* ---------- menu / panel affordances ---------- */
  eye: S('<path d="M2.4 12S5.6 6.2 12 6.2 21.6 12 21.6 12 18.4 17.8 12 17.8 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.6"/>', { sw: 1.3 }),
  eyeOff: S('<path d="M4 4l16 16"/><path d="M9.4 5.2A9.7 9.7 0 0 1 12 5c6.4 0 9.6 7 9.6 7a17 17 0 0 1-3.4 4.3M6.2 7.2A17.6 17.6 0 0 0 2.4 12s3.2 7 9.6 7c1.4 0 2.6-.3 3.7-.8"/>', { sw: 1.3 }),
  lock: S('<rect x="5.4" y="10.4" width="13.2" height="9.2"/><path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8"/>', { sw: 1.3 }),
  unlock: S('<rect x="5.4" y="10.4" width="13.2" height="9.2"/><path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 6.8-1.6"/>', { sw: 1.3 }),
  check: S('<path d="M4.5 12.5l5 5L20 6.5"/>', { sw: 2, w: 12, h: 12 }),
  chevronDown: S('<path d="M5 8.5l7 7 7-7"/>', { sw: 1.5 }),
  chevronRight: S('<path d="M9 5l7 7-7 7"/>', { sw: 1.5 }),
  chevronUp: S('<path d="M5 15.5l7-7 7 7"/>', { sw: 1.5 }),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  minus: S('<path d="M5 12h14"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>', { sw: 1.2 }),
  trash: S('<path d="M4.6 6.6h14.8M9.4 6.6V4.2h5.2v2.4M6.4 6.6l.9 13h9.4l.9-13"/><path d="M10 10.4v6M14 10.4v6"/>', { sw: 1.3 }),
  duplicate: S('<rect x="3.6" y="3.6" width="11" height="11"/><path d="M8.4 8.4h11v11h-11z" fill="var(--panel)" fill-opacity="0.85"/>', { sw: 1.3 }),
  folder: S('<path d="M3.4 6.4h6l1.8 2.4h9.4v10.6H3.4z"/>', { sw: 1.3 }),
  more: S('<circle cx="5.6" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.2" fill="currentColor" stroke="none"/>'),
  gear: S('<circle cx="12" cy="12" r="3.1"/><path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7"/>', { sw: 1.3 }),
  target: S('<circle cx="12" cy="12" r="7.6"/><path d="M12 2.6v5M12 16.4v5M2.6 12h5M16.4 12h5"/>', { sw: 1.2 }),
  link: S('<path d="M9.6 14.4l4.8-4.8"/><path d="M13.4 6.6l1.6-1.6a3.9 3.9 0 0 1 5.5 5.5l-2.9 2.9a3.9 3.9 0 0 1-5.5 0"/><path d="M10.6 17.4l-1.6 1.6a3.9 3.9 0 0 1-5.5-5.5l2.9-2.9a3.9 3.9 0 0 1 5.5 0"/>', { sw: 1.3 }),
  unlink: S('<path d="M9.6 14.4l1.6-1.6M12.8 11.2l1.6-1.6"/><path d="M13.4 6.6l1.6-1.6a3.9 3.9 0 0 1 5.5 5.5l-1.6 1.6M10.6 17.4l-1.6 1.6a3.9 3.9 0 0 1-5.5-5.5l1.6-1.6"/>', { sw: 1.3 }),
  hamburger: S('<path d="M4 7h16M4 12h16M4 17h16"/>', { sw: 1.4 }),
  gridSmall: S('<rect x="4" y="4" width="6.4" height="6.4"/><rect x="13.6" y="4" width="6.4" height="6.4"/><rect x="4" y="13.6" width="6.4" height="6.4"/><rect x="13.6" y="13.6" width="6.4" height="6.4"/>', { sw: 1.2 }),
  list: S('<path d="M4 6.6h16M4 12h16M4 17.4h16"/>', { sw: 1.2 }),

  /* ---------- alignment ---------- */
  alignLeft: S('<path d="M3.4 2.8v18.4"/><rect x="7" y="5.4" width="12.4" height="5"/><rect x="7" y="13.6" width="7.6" height="5"/>', { sw: 1.2, w: 15, h: 15 }),
  alignCenterH: S('<path d="M12 2.8v18.4"/><rect x="4.4" y="5.4" width="15.2" height="5"/><rect x="7.8" y="13.6" width="8.4" height="5"/>', { sw: 1.2, w: 15, h: 15 }),
  alignRight: S('<path d="M20.6 2.8v18.4"/><rect x="4.6" y="5.4" width="12.4" height="5"/><rect x="9.4" y="13.6" width="7.6" height="5"/>', { sw: 1.2, w: 15, h: 15 }),
  alignTop: S('<path d="M2.8 3.4h18.4"/><rect x="5.4" y="7" width="5" height="12.4"/><rect x="13.6" y="7" width="5" height="7.6"/>', { sw: 1.2, w: 15, h: 15 }),
  alignCenterV: S('<path d="M2.8 12h18.4"/><rect x="5.4" y="4.4" width="5" height="15.2"/><rect x="13.6" y="7.8" width="5" height="8.4"/>', { sw: 1.2, w: 15, h: 15 }),
  alignBottom: S('<path d="M2.8 20.6h18.4"/><rect x="5.4" y="4.6" width="5" height="12.4"/><rect x="13.6" y="9.4" width="5" height="7.6"/>', { sw: 1.2, w: 15, h: 15 }),
  distributeH: S('<path d="M3.4 2.8v18.4M20.6 2.8v18.4"/><rect x="9.4" y="5.4" width="5.2" height="13.2"/>', { sw: 1.2, w: 15, h: 15 }),
  distributeV: S('<path d="M2.8 3.4h18.4M2.8 20.6h18.4"/><rect x="5.4" y="9.4" width="13.2" height="5.2"/>', { sw: 1.2, w: 15, h: 15 }),
  spaceH: S('<rect x="2.8" y="6.4" width="4" height="11.2"/><rect x="17.2" y="6.4" width="4" height="11.2"/><rect x="9.4" y="4.4" width="5.2" height="15.2"/>', { sw: 1.1, w: 15, h: 15 }),
  spaceV: S('<rect x="6.4" y="2.8" width="11.2" height="4"/><rect x="6.4" y="17.2" width="11.2" height="4"/><rect x="4.4" y="9.4" width="15.2" height="5.2"/>', { sw: 1.1, w: 15, h: 15 }),

  /* ---------- pathfinder ---------- */
  unite: S('<path d="M3.6 3.6h10.8v5.2h5.2v10.8H8.8v-5.2H3.6z" fill="currentColor" stroke="none"/>', { w: 16, h: 16 }),
  minusFront: S('<rect x="3.4" y="3.4" width="11.2" height="11.2" fill="currentColor" stroke="none"/><rect x="9.4" y="9.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><path d="M9.4 9.4h5.2v-5.2H3.4v11.2h6z" fill="currentColor" stroke="none"/>', { w: 16, h: 16 }),
  intersect: S('<rect x="3.4" y="3.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><rect x="9.4" y="9.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><rect x="9.4" y="9.4" width="5.2" height="5.2" fill="currentColor" stroke="none"/>', { w: 16, h: 16 }),
  exclude: S('<rect x="3.4" y="3.4" width="11.2" height="11.2" fill="currentColor" stroke="none"/><rect x="9.4" y="9.4" width="11.2" height="11.2" fill="currentColor" stroke="none"/><rect x="9.4" y="9.4" width="5.2" height="5.2" fill="none" stroke="none"/>', { w: 16, h: 16 }),
  divide: S('<rect x="3.4" y="3.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><rect x="9.4" y="9.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><path d="M9.4 3.4v6h5.2v-6M3.4 9.4h6v5.2H3.4M14.6 9.4v5.2h6V9.4M9.4 14.6v5.2h5.2v-5.2"/>', { w: 16, h: 16 }),
  minusBack: S('<rect x="3.4" y="3.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><rect x="9.4" y="9.4" width="11.2" height="11.2" fill="none" stroke="currentColor"/><path d="M3.4 3.4h5.2v5.2H3.4zM14.6 14.6h6v6h-6z" fill="currentColor" stroke="none"/>', { w: 16, h: 16 }),
  outlinePF: S('<path d="M4 19.8V4.2h15.6" /><path d="M8.4 15.4V8.2h7.2v7.2z" fill="none"/><path d="M4 15.4h4.4M15.6 8.6H20M8.4 19.8V15.4" stroke-dasharray="1.6 1.4"/>', { sw: 1.1, w: 16, h: 16 }),
  trim: S('<path d="M4 4h16v16H4z" fill="none"/><path d="M4 10.4h16M10.4 4v16" /><path d="M4 4h6.4v6.4H4z" fill="currentColor" stroke="none"/>', { w: 16, h: 16 }),
  merge: S('<circle cx="8" cy="8" r="4.6" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="4.6" fill="currentColor" stroke="none"/><path d="M8 12.6h8v7.8H8z" fill="none" stroke="currentColor"/>', { w: 16, h: 16 }),
  cropPF: S('<path d="M3 8.4h4.4V3M20.8 15.6h-4.4V21"/><path d="M7.4 7.4h9.2v9.2H7.4z" fill="none" stroke-dasharray="2 1.6"/>', { w: 16, h: 16 }),

  /* ---------- stroke & type ---------- */
  capButt: S('<path d="M4 4v16M20 4v16"/><path d="M8 12h8" stroke-width="3.4"/>', { sw: 1.2, w: 14, h: 14 }),
  capRound: S('<path d="M4 4v16M20 4v16"/><path d="M8 12h8" stroke-width="3.4" stroke-linecap="round"/>', { sw: 1.2, w: 14, h: 14 }),
  capSquare: S('<path d="M4 4v16M20 4v16"/><path d="M8 12h8" stroke-width="3.4" stroke-linecap="square"/>', { sw: 1.2, w: 14, h: 14 }),
  joinMiter: S('<path d="M5 19V5h14" stroke-width="3.4" stroke-linejoin="miter"/>', { sw: 1.2, w: 14, h: 14 }),
  joinRound: S('<path d="M5 19V5h14" stroke-width="3.4" stroke-linejoin="round"/>', { sw: 1.2, w: 14, h: 14 }),
  joinBevel: S('<path d="M5 19V5h14" stroke-width="3.4" stroke-linejoin="bevel"/>', { sw: 1.2, w: 14, h: 14 }),
  dashNone: S('<path d="M3 12h18" stroke-width="2.6"/>', { sw: 1.2, w: 14, h: 14 }),
  dashDotted: S('<path d="M3 12h3M9 12h3M15 12h3" stroke-width="2.6"/>', { sw: 1.2, w: 14, h: 14 }),
  dashDashed: S('<path d="M3 12h5.4M12 12h5.4" stroke-width="2.6"/>', { sw: 1.2, w: 14, h: 14 }),
  typeLeft: S('<path d="M3.6 5.4h16.8M3.6 10.2h11.2M3.6 15h16.8M3.6 19.8h9.4"/>', { sw: 1.3, w: 14, h: 14 }),
  typeCenter: S('<path d="M3.6 5.4h16.8M6.4 10.2h11.2M3.6 15h16.8M7.6 19.8h8.8"/>', { sw: 1.3, w: 14, h: 14 }),
  typeRight: S('<path d="M3.6 5.4h16.8M9.2 10.2h11.2M3.6 15h16.8M10.6 19.8h9.4"/>', { sw: 1.3, w: 14, h: 14 }),
  typeJustify: S('<path d="M3.6 5.4h16.8M3.6 10.2h16.8M3.6 15h16.8M3.6 19.8h16.8"/>', { sw: 1.3, w: 14, h: 14 }),
  bold: S('<path d="M7.4 4.6h5.8a3.7 3.7 0 0 1 0 7.4H7.4zM7.4 12h6.6a3.8 3.8 0 0 1 0 7.6H7.4z" stroke-width="2"/>', { sw: 1.2 }),
  italic: S('<path d="M10.4 4.6h7M6.6 19.4h7M14 4.6L10 19.4"/>', { sw: 1.5 }),
  underline: S('<path d="M7 4.6v7.2a5 5 0 0 0 10 0V4.6M6 20.4h12"/>', { sw: 1.4 }),
  tracking: S('<path d="M4 6v12M8 6v12M16 6v12M20 6v12M12 3v18" stroke-dasharray="2 1.6"/>', { sw: 1.1 }),

  /* ---------- misc ---------- */
  transparency: S('<path d="M3.4 3.4h17.2v17.2H3.4z"/><path d="M3.4 3.4l17.2 17.2" /><path d="M11 3.4h9.6v9.6H11z" fill="currentColor" fill-opacity="0.55" stroke="none"/>', { w: 14, h: 14 }),
  rotateLeft: S('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.6h4.6"/>', { w: 14, h: 14 }),
  rotateRight: S('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.6h-4.6"/>', { w: 14, h: 14 }),
  flipH: S('<path d="M12 3v18" stroke-dasharray="2 1.6"/><path d="M9.4 6.4L4 12l5.4 5.6zM14.6 6.4L20 12l-5.4 5.6z" fill="currentColor" stroke="none"/>', { w: 14, h: 14 }),
  flipV: S('<path d="M3 12h18" stroke-dasharray="2 1.6"/><path d="M6.4 9.4L12 4l5.6 5.4zM6.4 14.6L12 20l5.6-5.4z" fill="currentColor" stroke="none"/>', { w: 14, h: 14 }),
  smiley: S('<circle cx="12" cy="12" r="8.4"/><circle cx="9" cy="9.6" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="9.6" r=".9" fill="currentColor" stroke="none"/><path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0"/>', { w: 14, h: 14 }),
  info: S('<circle cx="12" cy="12" r="8.6"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>', { w: 14, h: 14 }),
  cursor: S('<path d="M6 3.6l11.4 6.6-4.6 1-2.6 5z"/>', { w: 14, h: 14 }),

  /* ---------- REA ---------- */
  swapColors: S('<path d="M4 8.6h11.4"/><path d="M12.6 5.4l3.2 3.2-3.2 3.2"/><path d="M20 15.4H8.6"/><path d="M11.4 12.2L8.2 15.4l3.2 3.2"/>', { sw: 1.5, w: 13, h: 13 }),
  defaultColors: S('<rect x="3" y="3" width="10" height="10" fill="currentColor" stroke="none"/><rect x="11" y="11" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/>', { w: 13, h: 13 }),
  noColor: S('<rect x="3.4" y="3.4" width="17.2" height="17.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.4 20.6L20.6 3.4" stroke="#d94a3d" stroke-width="1.6"/>', { w: 13, h: 13 }),
  rea: S('<path d="M4 20V9.4l8-5.4 8 5.4V20"/><path d="M8.4 20v-6.4h7.2V20"/><circle cx="12" cy="9.4" r="1.5" fill="currentColor" stroke="none"/>', { w: 12, h: 12 }),
};

export function icon(name, size) {
  const body = icons[name];
  if (!body) return "";
  if (!size) return body;
  return body.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
}
