/**
 * A small, tolerant XML parser that keeps source offsets for every node.
 *
 * It has no dependency on the VS Code API so it can be unit-tested with plain Node.
 * It is not a validating parser: it is built to show structure even when the
 * file is half-edited (unclosed or mismatched tags are reported, not fatal).
 */

export type XmlNodeKind = 'element' | 'text' | 'cdata' | 'comment' | 'doctype' | 'pi';

export interface XmlAttribute {
  name: string;
  value: string;
  /** Offset of the attribute name. */
  start: number;
  /** Offset just after the closing quote (or the name if there is no value). */
  end: number;
}

export interface XmlNode {
  kind: XmlNodeKind;
  /** Tag name for elements, target for processing instructions, root name for DOCTYPE. */
  name: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  parent?: XmlNode;
  /** Offset of the first character ('<' for markup). */
  start: number;
  /** Offset just after the last character of the node (after the closing tag). */
  end: number;
  /** For elements: offset of the tag name inside the opening tag. */
  nameStart: number;
  /** For elements: offset just after the opening tag's '>'. */
  openTagEnd: number;
  selfClosing: boolean;
  /** Raw content for text / cdata / comment / doctype / pi nodes. */
  text: string;
  /** True when the element was never closed in the source. */
  unclosed?: boolean;
}

export interface XmlParseProblem {
  message: string;
  start: number;
  end: number;
}

export interface XmlDocumentModel {
  /** Top-level nodes (DOCTYPE, PI, comments and the root element). */
  nodes: XmlNode[];
  /** The first top-level element, if any. */
  root?: XmlNode;
  problems: XmlParseProblem[];
  /** Source text length, useful for clamping. */
  length: number;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-]/;

function makeNode(kind: XmlNodeKind, start: number): XmlNode {
  return {
    kind,
    name: '',
    attributes: [],
    children: [],
    start,
    end: start,
    nameStart: start,
    openTagEnd: start,
    selfClosing: false,
    text: ''
  };
}

/** Decodes the predefined XML entities and numeric character references. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_m, ent: string) => {
    switch (ent) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return '\'';
      default:
        if (ent.startsWith('#x')) { return String.fromCodePoint(parseInt(ent.slice(2), 16)); }
        return String.fromCodePoint(parseInt(ent.slice(1), 10));
    }
  });
}

export function parseXml(src: string): XmlDocumentModel {
  const problems: XmlParseProblem[] = [];
  const topLevel: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const len = src.length;
  let i = 0;

  const append = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      topLevel.push(node);
    }
  };

  const readName = (from: number): number => {
    let j = from;
    if (j < len && NAME_START.test(src[j])) {
      j++;
      while (j < len && NAME_CHAR.test(src[j])) { j++; }
    }
    return j;
  };

  while (i < len) {
    const lt = src.indexOf('<', i);

    // ---- text between markup -------------------------------------------------
    const textEnd = lt === -1 ? len : lt;
    if (textEnd > i) {
      const raw = src.slice(i, textEnd);
      if (raw.trim().length > 0) {
        const node = makeNode('text', i);
        node.end = textEnd;
        node.text = decodeEntities(raw);
        append(node);
      }
      i = textEnd;
    }
    if (lt === -1) { break; }

    // ---- comment -------------------------------------------------------------
    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      const end = close === -1 ? len : close + 3;
      const node = makeNode('comment', i);
      node.text = src.slice(i + 4, close === -1 ? len : close);
      node.end = end;
      if (close === -1) { problems.push({ message: 'Unterminated comment', start: i, end }); }
      append(node);
      i = end;
      continue;
    }

    // ---- CDATA ---------------------------------------------------------------
    if (src.startsWith('<![CDATA[', i)) {
      const close = src.indexOf(']]>', i + 9);
      const end = close === -1 ? len : close + 3;
      const node = makeNode('cdata', i);
      node.text = src.slice(i + 9, close === -1 ? len : close);
      node.end = end;
      if (close === -1) { problems.push({ message: 'Unterminated CDATA section', start: i, end }); }
      append(node);
      i = end;
      continue;
    }

    // ---- DOCTYPE (may contain an internal subset in [...]) -------------------
    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {
      let j = i + 9;
      let depth = 0;
      let quote = '';
      while (j < len) {
        const c = src[j];
        if (quote) { if (c === quote) { quote = ''; } }
        else if (c === '"' || c === '\'') { quote = c; }
        else if (c === '[') { depth++; }
        else if (c === ']') { depth--; }
        else if (c === '>' && depth <= 0) { break; }
        j++;
      }
      const end = Math.min(j + 1, len);
      const node = makeNode('doctype', i);
      node.text = src.slice(i + 9, j).trim();
      node.name = node.text.split(/\s+/)[0] ?? '';
      node.end = end;
      append(node);
      i = end;
      continue;
    }

    // ---- processing instruction (<?xml ...?>) --------------------------------
    if (src.startsWith('<?', i)) {
      const close = src.indexOf('?>', i + 2);
      const end = close === -1 ? len : close + 2;
      const node = makeNode('pi', i);
      const body = src.slice(i + 2, close === -1 ? len : close);
      node.name = body.split(/\s+/)[0] ?? '';
      node.text = body.slice(node.name.length).trim();
      node.end = end;
      append(node);
      i = end;
      continue;
    }

    // ---- closing tag ---------------------------------------------------------
    if (src.startsWith('</', i)) {
      const nameEnd = readName(i + 2);
      const name = src.slice(i + 2, nameEnd);
      const gt = src.indexOf('>', nameEnd);
      const end = gt === -1 ? len : gt + 1;

      let match = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) { match = k; break; }
      }
      if (match === -1) {
        problems.push({ message: `Closing tag </${name}> has no matching opening tag`, start: i, end });
      } else {
        // Everything above the match was never closed.
        while (stack.length - 1 > match) {
          const open = stack.pop()!;
          open.unclosed = true;
          open.end = i;
          problems.push({ message: `<${open.name}> is not closed`, start: open.start, end: open.openTagEnd });
        }
        const node = stack.pop()!;
        node.end = end;
      }
      i = end;
      continue;
    }

    // ---- opening tag ---------------------------------------------------------
    if (i + 1 < len && NAME_START.test(src[i + 1])) {
      const node = makeNode('element', i);
      node.nameStart = i + 1;
      const nameEnd = readName(i + 1);
      node.name = src.slice(i + 1, nameEnd);
      let j = nameEnd;
      let closed = false;

      while (j < len) {
        // skip whitespace
        while (j < len && /\s/.test(src[j])) { j++; }
        if (j >= len) { break; }
        if (src[j] === '>') { j++; closed = true; break; }
        if (src[j] === '/' && src[j + 1] === '>') { j += 2; closed = true; node.selfClosing = true; break; }
        if (src[j] === '<') { break; } // malformed: a new tag started before this one ended

        const attrStart = j;
        const attrNameEnd = readName(j);
        if (attrNameEnd === j) { j++; continue; } // junk character, skip it
        const attrName = src.slice(j, attrNameEnd);
        j = attrNameEnd;
        while (j < len && /\s/.test(src[j])) { j++; }
        let value = '';
        if (src[j] === '=') {
          j++;
          while (j < len && /\s/.test(src[j])) { j++; }
          const q = src[j];
          if (q === '"' || q === '\'') {
            const qEnd = src.indexOf(q, j + 1);
            const vEnd = qEnd === -1 ? len : qEnd;
            value = src.slice(j + 1, vEnd);
            j = qEnd === -1 ? len : qEnd + 1;
          } else {
            const vStart = j;
            while (j < len && !/[\s>]/.test(src[j]) && !(src[j] === '/' && src[j + 1] === '>')) { j++; }
            value = src.slice(vStart, j);
          }
        }
        node.attributes.push({ name: attrName, value: decodeEntities(value), start: attrStart, end: j });
      }

      node.openTagEnd = j;
      if (!closed) {
        problems.push({ message: `Opening tag <${node.name}> is not terminated with '>'`, start: i, end: j });
      }
      append(node);
      if (node.selfClosing || !closed) {
        node.end = j;
      } else {
        stack.push(node);
      }
      i = j;
      continue;
    }

    // A '<' that starts nothing we recognise: treat as text.
    problems.push({ message: `Unexpected '<'`, start: i, end: i + 1 });
    i++;
  }

  while (stack.length > 0) {
    const open = stack.pop()!;
    open.unclosed = true;
    open.end = len;
    problems.push({ message: `<${open.name}> is not closed`, start: open.start, end: open.openTagEnd });
  }

  return {
    nodes: topLevel,
    root: topLevel.find(n => n.kind === 'element'),
    problems,
    length: len
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getAttr(node: XmlNode, name: string): string | undefined {
  return node.attributes.find(a => a.name === name)?.value;
}

/** Depth-first walk over every node. Return false from the visitor to skip children. */
export function walk(nodes: XmlNode[], visit: (n: XmlNode) => boolean | void): void {
  for (const n of nodes) {
    if (visit(n) !== false) { walk(n.children, visit); }
  }
}

/** Returns the deepest node whose range contains the given offset. */
export function findNodeAt(nodes: XmlNode[], offset: number): XmlNode | undefined {
  for (const n of nodes) {
    if (offset >= n.start && offset < n.end) {
      return findNodeAt(n.children, offset) ?? n;
    }
  }
  return undefined;
}

/** A readable path like Workflow[name=X]/Step[name=Y]/Arg[name=Z]. */
export function nodePath(node: XmlNode): string {
  const parts: string[] = [];
  let cur: XmlNode | undefined = node;
  while (cur) {
    if (cur.kind === 'element') {
      const id = getAttr(cur, 'name') ?? getAttr(cur, 'key');
      const idAttr = getAttr(cur, 'name') !== undefined ? 'name' : 'key';
      parts.unshift(id !== undefined ? `${cur.name}[${idAttr}=${id}]` : cur.name);
    } else if (cur.kind === 'cdata') {
      parts.unshift('#cdata');
    } else if (cur.kind === 'text') {
      parts.unshift('#text');
    }
    cur = cur.parent;
  }
  return parts.join('/');
}
