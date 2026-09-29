import { describe, it, expect } from 'vitest';
import { classifyRef, parseUidFlag } from './ref-classifier.js';

/**
 * `roam save --parent "((uid))"` used to strip the parens and then require a
 * digit before believing the value was a UID. Roughly one block UID in five has
 * no digit (21.6% measured on a 209k-block graph), so those were treated as
 * heading text: the CLI planted a block containing the literal `((uid))` on the
 * daily page and nested the content there. Exit 0, no warning.
 *
 * The classifier never looks at digits. It reports what the string's shape can
 * actually establish, and says `ambiguous` when the shape cannot decide.
 */
describe('classifyRef', () => {
  const cases: Array<[string, string, ReturnType<typeof classifyRef>]> = [
    ['wrapped, no digit', '((aBcDeFgHi))', { kind: 'uid', uid: 'aBcDeFgHi' }],
    ['wrapped, with digit', '((ujTvIoRP1))', { kind: 'uid', uid: 'ujTvIoRP1' }],
    ['wrapped, with _ and -', '((sRP_VPN-P))', { kind: 'uid', uid: 'sRP_VPN-P' }],
    ['bare, no digit', 'aBcDeFgHi', { kind: 'ambiguous', value: 'aBcDeFgHi' }],
    ['bare, with digit', 'Sprint_23', { kind: 'ambiguous', value: 'Sprint_23' }],
    ['9-letter title (v2.15.1)', 'Learnings', { kind: 'ambiguous', value: 'Learnings' }],
    ['heading syntax', '## Heading', { kind: 'text', value: '## Heading' }],
    ['page link syntax', '[[Page]]', { kind: 'text', value: '[[Page]]' }],
    ['8 characters', 'abcdefgh', { kind: 'text', value: 'abcdefgh' }],
    ['10 characters', 'abcdefghij', { kind: 'text', value: 'abcdefghij' }],
    ['9 characters with a space', 'My Page 1', { kind: 'text', value: 'My Page 1' }],
    ['wrapped, inner not UID-shaped', '((not a uid))', { kind: 'text', value: '((not a uid))' }],
    ['wrapped, inner too short', '((abc))', { kind: 'text', value: '((abc))' }],
    ['half-open wrapper', '((aBcDeFgHi', { kind: 'text', value: '((aBcDeFgHi' }],
    ['ref inside longer text', 'see ((aBcDeFgHi))', { kind: 'text', value: 'see ((aBcDeFgHi))' }],
  ];

  it.each(cases)('%s: %s', (_label, raw, expected) => {
    expect(classifyRef(raw)).toEqual(expected);
  });

  it('never decides by digits: every wrapped UID-shaped value is a uid', () => {
    for (const uid of ['CYORomQDo', 'EWkeKCyRA', 'sRP_VPNMP', 'AeWmWosbT', 'saZxsp_dR', '123456789']) {
      expect(classifyRef(`((${uid}))`)).toEqual({ kind: 'uid', uid });
    }
  });
});

describe('parseUidFlag (--parent-uid)', () => {
  it('accepts a bare UID', () => {
    expect(parseUidFlag('aBcDeFgHi')).toBe('aBcDeFgHi');
  });

  it('accepts a wrapped UID', () => {
    expect(parseUidFlag('((aBcDeFgHi))')).toBe('aBcDeFgHi');
  });

  it.each(['## Notes', 'abc', 'abcdefghij', '((not a uid))', '((aBcDeFgHi', ''])(
    'rejects %j, which is not UID-shaped',
    (value) => {
      expect(() => parseUidFlag(value)).toThrow(/--parent-uid/);
    }
  );
});
