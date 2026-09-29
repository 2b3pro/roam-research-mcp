/**
 * Resolve `roam save`'s `--parent-uid`, `--parent` and `--page` values to a
 * target, asking the graph only where shape cannot decide.
 *
 * The two parent flags never overlap: `--parent-uid` is always a UID and
 * `--parent` is always the text of the parent block, so `--parent "((uid))"`
 * means a block whose content is that reference.
 *
 * Nothing here writes. Callers resolve every reference before their first
 * write, so a reference that cannot be resolved leaves the graph untouched.
 */

import { classifyRef, parseUidFlag } from './ref-classifier.js';

/** Does any entity (block or page) in the graph have this :block/uid? */
export type UidExists = (uid: string) => Promise<boolean>;

export type ParentTarget =
  /** Nest under this block. */
  | { kind: 'uid'; uid: string }
  /** Nest under the block with this text on the target page (find or create). */
  | { kind: 'heading'; text: string };

export type PageTarget =
  | { kind: 'uid'; uid: string }
  /** Find or create the page with this title. */
  | { kind: 'title'; title: string };

export interface ParentOptions {
  parent?: string;
  parentUid?: string;
}

async function requireUid(uid: string, flag: string, exists: UidExists): Promise<string> {
  if (!(await exists(uid))) {
    throw new Error(`${flag}: no block or page with UID "${uid}" exists in this graph. Nothing was written.`);
  }
  return uid;
}

export async function resolveParentRef(
  options: ParentOptions,
  exists: UidExists
): Promise<ParentTarget | undefined> {
  const { parent, parentUid } = options;

  if (parent !== undefined && parentUid !== undefined) {
    throw new Error(
      'Use either --parent (the text of the parent block) or --parent-uid (its UID), not both.'
    );
  }

  if (parentUid !== undefined) {
    const uid = await requireUid(parseUidFlag(parentUid), '--parent-uid', exists);
    return { kind: 'uid', uid };
  }

  if (parent === undefined) return undefined;

  return { kind: 'heading', text: parent };
}

export async function resolvePageRef(page: string, exists: UidExists): Promise<PageTarget> {
  const ref = classifyRef(page);
  switch (ref.kind) {
    case 'uid':
      return { kind: 'uid', uid: await requireUid(ref.uid, '--page', exists) };
    case 'ambiguous':
      return (await exists(ref.value))
        ? { kind: 'uid', uid: ref.value }
        : { kind: 'title', title: ref.value };
    case 'text':
      return { kind: 'title', title: ref.value };
  }
}
