/** Serialisation: SVG, JSON documents, PNG raster export and printing. */

import { subpathsToSvgD, subpathsBounds, unionBounds } from "./geom.js";
import { nodeBounds, textMetrics, fontString, activeArtboard, paintOrder } from "./doc.js";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function paintFor(node, defs, id) {
  const attrs = [];
  if (node.fill) {
    if (node.fill.type === "gradient" || node.fill.type === "radial") {
      const gid = `grad-${id}`;
      const b = nodeBounds(node);
      const angle = ((node.fill.angle ?? 90) * Math.PI) / 180;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const len = Math.max(1, Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle))) / 2;
      const x1 = cx - Math.cos(angle) * len, y1 = cy - Math.sin(angle) * len;
      const x2 = cx + Math.cos(angle) * len, y2 = cy + Math.sin(angle) * len;
      const stops = (node.fill.stops || [])
        .slice()
        .sort((a, b2) => a.offset - b2.offset)
        .map((s) => `<stop offset="${s.offset}" stop-color="${esc(s.color)}"/>`)
        .join("");
      defs.push(node.fill.type === "radial"
        ? `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${Math.max(b.w, b.h) / 2}">${stops}</radialGradient>`
        : `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
      attrs.push(`fill="url(#${gid})"`);
    } else {
      attrs.push(`fill="${esc(node.fill.color)}"`);
    }
  } else {
    attrs.push(`fill="none"`);
  }
  if (node.stroke && node.stroke.width > 0) {
    attrs.push(`stroke="${esc(node.stroke.color)}"`, `stroke-width="${node.stroke.width}"`);
    if (node.stroke.cap && node.stroke.cap !== "butt") attrs.push(`stroke-linecap="${node.stroke.cap}"`);
    if (node.stroke.join && node.stroke.join !== "miter") attrs.push(`stroke-linejoin="${node.stroke.join}"`);
    if (node.stroke.dash && node.stroke.dash.length) attrs.push(`stroke-dasharray="${node.stroke.dash.join(" ")}"`);
  }
  if (node.opacity != null && node.opacity !== 1) attrs.push(`opacity="${node.opacity}"`);
  if (node.blendMode && node.blendMode !== "source-over") attrs.push(`style="mix-blend-mode:${node.blendMode}"`);
  if (node.fillRule === "evenodd") attrs.push(`fill-rule="evenodd"`);
  return attrs.join(" ");
}

function nodeToSvg(node, defs, depth = 0) {
  const pad = "  ".repeat(depth);
  if (node.type === "group") {
    const inner = node.children.map((c) => nodeToSvg(c, defs, depth + 1)).join("\n");
    return `${pad}<g id="${node.id}" data-name="${esc(node.name)}">\n${inner}\n${pad}</g>`;
  }
  if (node.type === "text") {
    const m = textMetrics(node);
    const { r, g, b } = hexToRgbLocal(node.fill?.color || "#000000");
    const align = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
    const anchorX = node.align === "center" ? node.x + m.width / 2 : node.align === "right" ? node.x + m.width : node.x;
    const spans = m.lines.map((line, i) =>
      `<tspan x="${anchorX}" y="${node.y + i * m.lineHeight + (node.fontSize || 36) * 0.82}">${esc(line) || " "}</tspan>`
    ).join("");
    return `${pad}<text id="${node.id}" data-name="${esc(node.name)}" font-family="${esc(node.fontFamily)}" font-size="${node.fontSize}" font-weight="${node.fontWeight || 400}"${node.fontStyle === "italic" ? ' font-style="italic"' : ""} letter-spacing="${node.letterSpacing || 0}" fill="${esc(node.fill?.color || "#000000")}" text-anchor="${align}">${spans}</text>`;
  }
  const d = subpathsToSvgD(node.subpaths || []);
  return `${pad}<path id="${node.id}" data-name="${esc(node.name)}" d="${d}" ${paintFor(node, defs, node.id)}/>`;
}

function hexToRgbLocal(hex) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return { r: parseInt(n.slice(0, 2), 16) || 0, g: parseInt(n.slice(2, 4), 16) || 0, b: parseInt(n.slice(4, 6), 16) || 0 };
}

export function toSvg(doc, artboard = activeArtboard(doc)) {
  const defs = [];
  const layers = doc.layers.map((layer) => {
    if (!layer.visible) return "";
    const children = layer.children.map((c) => nodeToSvg(c, defs, 2)).join("\n");
    return `  <g id="${layer.id}" data-layer="${esc(layer.name)}">\n${children}\n  </g>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${artboard.w}" height="${artboard.h}" viewBox="${artboard.x} ${artboard.y} ${artboard.w} ${artboard.h}">
  <title>${esc(doc.name)}</title>
  <desc>Created with VectorStudio — REA + VectorCraft illustration workspace</desc>
  <defs>
${defs.map((d) => `    ${d}`).join("\n")}
  </defs>
${layers}
</svg>
`;
}

export function toSvgString(doc) {
  return toSvg(doc);
}

/** Rasterise the active artboard at a scale factor. */
export function toCanvas(doc, artboard, scale = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(artboard.w * scale));
  canvas.height = Math.max(1, Math.round(artboard.h * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, -artboard.x * scale, -artboard.y * scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(artboard.x, artboard.y, artboard.w, artboard.h);
  for (const node of paintOrder(doc)) {
    ctx.save();
    ctx.globalAlpha = node.opacity ?? 1;
    if (node.blendMode && node.blendMode !== "source-over") ctx.globalCompositeOperation = node.blendMode;
    try {
      if (node.type === "text") paintText(ctx, node);
      else paintShape(ctx, node);
    } catch (err) {
      console.error("render failed", err);
    }
    ctx.restore();
  }
  return canvas;
}

function paintShape(ctx, node) {
  if (!node.subpaths || !node.subpaths.length) return;
  const p = new Path2D();
  for (const sp of node.subpaths) {
    const n = sp.nodes;
    if (!n.length) continue;
    p.moveTo(n[0].x, n[0].y);
    const last = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < last; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      if (a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y) p.lineTo(b.x, b.y);
      else p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
    }
    if (sp.closed) p.closePath();
  }
  if (node.fill) {
    if (node.fill.type === "gradient" || node.fill.type === "radial") {
      const b = subpathsBounds(node.subpaths);
      const angle = ((node.fill.angle ?? 90) * Math.PI) / 180;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const len = Math.max(1, Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle))) / 2;
      const grad = node.fill.type === "radial"
        ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) / 2 || 1)
        : ctx.createLinearGradient(cx - Math.cos(angle) * len, cy - Math.sin(angle) * len, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      for (const s of node.fill.stops) grad.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = node.fill.color;
    }
    ctx.fill(p, "nonzero");
  }
  if (node.stroke && node.stroke.width > 0) {
    ctx.strokeStyle = node.stroke.color;
    ctx.lineWidth = node.stroke.width;
    ctx.lineCap = node.stroke.cap || "butt";
    ctx.lineJoin = node.stroke.join || "miter";
    ctx.setLineDash(node.stroke.dash || []);
    ctx.stroke(p);
  }
}

function paintText(ctx, node) {
  const m = textMetrics(node);
  ctx.font = fontString(node);
  ctx.textBaseline = "top";
  ctx.fillStyle = node.fill?.color || "#000";
  if (node.stroke && node.stroke.width) {
    ctx.strokeStyle = node.stroke.color;
    ctx.lineWidth = node.stroke.width;
  }
  m.lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    let x = node.x;
    if (node.align === "center") x -= w / 2;
    if (node.align === "right") x -= w;
    ctx.fillText(line, x, node.y + i * m.lineHeight);
  });
}

export function downloadSvg(doc, filename) {
  const svg = toSvg(doc);
  return { svg, filename: filename || `${doc.name.replace(/\s+/g, "-").toLowerCase()}.svg` };
}

export function documentJson(doc, extra = {}) {
  return JSON.stringify({ ...doc, ...extra }, null, 2);
}
