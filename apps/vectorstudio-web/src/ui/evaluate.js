/**
 * Illustrator accepts arithmetic in numeric fields: 120+30, 50*2, 100/3. */
export function evaluateExpression(raw) {
  const text = String(raw).trim().replace(/[,\s]/g, "").replace(/px|pt|mm|in|%|°/g, "");
  if (!text) return null;
  if (!/^[-+*/().\d]+$/.test(text)) {
    const n = parseFloat(text);
    return Number.isFinite(n) ? n : null;
  }
  if (!/[-+*/]/.test(text.replace(/^-/, ""))) {
    const n = parseFloat(text);
    return Number.isFinite(n) ? n : null;
  }
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${text})`)();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
