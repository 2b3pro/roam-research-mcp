/**
 * Datalog Generator for Roam Query AST
 *
 * Converts parsed query nodes into Datalog WHERE clauses
 */

import type { QueryNode, DatalogClauses } from './types.js';
import { ednString } from '../shared/datalog.js';

export class DatalogGenerator {
  private refCounter: number = 0;
  private inputCounter: number = 0;

  /**
   * Generate Datalog clauses from a query AST
   */
  generate(node: QueryNode): DatalogClauses {
    this.refCounter = 0;
    this.inputCounter = 0;

    const clauses = this.generateNode(node, '?b');

    return {
      where: clauses.where,
      inputs: clauses.inputs,
      inputValues: clauses.inputValues
    };
  }

  private generateNode(
    node: QueryNode,
    blockVar: string
  ): DatalogClauses {
    switch (node.type) {
      case 'and':
        return this.generateAnd(node.children, blockVar);
      case 'or':
        return this.generateOr(node.children, blockVar);
      case 'not':
        return this.generateNot(node.child, blockVar);
      case 'between':
        return this.generateBetween(node.startDate, node.endDate, blockVar);
      case 'tag':
        return this.generateTag(node.value, blockVar);
      case 'block-ref':
        return this.generateBlockRef(node.uid, blockVar);
      case 'search':
        return this.generateSearch(node.text, blockVar);
      case 'daily-notes':
        return this.generateDailyNotes(blockVar);
      case 'by':
        return this.generateBy(node.user, blockVar);
      case 'created-by':
        return this.generateCreatedBy(node.user, blockVar);
      case 'edited-by':
        return this.generateEditedBy(node.user, blockVar);
    }
  }

  private generateAnd(children: QueryNode[], blockVar: string): DatalogClauses {
    const where: string[] = [];
    const inputs: string[] = [];
    const inputValues: (string | number)[] = [];

    for (const child of children) {
      const childClauses = this.generateNode(child, blockVar);
      where.push(...childClauses.where);
      inputs.push(...childClauses.inputs);
      inputValues.push(...childClauses.inputValues);
    }

    return { where, inputs, inputValues };
  }

  private generateOr(children: QueryNode[], blockVar: string): DatalogClauses {
    const inputs: string[] = [];
    const inputValues: (string | number)[] = [];

    // For OR, we need to wrap each child's clauses in (or-join ...)
    // to properly scope the variable bindings
    const orBranches: string[] = [];

    for (const child of children) {
      const childClauses = this.generateNode(child, blockVar);
      inputs.push(...childClauses.inputs);
      inputValues.push(...childClauses.inputValues);

      // Wrap multiple clauses in (and ...)
      if (childClauses.where.length === 1) {
        orBranches.push(childClauses.where[0]);
      } else {
        orBranches.push(`(and ${childClauses.where.join(' ')})`);
      }
    }

    const orClause = `(or-join [${blockVar}] ${orBranches.join(' ')})`;

    return { where: [orClause], inputs, inputValues };
  }

  private generateNot(child: QueryNode, blockVar: string): DatalogClauses {
    const childClauses = this.generateNode(child, blockVar);

    // Wrap the child clauses in (not ...)
    const notContent = childClauses.where.length === 1
      ? childClauses.where[0]
      : `(and ${childClauses.where.join(' ')})`;

    const notClause = `(not ${notContent})`;

    return {
      where: [notClause],
      inputs: childClauses.inputs,
      inputValues: childClauses.inputValues
    };
  }

  private generateBetween(
    startDate: string,
    endDate: string,
    blockVar: string
  ): DatalogClauses {
    // between matches blocks on daily pages within the date range
    // or blocks with :create/time in the range

    const startVar = `?start-date-${this.inputCounter++}`;
    const endVar = `?end-date-${this.inputCounter++}`;

    // Convert Roam date format to timestamp for comparison
    // This assumes dates are in "January 1st, 2026" format
    const startTs = this.roamDateToTimestamp(startDate);
    const endTs = this.roamDateToTimestamp(endDate) + (24 * 60 * 60 * 1000 - 1); // End of day

    const where = [
      `[${blockVar} :create/time ?create-time]`,
      `[(>= ?create-time ${startVar})]`,
      `[(<= ?create-time ${endVar})]`
    ];

    return {
      where,
      inputs: [startVar, endVar],
      inputValues: [startTs, endTs]
    };
  }

  private generateTag(tagName: string, blockVar: string): DatalogClauses {
    const refVar = `?ref-${this.refCounter++}`;

    // A tag reference means the block has :block/refs pointing to a page with that title
    const where = [
      `[${refVar} :node/title ${ednString(tagName)}]`,
      `[${blockVar} :block/refs ${refVar}]`
    ];

    return { where, inputs: [], inputValues: [] };
  }

  private generateBlockRef(uid: string, blockVar: string): DatalogClauses {
    // Block ref means block references another block via ((uid)) syntax
    // This can be through :block/refs or embedded in the string
    const refVar = `?block-ref-${this.refCounter++}`;

    const where = [
      `[${refVar} :block/uid ${ednString(uid)}]`,
      `[${blockVar} :block/refs ${refVar}]`
    ];

    return { where, inputs: [], inputValues: [] };
  }

  private generateSearch(text: string, blockVar: string): DatalogClauses {
    // Search uses clojure.string/includes? to find text in block content
    const where = [
      `[(clojure.string/includes? ?block-str ${ednString(text)})]`
    ];

    return { where, inputs: [], inputValues: [] };
  }

  private generateDailyNotes(blockVar: string): DatalogClauses {
    // Daily notes pages have titles matching the date pattern
    // "January 1st, 2026" format - we use regex matching
    const where = [
      `[${blockVar} :block/page ?daily-page]`,
      `[?daily-page :node/title ?daily-title]`,
      `[(re-find #"^(January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}(st|nd|rd|th), \\d{4}$" ?daily-title)]`
    ];

    return { where, inputs: [], inputValues: [] };
  }

  private generateBy(user: string, blockVar: string): DatalogClauses {
    // "by" matches blocks created OR edited by the user
    // Uses or-join to match either condition
    const where = [
      `(or-join [${blockVar}]
        (and [${blockVar} :create/user ?by-creator]
             [?by-creator :user/display-name ${ednString(user)}])
        (and [${blockVar} :edit/user ?by-editor]
             [?by-editor :user/display-name ${ednString(user)}]))`
    ];

    return { where, inputs: [], inputValues: [] };
  }

  private generateUserClause(
    user: string,
    blockVar: string,
    attribute: ':create/user' | ':edit/user',
    varName: string
  ): DatalogClauses {
    const where = [
      `[${blockVar} ${attribute} ?${varName}]`,
      `[?${varName} :user/display-name ${ednString(user)}]`
    ];
    return { where, inputs: [], inputValues: [] };
  }

  private generateCreatedBy(user: string, blockVar: string): DatalogClauses {
    return this.generateUserClause(user, blockVar, ':create/user', 'creator');
  }

  private generateEditedBy(user: string, blockVar: string): DatalogClauses {
    return this.generateUserClause(user, blockVar, ':edit/user', 'editor');
  }

  /**
   * Convert Roam date string to Unix timestamp
   * Handles:
   *   - Relative dates: "today", "yesterday", "last week", "last month", etc.
   *   - Roam format: "January 1st, 2026"
   *   - ISO format: "2026-01-01"
   */
  private roamDateToTimestamp(dateStr: string): number {
    const normalized = dateStr.toLowerCase().trim();

    // Check for relative dates first
    const relativeDate = this.parseRelativeDate(normalized);
    if (relativeDate !== null) {
      return relativeDate;
    }

    // Remove ordinal suffixes (st, nd, rd, th)
    const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1');
    const date = new Date(cleaned);

    if (isNaN(date.getTime())) {
      // If parsing fails, try as ISO date
      const isoDate = new Date(dateStr);
      if (!isNaN(isoDate.getTime())) {
        return isoDate.getTime();
      }
      throw new Error(`Cannot parse date: ${dateStr}`);
    }

    return date.getTime();
  }

  /**
   * Parse relative date strings like "today", "last week", "last month"
   * Returns start-of-day timestamp or null if not a recognized relative date
   */
  private parseRelativeDate(dateStr: string): number | null {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (dateStr) {
      case 'today':
        return startOfToday.getTime();

      case 'yesterday':
        return new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000).getTime();

      case 'tomorrow':
        return new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000).getTime();

      case 'last week':
      case 'a week ago':
        return new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();

      case 'this week': {
        // Start of current week (Sunday)
        const dayOfWeek = now.getDay();
        return new Date(startOfToday.getTime() - dayOfWeek * 24 * 60 * 60 * 1000).getTime();
      }

      case 'next week':
        return new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000).getTime();

      case 'last month':
      case 'a month ago': {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        return lastMonth.getTime();
      }

      case 'this month': {
        // Start of current month
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      }

      case 'next month': {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        return nextMonth.getTime();
      }

      case 'last year':
      case 'a year ago': {
        const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        return lastYear.getTime();
      }

      case 'this year': {
        // Start of current year
        return new Date(now.getFullYear(), 0, 1).getTime();
      }

      case 'next year': {
        const nextYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        return nextYear.getTime();
      }

      default:
        // Check for "N days/weeks/months ago" pattern
        const agoMatch = dateStr.match(/^(\d+)\s+(day|week|month|year)s?\s+ago$/);
        if (agoMatch) {
          const amount = parseInt(agoMatch[1], 10);
          const unit = agoMatch[2];
          return this.subtractFromDate(startOfToday, amount, unit);
        }

        return null;
    }
  }

  private subtractFromDate(date: Date, amount: number, unit: string): number {
    switch (unit) {
      case 'day':
        return new Date(date.getTime() - amount * 24 * 60 * 60 * 1000).getTime();
      case 'week':
        return new Date(date.getTime() - amount * 7 * 24 * 60 * 60 * 1000).getTime();
      case 'month':
        return new Date(date.getFullYear(), date.getMonth() - amount, date.getDate()).getTime();
      case 'year':
        return new Date(date.getFullYear() - amount, date.getMonth(), date.getDate()).getTime();
      default:
        return date.getTime();
    }
  }
}

/**
 * Build a complete Datalog query from generated clauses
 */
export function buildDatalogQuery(
  clauses: DatalogClauses,
  options: {
    select?: string[];
    limit?: number;
    offset?: number;
    orderBy?: string;
    pageUid?: string;
  } = {}
): { query: string; args: (string | number)[] } {
  const {
    select = ['?block-uid', '?block-str', '?page-title'],
    limit,
    offset = 0,
    orderBy,
    pageUid
  } = options;

  // Build :in clause
  let inClause = ':in $';
  if (clauses.inputs.length > 0) {
    inClause += ' ' + clauses.inputs.join(' ');
  }
  if (pageUid) {
    inClause += ' ?target-page-uid';
  }

  // Build modifiers
  const modifiers: string[] = [];
  if (limit !== undefined && limit !== -1) {
    modifiers.push(`:limit ${limit}`);
  }
  if (offset > 0) {
    modifiers.push(`:offset ${offset}`);
  }
  if (orderBy) {
    modifiers.push(`:order ${orderBy}`);
  }

  // Build base WHERE clauses
  const baseClauses = [
    '[?b :block/string ?block-str]',
    '[?b :block/uid ?block-uid]',
    '[?b :block/page ?p]',
    '[?p :node/title ?page-title]'
  ];

  if (pageUid) {
    baseClauses.push('[?p :block/uid ?target-page-uid]');
  }

  // Combine all clauses
  const allWhereClauses = [...baseClauses, ...clauses.where];

  const query = `[:find ${select.join(' ')}
                  ${inClause} ${modifiers.join(' ')}
                  :where
                  ${allWhereClauses.join('\n                  ')}]`;

  // Build args
  const args: (string | number)[] = [...clauses.inputValues];
  if (pageUid) {
    args.push(pageUid);
  }

  return { query, args };
}
