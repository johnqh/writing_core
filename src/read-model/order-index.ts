interface Node {
  id: string;
  pos: string;
  priority: number;
  size: number;
  left: Node | null;
  right: Node | null;
}

const size = (n: Node | null) => (n ? n.size : 0);
const update = (n: Node) => {
  n.size = 1 + size(n.left) + size(n.right);
  return n;
};
const compare = (pos: string, id: string, n: Node) => (pos < n.pos ? -1 : pos > n.pos ? 1 : id < n.id ? -1 : id > n.id ? 1 : 0);

/** FNV-1a: deterministic priorities keep the tree shape identical across runs. */
function priority(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function split(n: Node | null, pos: string, id: string): [Node | null, Node | null] {
  if (!n) return [null, null];
  if (compare(pos, id, n) <= 0) {
    const [l, r] = split(n.left, pos, id);
    n.left = r;
    return [l, update(n)];
  }
  const [l, r] = split(n.right, pos, id);
  n.right = l;
  return [update(n), r];
}

function merge(a: Node | null, b: Node | null): Node | null {
  if (!a) return b;
  if (!b) return a;
  if (a.priority > b.priority) {
    a.right = merge(a.right, b);
    return update(a);
  }
  b.left = merge(a, b.left);
  return update(b);
}

function removeNode(n: Node | null, pos: string, id: string): Node | null {
  if (!n) return null;
  const c = compare(pos, id, n);
  if (c === 0) return merge(n.left, n.right);
  if (c < 0) n.left = removeNode(n.left, pos, id);
  else n.right = removeNode(n.right, pos, id);
  return update(n);
}

export class OrderIndex {
  private root: Node | null = null;
  private readonly posById = new Map<string, string>();

  get size(): number {
    return size(this.root);
  }

  upsert(id: string, pos: string): void {
    const old = this.posById.get(id);
    if (old === pos) return;
    if (old !== undefined) this.root = removeNode(this.root, old, id);
    const node: Node = { id, pos, priority: priority(id), size: 1, left: null, right: null };
    const [l, r] = split(this.root, pos, id);
    this.root = merge(merge(l, node), r);
    this.posById.set(id, pos);
  }

  remove(id: string): boolean {
    const pos = this.posById.get(id);
    if (pos === undefined) return false;
    this.root = removeNode(this.root, pos, id);
    this.posById.delete(id);
    return true;
  }

  indexOf(id: string): number {
    const pos = this.posById.get(id);
    if (pos === undefined) return -1;
    let n = this.root;
    let index = 0;
    while (n) {
      const c = compare(pos, id, n);
      if (c < 0) n = n.left;
      else if (c > 0) {
        index += size(n.left) + 1;
        n = n.right;
      } else return index + size(n.left);
    }
    return -1;
  }

  idAt(index: number): string | undefined {
    let n = this.root;
    let i = index;
    while (n) {
      const leftSize = size(n.left);
      if (i < leftSize) n = n.left;
      else if (i === leftSize) return n.id;
      else {
        i -= leftSize + 1;
        n = n.right;
      }
    }
    return undefined;
  }

  ids(from = 0, to = this.size): string[] {
    const out: string[] = [];
    const walk = (n: Node | null, offset: number) => {
      if (!n || offset >= to || offset + n.size <= from) return;
      walk(n.left, offset);
      const self = offset + size(n.left);
      if (self >= from && self < to) out.push(n.id);
      walk(n.right, self + 1);
    };
    walk(this.root, 0);
    return out;
  }
}
