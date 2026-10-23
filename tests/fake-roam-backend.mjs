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

import { appendFileSync } from 'node:fs';

/** title -> page uid. UIDs are 9 chars, like Roam's. */
const PAGES = {
  'Test Page': 'page00001',
  'roam/agent guidelines': 'guide0001',
  'Nested Page': 'page00002',
  // Digit-free on purpose, like roughly one real UID in five. `roam save` used
  // to decide "is this a UID" by looking for a digit.
  'Save Fixture': 'savePgAbc',
  // Two pages so a page-scoped status search has something to leave out.
  'Status Fixture': 'statusPg1',
  'Status Other': 'statusPg2',
  // Titles that must survive being written into a query literal. A raw `"`
  // ends the literal early; a raw `\n` reads back as a newline, so the lookup
  // silently misses rather than failing.
  'Alex "Sandy" Pentland': 'quotePg01',
  'C:\\newdir Notes': 'bslashPg1',
  'Search Fixture': 'searchPg1',
  'Pagination Fixture': 'pagingPg1',
  PagingTag: 'pagingTg1',
  OtherPagingTag: 'pagingTg2',
  'Paging/Zebra': 'pagingPgZ',
  'Paging/Apple': 'pagingPgA',
  'Paging/Middle': 'pagingPgM',
  aPiTag: 'mixedTag1',
  aPiTagExtra: 'mixedTag2',
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
  savePgAbc: [
    ['nodigitAA', 'A parent block whose UID has no digit', 0, 'savePgAbc'],
    ['exHeadAbc', 'Existing heading', 1, 'savePgAbc'],
    // A block whose content is a reference to another block, which is what
    // `roam save --parent "((uid))"` finds or creates.
    ['exRefAbcd', '((exHeadAbc))', 2, 'savePgAbc'],
  ],
  // Status markers in both spellings. `{{[[TODO]]}}` is what Roam's checkbox
  // writes and does not contain `{{TODO`, which is how roam_search_by_status
  // went years returning only the rare bare form.
  statusPg1: [
    ['stBrkTodo', '{{[[TODO]]}} bracketed task', 0, 'statusPg1'],
    ['stBareTod', '{{TODO}} bare task', 1, 'statusPg1'],
    ['stBrkDone', '{{[[DONE]]}} bracketed finished', 2, 'statusPg1'],
    ['stBareDon', '{{DONE}} bare finished', 3, 'statusPg1'],
    ['stHidTodo', '{{[[TODO]]}} withheld task #.rm-hide', 4, 'statusPg1'],
    // The word alone is not a marker, in either spelling.
    ['stPlain01', 'mentions TODO and DONE in prose, not a task', 5, 'statusPg1'],
  ],
  statusPg2: [
    ['stOthTodo', '{{[[TODO]]}} task on another page', 0, 'statusPg2'],
  ],
  quotePg01: [
    ['quoteBlk1', 'Said "never again" and meant it', 0, 'quotePg01'],
  ],
  bslashPg1: [
    ['bslashBk1', 'Notes kept under a Windows path', 0, 'bslashPg1'],
  ],
  searchPg1: [
    ['caseMix01', 'An aPi client', 0, 'searchPg1'],
    ['caseLow01', 'An api client', 1, 'searchPg1'],
    ['caseUni01', 'An ÄpI client', 2, 'searchPg1'],
    ['caseLit01', 'a.B[0] "Quoted" C:\\newdir', 3, 'searchPg1'],
    ['caseDec01', 'axb0 Quoted C:newdir', 4, 'searchPg1'],
    ['caseDate1', '2026-10-01', 5, 'searchPg1'],
    ['caseTag01', 'Tagged [[aPiTag]]', 6, 'searchPg1'],
    ['caseTag02', 'Tagged [[aPiTagExtra]]', 7, 'searchPg1'],
  ],
};

BLOCKS.pagingPg1 = [
  ['pag000000', 'paging item [[PagingTag]] #.rm-hide', 0, 'pagingPg1'],
  ...Array.from({ length: 60 }, (_, i) => [
    `pag${String(i + 1).padStart(6, '0')}`,
    `paging item ${i + 1} [[PagingTag]]${i % 2 === 0 ? ' [[OtherPagingTag]]' : ''}`,
    i + 1, 'pagingPg1',
  ]),
  ['pag000061', 'paging item only second tag [[OtherPagingTag]]', 61, 'pagingPg1'],
];

// Independent datoms for search tests. Their dates deliberately disagree with
// block text, and a missing attribute stays missing (it is never "now").
const TIMES = {
  page00001: { create: Date.parse('2026-10-01T06:00:00-07:00'), edit: Date.parse('2026-10-02T06:00:00-07:00') },
  bslashPg1: { create: Date.parse('2026-09-01T12:00:00-07:00'), edit: Date.parse('2026-10-01T12:00:00-07:00') },
  vis000001: { create: Date.parse('2026-10-01T12:00:00-07:00'), edit: Date.parse('2026-10-02T12:00:00-07:00') },
  vis000002: { create: Date.parse('2026-09-01T12:00:00-07:00'), edit: Date.parse('2026-10-01T12:00:00-07:00') },
  long00001: { create: Date.parse('2026-10-01T23:59:59.999-07:00') },
  soft00001: { create: Date.parse('2026-10-02T00:00:00-07:00') },
  near00001: { create: Date.parse('2026-10-01T09:00:00-07:00'), edit: Date.parse('2026-10-01T10:00:00-07:00') },
  hid000001: { create: Date.parse('2026-10-01T12:00:00-07:00') },
  hidchild1: { create: Date.parse('2026-10-01T12:00:00-07:00') },
  caseDate1: { create: Date.parse('2026-09-01T12:00:00-07:00') },
  caseMix01: { create: Date.parse('2026-03-08T23:59:59.999-07:00') },
  caseLow01: { create: Date.parse('2026-03-09T00:00:00-07:00') },
};
const BLOCK_TAGS = { caseTag01: ['aPiTag'], caseTag02: ['aPiTagExtra'],
  ...Object.fromEntries(BLOCKS.pagingPg1.map(([uid, text]) => [uid,
    ['PagingTag', 'OtherPagingTag'].filter(tag => text.includes(`[[${tag}]]`))])),
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

/**
 * Thrown for query text Roam would refuse. The `/q` handler turns it into the
 * HTTP 500 Roam sends, which the SDK reports as `Error: <message>`.
 */
class RoamQueryError extends Error {}

const EDN_ESCAPES = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/**
 * Read the EDN string literal whose opening quote is at `start`.
 * Returns its decoded value and the index just past its closing quote.
 */
function readEdnString(query, start) {
  let value = '';
  for (let i = start + 1; i < query.length; i++) {
    const ch = query[i];
    if (ch === '"') return { value, end: i + 1 };
    if (ch !== '\\') {
      value += ch;
      continue;
    }
    const next = query[++i];
    if (!(next in EDN_ESCAPES)) {
      throw new RoamQueryError(`java.lang.RuntimeException: Unsupported escape character: \\${next}`);
    }
    value += EDN_ESCAPES[next];
  }
  throw new RoamQueryError('java.lang.RuntimeException: EOF while reading string');
}

/** Index just past the closing quote of the regex literal opening at `start`. */
function readRegexLiteral(query, start) {
  for (let i = start + 1; i < query.length; i++) {
    if (query[i] === '\\') i++;
    else if (query[i] === '"') return i + 1;
  }
  throw new RoamQueryError('java.lang.RuntimeException: EOF while reading regex');
}

/**
 * Refuse a query whose string literals do not read cleanly, as Roam does.
 *
 * A value interpolated without escaping leaves a literal butted against the
 * next token: `"Alex "Sandy" Pentland"` reads as `"Alex "`, `Sandy`,
 * `" Pentland"`, a clause with too many parts, and Roam answers
 * IndexOutOfBoundsException. Every literal a well-formed query writes is
 * followed by whitespace or a closing bracket, so anything else is treated
 * the same way.
 */
function assertWellFormed(query) {
  for (let i = 0; i < query.length; i++) {
    if (query[i] !== '"') continue;
    // A regex literal `#"..."` passes every escape through to the pattern.
    const end = query[i - 1] === '#' ? readRegexLiteral(query, i) : readEdnString(query, i).end;
    if (end < query.length && !/[\s\])]/.test(query[end])) {
      throw new RoamQueryError('java.lang.IndexOutOfBoundsException');
    }
    i = end - 1;
  }
}

/** Decoded values of every string literal that directly follows `prefix`. */
function literalsAfter(query, prefix) {
  const values = [];
  for (let at = query.indexOf(prefix); at !== -1; at = query.indexOf(prefix, at + 1)) {
    const quote = at + prefix.length;
    if (query[quote] === '"') values.push(readEdnString(query, quote).value);
  }
  return values;
}

// Interpret the regex predicates the query actually uses, rather than assume
// that a bound pattern was applied. Java's (?iu) flags map to JS's /iu here.
function regexPredicate(query, variable) {
  for (const match of query.matchAll(/\[\(re-pattern /g)) {
    const { value, end } = readEdnString(query, match.index + match[0].length);
    const patternVar = query.slice(end).match(/^\)\s+(\?[\w-]+)\]/)?.[1];
    if (!patternVar) continue;
    const whole = query.includes(`[(re-matches ${patternVar} ${variable})]`);
    if (!whole && !query.includes(`[(re-find ${patternVar} ${variable})]`)) continue;
    const flags = value.startsWith('(?iu)') ? 'iu' : value.startsWith('(?i)') ? 'i' : '';
    const source = value.replace(/^\(\?iu?\)/, '');
    const regex = new RegExp(whole ? `^(?:${source})$` : source, flags);
    return (text) => regex.test(text);
  }
}

function answer(query, args) {
  assertWellFormed(query);

  if (query.includes(':find ?uid ?string ?order ?heading')) {
    const asked = new Set(args?.[0] ?? []);
    return allBlocks().filter(([uid]) => asked.has(uid)).map(([uid, text, order]) => [uid, text, order, 0]);
  }
  if (query.includes(':find ?uid ?string')) {
    const asked = new Set(args?.[0] ?? []);
    return allBlocks().filter(([uid]) => asked.has(uid)).map(([uid, text]) => [uid, text, 0]);
  }
  if (query.includes(':find ?parentUid ?childUid ?childString')) {
    const asked = new Set(args?.[0] ?? []);
    return allBlocks().filter(([, , , parent]) => asked.has(parent)).map(([uid, text, order, parent]) => [parent, uid, text, order, 0]);
  }

  // Existence check for a set of UIDs (`batchCheckExistence` in
  // src/shared/page-validator.ts): which of these are the :block/uid of any
  // entity? Pages carry :block/uid too, so they count. Every batch write asks
  // this about its parents before writing, and `roam save` asks it to decide
  // whether a bare 9-character value is a UID or text.
  if (query.includes(':in $ [?uid ...]')) {
    const asked = Array.isArray(args?.[0]) ? args[0] : [];
    const known = new Set([
      ...Object.values(PAGES),
      ...allBlocks().map(([uid]) => uid),
      ...CREATED_BLOCKS.map(([uid]) => uid),
    ]);
    return asked.filter((uid) => known.has(uid)).map((uid) => [uid]);
  }

  // `roam save --parent "<text>"`: a direct child of the page with exactly this
  // string (`findOrCreateHeading` in src/cli/commands/save.ts).
  if (query.includes(':in $ ?page-uid ?text')) {
    const [pageUid, text] = args ?? [];
    return [...allBlocks(), ...CREATED_BLOCKS]
      .filter(([, str, , parentUid]) => parentUid === pageUid && str === text)
      .map(([uid]) => [uid]);
  }

  // Page-content query: [uid, string, order, parentUid] for everything on a page.
  if (query.includes(':find ?block-uid ?block-str ?order ?parent-uid')) {
    const pageUid = args?.[1];
    return BLOCKS[pageUid] ?? [];
  }

  // The diff baseline: a scalar `(pull ?page [... {:block/children ...}])`
  // keyed by a page uid inlined in the query text rather than bound via :in.
  if (query.includes('(pull ?page') && query.includes(':block/children')) {
    const pageUid = literalsAfter(query, ':block/uid ')[0];
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
    const pageUid = literalsAfter(query, ':block/uid ')[0];
    const blockString = literalsAfter(query, ':block/string ')[0];
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

  // Timestamp search: evaluate the requested attributes and range against
  // fixture datoms. Pages have titles; blocks have strings and a page link.
  if (query.includes(':find ?uid ?content ?page-title ?time')) {
    const inputVars = (query.match(/:in \$([^:]*)/)?.[1] ?? '').match(/\?[\w-]+/g) ?? [];
    const bound = Object.fromEntries(inputVars.map((name, i) => [name, args?.[i]]));
    const attributes = [...query.matchAll(/\[\?e :(create|edit)\/time \?time\]/g)].map(m => m[1]);
    const comparisons = [...query.matchAll(/\[\((>=|>|<=|<) \?time (\?[\w-]+)\)\]/g)];
    const entities = query.includes('[?e :block/string ?content]')
      ? Object.entries(BLOCKS).flatMap(([pageUid, blocks]) => blocks.map(([uid, content]) =>
          [uid, content, Object.keys(PAGES).find(title => PAGES[title] === pageUid)]))
      : Object.entries(PAGES).map(([title, uid]) => [uid, title, title]);
    return entities.flatMap(([uid, content, title]) => attributes.flatMap(attribute => {
      const time = TIMES[uid]?.[attribute];
      const inRange = comparisons.every(([, op, variable]) => {
        const value = bound[variable];
        if (op === '>=') return time >= value;
        if (op === '>') return time > value;
        if (op === '<=') return time <= value;
        return time < value;
      });
      return typeof time === 'number' && inRange
        ? [[uid, content, title, time]] : [];
    }));
  }

  // roam_search_by_status (src/search/status-search.ts). Unlike the branches
  // above this one EVALUATES the query rather than recognising it: it reads
  // which `:in` variables the `includes?` clauses actually test `?block-str`
  // against, and matches only on those. Markers passed as inputs but never
  // used in a clause match nothing, so a query that binds both spellings and
  // tests one fails here the way it would against Roam. Text and tag searches
  // share the find-vars; evaluate their literal or regex predicates as well.
  if (query.includes(':find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time') ||
      (query.includes(':find (count ?b)') && query.includes('?block-str'))) {
    const inVars = (query.match(/:in \$([^:]*)/)?.[1] ?? '').match(/\?[\w-]+/g) ?? [];
    const bound = Object.fromEntries(inVars.map((name, i) => [name, args?.[i]]));
    const tested = [
      ...[...query.matchAll(/\[\(clojure\.string\/includes\? \?block-str (\?[\w-]+)\)\]/g)]
        .map((m) => bound[m[1]])
        .filter((marker) => typeof marker === 'string'),
      // roam_search_by_text inlines its term, once per case variation.
      ...literalsAfter(query, '[(clojure.string/includes? ?block-str '),
    ];
    const textPredicate = regexPredicate(query, '?block-str');
    const tagPredicate = regexPredicate(query, '?ref-page-title');
    const exactTags = literalsAfter(query, '[?ref-page :node/title ');
    if (tested.length > 0 || textPredicate || tagPredicate || exactTags.length > 0) {
      const titleOf = Object.fromEntries(Object.entries(PAGES).map(([title, uid]) => [uid, title]));
      const scope = bound['?page-uid'] ?? bound['?target-page-uid'];
      const rows = Object.entries(BLOCKS)
        .filter(([pageUid]) => scope === undefined || pageUid === scope)
        .flatMap(([pageUid, blocks]) =>
          blocks
            .filter(([uid, str]) => textPredicate ? textPredicate(str) :
              tagPredicate ? (BLOCK_TAGS[uid] ?? []).some(tagPredicate) :
              exactTags.length > 0 ? (BLOCK_TAGS[uid] ?? []).some(tag => exactTags.includes(tag)) :
              tested.some((marker) => str.includes(marker)))
            .map(([uid, str]) => [uid, str, titleOf[pageUid], TIMES[uid]?.create ?? 0, TIMES[uid]?.edit ?? 0])
        );
      return query.includes(':find (count ?b)') ? [[rows.length]] : rows;
    }
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

  // `SearchUtils.findPageByTitleOrUid`'s last resort, once the title lookups
  // have missed: is this value the UID of anything? The UID is inlined in the
  // query text rather than bound.
  const inlinedUid = /:find \?uid :where \[\?e :block\/uid "/.test(query)
    ? literalsAfter(query, ':block/uid ')[0]
    : undefined;
  if (inlinedUid !== undefined) {
    const known = [...Object.values(PAGES), ...allBlocks().map(([uid]) => uid)];
    return known.includes(inlinedUid) ? [[inlinedUid]] : [];
  }

  // Namespace discovery returns unsorted relation rows; callers must sort
  // before applying an offset (not page then sort that partial window).
  if (query.includes(':find ?title ?uid') && query.includes('starts-with?')) {
    const prefix = literalsAfter(query, '[(clojure.string/starts-with? ?title ')[0];
    return Object.entries(PAGES).filter(([title]) => title.startsWith(prefix)).map(([title, uid]) => [title, uid]);
  }

  // Page lookup by title. `:find ?uid .` is a scalar find — return the bare uid.
  if (query.includes(':node/title')) {
    const titles = literalsAfter(query, ':node/title ');
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
    if (process.env.FAKE_ROAM_QUERY_LOG) appendFileSync(process.env.FAKE_ROAM_QUERY_LOG, JSON.stringify({ query, args }) + '\n');
    try {
      return json({ result: answer(query, args) });
    } catch (error) {
      if (!(error instanceof RoamQueryError)) throw error;
      return new Response(JSON.stringify({ message: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (request.url.endsWith('/pull')) {
    return json({ result: null });
  }

  if (request.url.endsWith('/write')) {
    const body = await request.json().catch(() => ({}));

    // Opt-in record of every write, one JSON body per line. A CLI run is a
    // one-shot process, so its writes die with it unless they land on disk;
    // this is how a test proves "zero writes" rather than inferring it from an
    // exit code.
    if (process.env.FAKE_ROAM_WRITE_LOG) {
      appendFileSync(process.env.FAKE_ROAM_WRITE_LOG, JSON.stringify(body) + '\n');
    }

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
