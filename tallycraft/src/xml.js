/**
 * A small, strict-enough XML reader for Tally envelopes.
 *
 * Tally's exports are regular XML without namespaces in practice, so a
 * purpose-built tokenizer is smaller and easier to reason about than a
 * dependency. It preserves child order, attributes, and text, rejects
 * mismatched tags, and never expands external entities.
 */

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES.get(body) ?? match;
  });
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? "";
    if (name !== undefined) attributes[name] = decodeEntities(value);
  }
  return attributes;
}

/**
 * Parse XML into `{ name, attributes, children, text }` nodes.
 * The document node is returned with `name: "#document"`.
 */
export function parseXml(source) {
  const root = { name: "#document", attributes: {}, children: [], text: "" };
  const stack = [root];
  let index = 0;

  const current = () => stack[stack.length - 1];

  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open === -1) {
      const tail = source.slice(index).trim();
      if (tail !== "") current().text += decodeEntities(tail);
      break;
    }
    if (open > index) {
      const chunk = source.slice(index, open);
      if (chunk.trim() !== "") current().text += decodeEntities(chunk);
    }

    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end === -1) throw new Error("Unterminated XML comment");
      index = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end === -1) throw new Error("Unterminated CDATA section");
      current().text += source.slice(open + 9, end);
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end === -1) throw new Error("Unterminated processing instruction");
      index = end + 2;
      continue;
    }
    if (source.startsWith("<!", open)) {
      const end = source.indexOf(">", open + 2);
      if (end === -1) throw new Error("Unterminated declaration");
      index = end + 1;
      continue;
    }

    const close = source.indexOf(">", open);
    if (close === -1) throw new Error("Unterminated XML tag");
    const raw = source.slice(open + 1, close);

    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const parent = current();
      if (parent.name !== name) {
        throw new Error(
          `Mismatched closing tag </${name}> inside <${parent.name}>`,
        );
      }
      if (stack.length === 1)
        throw new Error(`Unexpected closing tag </${name}>`);
      stack.pop();
      index = close + 1;
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([\w.:-]+)/.exec(body.trim());
    if (nameMatch === null) throw new Error(`Invalid XML tag <${raw}>`);
    const name = nameMatch[1];
    const attributes = parseAttributes(body.slice(nameMatch[0].length));
    const node = { name, attributes, children: [], text: "" };
    current().children.push(node);
    if (!selfClosing) stack.push(node);
    index = close + 1;
  }

  if (stack.length !== 1) {
    throw new Error(`Unclosed XML tag <${current().name}>`);
  }
  return root;
}

/** Depth-first search for every node with one of the given tag names. */
export function findAll(node, names, found = []) {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  if (wanted.has(node.name.toUpperCase())) found.push(node);
  for (const child of node.children) findAll(child, names, found);
  return found;
}

/** Text of the first direct child with this tag, trimmed, or null. */
export function childText(node, name) {
  const wanted = name.toUpperCase();
  for (const child of node.children) {
    if (child.name.toUpperCase() === wanted) return child.text.trim();
  }
  return null;
}

/** Every direct child with this tag. */
export function childrenNamed(node, name) {
  const wanted = name.toUpperCase();
  return node.children.filter((child) => child.name.toUpperCase() === wanted);
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
