/**
 * A fake Roam backend, installed by patching `globalThis.fetch`.
 *
 * Loaded with `node --import ./test/fake-roam-backend.mjs build/index.js` so it
 * is in place before the server initialises any graph. The Roam SDK reaches the
 * network through exactly one path — `fetch(request)` against
 * https://api.roamresearch.com — so intercepting that gives the real server a
 * real graph connection whose backend happens to be this fixture.
 *
 * WHY NOT MOCK THE OPERATION CLASSES: because that is precisely the gap that
 * let the hide filter ship broken. Unit tests proved `pruneHiddenBlocks` worked
 * and proved the schemas carried annotations; nothing proved a `tools/call`
 * reached either one. This fixture keeps the whole stack — HTTP transport, MCP
 * routing, graph resolution, operation classes, SDK — and fakes only the wire.
 *
 * Queries are dispatched by matching distinctive substrings of the Datalog,
 * which is brittle by nature. That is deliberate: if a read path changes its
 * query shape, this returns nothing and the test fails loudly rather than
 * quietly passing against a mock that was updated in lockstep.
 */

/** title -> page uid. UIDs are 9 chars, like Roam's. */
const PAGES = {
  'Test Page': 'page00001',
  'roam/agent guidelines': 'guide0001',
  'Nested Page': 'page00002',
};

/**
 * Blocks per page, in the exact tuple shape the page-content query returns:
 * [uid, string, order, parentUid].
 *
 * The fixture is built around the hide filter: two genuinely tagged subtrees,
 * two near-miss tags that must survive, and visible blocks either side so a
 * filter that drops too much is as visible as one that drops too little.
 */
const BLOCKS = {
  page00001: [
    ['vis000001', 'First visible block', 0, 'page00001'],
    ['hid000001', 'Secret plans #.rm-hide', 1, 'page00001'],
    ['hidchild1', 'Nested under the hidden block', 0, 'hid000001'],
    ['hidgrand1', 'Two levels under the hidden block', 0, 'hidchild1'],
    ['prv000001', 'Private note [[.rm-private]]', 2, 'page00001'],
    ['prvchild1', 'Nested under the private block', 0, 'prv000001'],
    ['near00001', 'Near miss, must stay #.rm-hidden', 3, 'page00001'],
    ['near00002', 'Other near miss, must stay #.rm-highlight', 4, 'page00001'],
    ['vis000002', 'Second visible block', 5, 'page00001'],
    ['vischild1', 'Visible child of a visible block', 0, 'vis000002'],
    // Longer than the 80-char preview cut in the `structure` format, so a test
    // can watch the truncation markers appear. The tail is what must NOT come
    // back in a preview, and it is unique so a test can prove that.
    [
      'long00001',
      'This block runs past the eighty character preview boundary on purpose, and here is the TAIL_MARKER that only the full read returns.',
      6,
      'page00001',
    ],
    // A soft line break: ONE block whose string contains a newline. Rendering
    // this without escaping is what flattens the page.
    ['soft00001', 'Soft break one\nSoft break two', 7, 'page00001'],
  ],
  guide0001: [
    ['gblock001', 'Tag every book page with Type:: Book', 0, 'guide0001'],
    ['gblock002', 'Paths like C:\\newdir stays as typed', 1, 'guide0001'],
  ],
  page00002: [
    ['nst000001', 'Project Alpha', 0, 'page00002'],
    ['nst000002', 'Research', 0, 'nst000001'],
    ['nst000003', 'Line one\nLine two', 0, 'nst000002'],
    ['nst000004', 'grandchild under the multi-line block', 0, 'nst000003'],
    ['nst000005', 'sibling after the multi-line block', 1, 'nst000002'],
    ['nst000006', '[[>]] [[!TIP]] Heads up\nCallout body', 2, 'nst000002'],
    ['nst000007', 'after the callout', 3, 'nst000002'],
    ['nst000008', 'Timeline', 1, 'nst000001'],
    ['nst000009', 'Q1 kickoff', 0, 'nst000008'],
    // Revision 2 acceptance fixtures: hostile shapes that Revision 1 destroyed.
    // A real backslash (not an escape) before "nabla" and "newdir" -- in this
    // .mjs string literal, '\\n' is the two characters backslash-n, matching
    // the LaTeX gradient operator and a Windows path, neither of which is a
    // line break.
    ['nst000010', 'LaTeX $$\\nabla f$$ and a path C:\\newdir', 2, 'nst000001'],
    ['nst000011', 'wrap it in ``` to make code', 3, 'nst000001'],
  ],
};

/**
 * Referring blocks (backlinks) to a page, as
 * [block_uid, block_str, source_page_title, source_page_uid] -- the exact
 * tuple shape `FullPageViewOperations.fetchReferringBlocks` (see
 * src/tools/operations/full-page-view.ts) queries for via `:block/refs`.
 *
 * Hardcoded rather than derived from `[[...]]` syntax in BLOCKS: this fixture
 * does not parse Roam reference syntax into `:block/refs`, so a query that
 * relies on that link has nothing to answer from BLOCKS alone. One block, with
 * a real embedded newline, is enough to prove the linked-reference render path
 * escapes it like every other block string in that file.
 */
const REFERRING_BLOCKS = {
  'Nested Page': [
    ['linkref01', 'See [[Nested Page]] for the plan\nand a second line', 'Test Page', 'page00001'],
  ],
};

/**
 * Blocks actually written during a test run, as [uid, string, order, parentUid].
 * Populated by the `/write` handler below as `create-block` actions land.
 *
 * This does NOT contradict "block contents are not modelled" above — that
 * remains true for every read path except the one narrow query this exists
 * for: `roam_create_outline`'s post-write verification
 * (`OutlineOperations.findBlockWithRetry`, see the `:find ?b-uid ?order`
 * branch in `answer()`). Without it that query always answers `[]`, so
 * `created_blocks` in the tool's response is always empty regardless of what
 * was actually written — which means a regression that silently merges two
 * blocks into one (e.g. a broken fence guard swallowing a sibling) produces
 * the exact same "empty created_blocks" response as correct behavior. A test
 * asserting a block count needs this to be real.
 */
const CREATED_BLOCKS = [];
let createdBlockOrder = 0;

const HIDE_TAG = /(?:#\[\[|\[\[)\.rm-(?:hide|private)\]\]|#\.rm-(?:hide|private)(?![\w-])/i;

const allBlocks = () => Object.values(BLOCKS).flat();

/** Blocks whose own text carries a genuine hide tag. */
const hiddenRoots = () => allBlocks().filter(([, str]) => HIDE_TAG.test(str));

/** Every descendant of a hidden root, as [rootText, descendantUid] pairs. */
function hiddenDescendantPairs() {
  const pairs = [];
  for (const [rootUid, rootStr] of hiddenRoots()) {
    const stack = [rootUid];
    while (stack.length) {
      const parent = stack.pop();
      for (const [uid, , , parentUid] of allBlocks()) {
        if (parentUid === parent) {
          pairs.push([rootStr, uid]);
          stack.push(uid);
        }
      }
    }
  }
  return pairs;
}

/**
 * Answer a Datalog query with fixture data.
 * Returns whatever belongs under `{result: ...}`.
 */
/**
 * The nested `(pull ...)` shape `roam_update_page_markdown` diffs against,
 * built from the same flat fixture the other reads use.
 *
 * This one matters more than it looks: the diff deletes whatever its baseline
 * contains and the submitted markdown does not. Without this handler the query
 * falls through to `[]`, the diff sees an empty page, and a test asserting
 * "hidden blocks are not deleted" passes because NOTHING is deleted. The
 * fixture has to hold real blocks for that assertion to mean anything.
 */
function pullTree(uid) {
  const children = allBlocks()
    .filter(([, , , parentUid]) => parentUid === uid)
    .sort((a, b) => a[2] - b[2])
    .map(([childUid, str, order]) => {
      const node = {
        ':block/uid': childUid,
        ':block/string': str,
        ':block/order': order,
      };
      const grandchildren = pullTree(childUid);
      if (grandchildren.length > 0) node[':block/children'] = grandchildren;
      return node;
    });
  return children;
}

function answer(query, args) {
  // Page-content query: [uid, string, order, parentUid] for everything on a page.
  if (query.includes(':find ?block-uid ?block-str ?order ?parent-uid')) {
    const pageUid = args?.[1];
    return BLOCKS[pageUid] ?? [];
  }

  // The diff baseline: a scalar `(pull ?page [... {:block/children ...}])`
  // keyed by a page uid inlined in the query text rather than bound via :in.
  if (query.includes('(pull ?page') && query.includes(':block/children')) {
    const pageUid = query.match(/:block\/uid "([^"]+)"/)?.[1];
    if (!pageUid || !BLOCKS[pageUid]) return null;
    return { ':block/uid': pageUid, ':block/children': pullTree(pageUid) };
  }

  // Heading levels. Nothing in the fixture carries one.
  if (query.includes(':find ?block-uid ?heading')) {
    return [];
  }

  // Hidden-root candidates, as collectHiddenUids asks for them.
  if (query.includes('.rm-hide') && query.includes(':find ?uid ?s')) {
    return hiddenRoots().map(([uid, str]) => [uid, str]);
  }

  // Hidden-descendant pairs.
  if (query.includes('.rm-hide') && query.includes(':find ?hs ?uid')) {
    return hiddenDescendantPairs();
  }

  // roam_create_outline's post-write verification: does the given page/parent
  // already contain a block with this exact string? (OutlineOperations.
  // findBlockWithRetry — `:find ?b-uid ?order` is distinctive to that one
  // query.) Answered from CREATED_BLOCKS, which the /write handler populates
  // as create-block actions land, rather than the fixture's usual honest `[]`
  // for reads against unmodelled content: this is the one path a test needs
  // to observe what was actually written, to catch content ending up merged
  // into the wrong block.
  if (query.includes(':find ?b-uid ?order')) {
    const pageUid = query.match(/:block\/uid "([^"]*)"/)?.[1];
    const blockString = query.match(/:block\/string "([^"]*)"/)?.[1];
    if (pageUid === undefined || blockString === undefined) return [];
    return CREATED_BLOCKS
      .filter(([, str, , parentUid]) => parentUid === pageUid && str === blockString)
      .map(([uid, , order]) => [uid, order]);
  }

  // roam_create_outline's second post-write step, fetchBlockWithChildren's
  // own-string lookup by UID (`:find ?string ... :in $ ?uid`, no other
  // find-vars — distinct from block-retrieval.ts's `?string ?order ?heading`
  // and memory.ts's `?string ?time ?uid`, which carry extra find-vars before
  // `:in`). A block found via the branch above still needs to answer this
  // one before roam_create_outline reports it in `created_blocks`.
  if (/:find \?string\s*:in \$ \?uid\b/.test(query)) {
    const uid = args?.[0];
    const match = CREATED_BLOCKS.find(([blockUid]) => blockUid === uid);
    return match ? [[match[1]]] : [];
  }

  // fetchReferringBlocks: backlinks to a page, via `:block/refs`. Distinctive
  // find-vars combo (`?block-uid ?block-str ?page-title ?page-uid`) so this is
  // checked BEFORE the generic `:node/title` branch below -- the query also
  // contains `:node/title` twice (target page and source page lookups inside
  // the `:where` clause), and without this branch ahead of it, the query fell
  // into that branch instead and every linked-reference block rendered as
  // `undefined`.
  if (query.includes(':find ?block-uid ?block-str ?page-title ?page-uid')) {
    const targetTitle = args?.[0];
    return REFERRING_BLOCKS[targetTitle] ?? [];
  }

  // Page lookup by title. `:find ?uid .` is a scalar find — return the bare uid.
  if (query.includes(':node/title')) {
    const titles = [...query.matchAll(/:node\/title "([^"]*)"/g)].map((m) => m[1]);
    const bound = typeof args?.[0] === 'string' ? [args[0]] : [];
    for (const title of [...titles, ...bound]) {
      if (PAGES[title]) {
        return query.includes(':find ?uid .') ? PAGES[title] : [[PAGES[title]]];
      }
    }
    return query.includes(':find ?uid .') ? null : [];
  }

  // Anything else — block-ref resolution, backlinks, searches we have not
  // fixtured. An empty result is the honest answer for an empty fixture.
  return [];
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function fakeRoamFetch(input, init) {
  const request = input instanceof Request ? input : new Request(input, init);

  if (!request.url.startsWith('https://api.roamresearch.com/')) {
    return realFetch(input, init);
  }

  const json = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  if (request.url.endsWith('/q')) {
    const { query, args } = await request.json();
    return json({ result: answer(query, args) });
  }

  if (request.url.endsWith('/pull')) {
    return json({ result: null });
  }

  if (request.url.endsWith('/write')) {
    const body = await request.json().catch(() => ({}));

    // Register created pages so a later title lookup finds them. Write paths
    // that create a page and then read back its UID (getOrCreateTodayPage, for
    // one) deadlock against a backend that forgets — and a daily-note title is
    // today's date, so it cannot be fixtured up front.
    if (body?.action === 'create-page' && body?.page?.title) {
      PAGES[body.page.title] ??= `p${String(Object.keys(PAGES).length).padStart(8, '0')}`;
      BLOCKS[PAGES[body.page.title]] ??= [];
    }

    // Track create-block actions (bare, or bundled in a batch-actions call)
    // so the one verification query that needs them (see the `:find ?b-uid
    // ?order` branch in `answer()`) can find what was actually written.
    const writtenActions = body?.action === 'batch-actions' ? (body.actions ?? [])
      : body?.action === 'create-block' ? [body]
      : [];
    for (const action of writtenActions) {
      if (action?.action !== 'create-block') continue;
      const parentUid = action.location?.['parent-uid'];
      const uid = action.block?.uid;
      const str = action.block?.string;
      if (parentUid && uid && str !== undefined) {
        CREATED_BLOCKS.push([uid, str, createdBlockOrder++, parentUid]);
      }
    }

    // Beyond that narrow tracking, block contents are not modelled: these
    // tests assert on what a caller gets back from a write, not on what the
    // graph then looks like.
    return json({ success: true });
  }

  return new Response('fake backend: unhandled endpoint', { status: 404 });
};
