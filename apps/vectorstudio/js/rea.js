/**
 * REA evidence layer.
 *
 * Every document edit produces structural evidence: object and topology
 * counts, paint usage, a canonical content digest and an operation log.
 * The panel exports the ledger for review with the REA reverse-engineering
 * toolkit (github.com/morluto/rea), so a design can be audited the same way
 * an analysed binary or bundle is.
 */

import { download } from "./util.js";
import { toSvg } from "./exporters.js";
import { walk } from "./doc.js";

/** 32-bit FNV-1a, stable across sessions for the same content. */
export function digest(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export class ReaSession {
  constructor() {
    this.log = [];
    this.report = null;
    this.startedAt = new Date().toISOString();
  }

  record(label, detail = null) {
    const now = new Date();
    this.log.unshift({
      time: now.toISOString().slice(11, 19),
      label: detail ? `${label} — ${detail}` : label,
    });
    if (this.log.length > 200) this.log.pop();
  }

  analyze(doc) {
    const facts = {
      objects: 0, paths: 0, groups: 0, nodes: 0, closedPaths: 0, openPaths: 0,
      fills: 0, strokes: 0, gradients: 0, layers: doc.layers.length, artboards: doc.artboards.length,
      colors: [], fonts: new Set(), anchors: 0, handles: 0,
      bounds: null,
    };
    const colorCount = new Map();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const noteBounds = (b) => {
      if (!b || (!b.w && !b.h)) return;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    };

    for (const layer of doc.layers) {
      walk(layer.children, (node) => {
        facts.objects++;
        if (node.type === "group") { facts.groups++; return; }
        if (node.type === "text") {
          facts.fonts.add(node.fontFamily);
          if (node.fill?.color) colorCount.set(node.fill.color, (colorCount.get(node.fill.color) || 0) + 1);
          return;
        }
        facts.paths++;
        for (const sp of node.subpaths || []) {
          if (sp.closed) facts.closedPaths++; else facts.openPaths++;
          facts.nodes += sp.nodes.length;
          for (const n of sp.nodes) {
            if (n.ix !== n.x || n.iy !== n.y || n.ox !== n.x || n.oy !== n.y) facts.handles++;
          }
          const b = boundsOf(sp.nodes);
          noteBounds(b);
        }
        if (node.fill) {
          facts.fills++;
          if (node.fill.type === "gradient") {
            facts.gradients++;
            for (const s of node.fill.stops || []) colorCount.set(s.color, (colorCount.get(s.color) || 0) + 1);
          } else if (node.fill.color) {
            colorCount.set(node.fill.color, (colorCount.get(node.fill.color) || 0) + 1);
          }
        }
        if (node.stroke?.width > 0) {
          facts.strokes++;
          if (node.stroke.color) colorCount.set(node.stroke.color, (colorCount.get(node.stroke.color) || 0) + 1);
        }
      });
    }

    const colors = Array.from(colorCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([color, count]) => ({ color, count }));

    const canonical = JSON.stringify({
      artboards: doc.artboards.map((a) => [a.x, a.y, a.w, a.h]),
      layers: doc.layers,
    });

    this.report = {
      producer: "VectorStudio 1.0",
      stage: "design-audit",
      generatedAt: new Date().toISOString(),
      document: doc.name,
      units: doc.units,
      objects: facts.objects,
      groups: facts.groups,
      paths: facts.paths,
      layers: facts.layers,
      nodes: facts.nodes,
      closedPaths: facts.closedPaths,
      openPaths: facts.openPaths,
      curveHandles: facts.handles,
      fills: facts.fills,
      strokes: facts.strokes,
      gradients: facts.gradients,
      colors,
      fonts: Array.from(facts.fonts),
      artboards: doc.artboards.map((a) => ({ name: a.name, width: a.w, height: a.h })),
      artworkBounds: Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
      digest: digest(canonical),
      log: this.log.slice(),
    };
    this.record("Analyze document", `${facts.objects} objects · digest ${this.report.digest}`);
    return this.report;
  }

  evidence() {
    return {
      schema: "rea.evidence/1",
      subject: {
        kind: "vector-document",
        name: this.report?.document || "Untitled",
        digest: this.report?.digest || null,
      },
      observation: this.report,
      provenance: {
        tool: "VectorStudio",
        sessionStarted: this.startedAt,
        exportedAt: new Date().toISOString(),
        source: "local-canvas-editor",
        limitations: [
          "Counts describe the live document model, not rendered pixels.",
          "Digest covers geometry and paint attributes, not editor preferences.",
        ],
      },
    };
  }

  exportEvidence() {
    const data = this.evidence();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    download(`vectorstudio-evidence-${data.subject.digest || "draft"}.json`, blob);
    this.record("Export evidence", data.subject.digest || "");
  }

  async copyDigest() {
    const text = this.report?.digest || "";
    try {
      await navigator.clipboard.writeText(text);
      this.record("Copy digest", text);
      return text;
    } catch {
      return text;
    }
  }

  /** Reverse-engineer our own export: parse the SVG and report its facts. */
  inspectSvg() {
    const svg = toSvg(this.currentDoc);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const counts = {};
    for (const node of parsed.querySelectorAll("*")) {
      const tag = node.tagName.toLowerCase();
      counts[tag] = (counts[tag] || 0) + 1;
    }
    const paths = Array.from(parsed.querySelectorAll("path"));
    const anchors = paths.reduce((sum, p) => {
      const d = p.getAttribute("d") || "";
      const moves = (d.match(/[MLC]/g) || []).length;
      return sum + moves;
    }, 0);
    const colors = new Set();
    for (const el of parsed.querySelectorAll("[fill]")) {
      const fill = el.getAttribute("fill");
      if (fill && fill.startsWith("#")) colors.add(fill.toLowerCase());
    }
    const result = {
      bytes: svg.length,
      elements: counts,
      pathDataAnchors: anchors,
      uniqueFills: colors.size,
      viewBox: parsed.querySelector("svg")?.getAttribute("viewBox") || "",
      digest: digest(svg),
    };
    this.record("Inspect SVG", `${result.bytes} bytes · ${paths.length} paths · ${result.uniqueDigest || result.digest}`);
    return result;
  }
}

function boundsOf(nodes) {
  if (!nodes || !nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x, n.ix, n.ox);
    y0 = Math.min(y0, n.y, n.iy, n.oy);
    x1 = Math.max(x1, n.x, n.ix, n.ox);
    y1 = Math.max(y1, n.y, n.iy, n.oy);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
