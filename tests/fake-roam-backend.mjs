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
  ],
  guide0001: [
    ['gblock001', 'Tag every book page with Type:: Book', 0, 'guide0001'],
  ],
};

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
function answer(query, args) {
  // Page-content query: [uid, string, order, parentUid] for everything on a page.
  if (query.includes(':find ?block-uid ?block-str ?order ?parent-uid')) {
    const pageUid = args?.[1];
    return BLOCKS[pageUid] ?? [];
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
    // Writes are not fixtured. Tests that reach here are asserting on the
    // guardrails in front of a write, not on the write itself.
    return json({ success: true });
  }

  return new Response('fake backend: unhandled endpoint', { status: 404 });
};
