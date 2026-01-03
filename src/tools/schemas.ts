// Tool definitions and input schemas for Roam Research MCP server
export const toolSchemas = {
  roam_add_todo: {
    name: 'roam_add_todo',
    description: 'Add a list of todo items as individual blocks to today\'s daily page in Roam. Each item becomes its own actionable block with todo status.\nNOTE on Roam-flavored markdown: For direct linking: use [[link]] syntax. For aliased linking, use [alias]([[link]]) syntax. Do not concatenate words in links/hashtags - correct: #[[multiple words]] #self-esteem (for typically hyphenated words).\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'string',
            description: 'Todo item text'
          },
          description: 'List of todo items to add'
        }
      },
      required: ['todos'],
    },
  },
  roam_fetch_page_by_title: {
    name: 'roam_fetch_page_by_title',
    description: 'Fetch page by title. Returns content in the specified format.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Title of the page. For date pages, use ordinal date formats such as January 2nd, 2025'
        },
        format: {
          type: 'string',
          enum: ['markdown', 'raw'],
          default: 'raw',
          description:
            "Format output as markdown or JSON. 'markdown' returns as string; 'raw' returns JSON string of the page's blocks"
        }
      },
      required: ['title']
    },
  },
  roam_create_page: {
    name: 'roam_create_page',
    description: 'Create a new standalone page in Roam with optional content, including structured outlines and tables, using explicit nesting levels and headings (H1-H3). This is the preferred method for creating a new page with an outline in a single step. Best for:\n- Creating foundational concept pages that other pages will link to/from\n- Establishing new topic areas that need their own namespace\n- Setting up reference materials or documentation\n- Making permanent collections of information\n- Creating pages with mixed text and table content in one call.\n**Efficiency Tip:** This tool batches page and content creation efficiently. For adding content to existing pages, use `roam_process_batch_actions` instead.\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the new page',
        },
        content: {
          type: 'array',
          description: 'Initial content for the page as an array of content items. Each item can be a text block or a table. Text blocks use {text, level, heading?}. Tables use {type: "table", headers, rows}. Items are processed in order.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['text', 'table'],
                description: 'Content type: "text" for regular blocks (default), "table" for tables',
                default: 'text'
              },
              text: {
                type: 'string',
                description: 'Content of the block (for type: "text")'
              },
              level: {
                type: 'integer',
                description: 'Indentation level (1-10, where 1 is top level). For tables, this should always be 1.',
                minimum: 1,
                maximum: 10
              },
              heading: {
                type: 'integer',
                description: 'Optional: Heading formatting for this block (1-3). Only for type: "text".',
                minimum: 1,
                maximum: 3
              },
              headers: {
                type: 'array',
                description: 'Column headers for the table (for type: "table"). First header is typically empty for row labels.',
                items: { type: 'string' }
              },
              rows: {
                type: 'array',
                description: 'Data rows for the table (for type: "table"). Each row has a label and cells.',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'The row label (first column content). Use empty string for blank.'
                    },
                    cells: {
                      type: 'array',
                      description: 'Cell values for this row. Must have exactly (headers.length - 1) items.',
                      items: { type: 'string' }
                    }
                  },
                  required: ['label', 'cells']
                }
              }
            },
            required: ['level']
          }
        },
      },
      required: ['title'],
    },
  },
  roam_create_outline: {
    name: 'roam_create_outline',
    description: 'Add a structured outline to an existing page or block (by title text or uid), with customizable nesting levels. To create a new page with an outline, use the `roam_create_page` tool instead. The `outline` parameter defines *new* blocks to be created. To nest content under an *existing* block, provide its UID or exact text in `block_text_uid`, and ensure the `outline` array contains only the child blocks with levels relative to that parent. Including the parent block\'s text in the `outline` array will create a duplicate block. Best for:\n- Adding supplementary structured content to existing pages\n- Creating temporary or working outlines (meeting notes, brainstorms)\n- Organizing thoughts or research under a specific topic\n- Breaking down subtopics or components of a larger concept\nBest for simpler, contiguous hierarchical content. For complex nesting (e.g., tables) or granular control over block placement, consider `roam_process_batch_actions` instead.\n**API Usage Note:** This tool performs verification queries after creation. For large outlines (10+ items) or when rate limits are a concern, consider using `roam_process_batch_actions` instead to minimize API calls.\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        page_title_uid: {
          type: 'string',
          description: 'Title or UID of the page (UID is preferred for accuracy). Leave blank to use the default daily page.'
        },
        block_text_uid: {
          type: 'string',
          description: 'The text content or UID of the block to nest the outline under (UID is preferred for accuracy). If blank, content is nested directly under the page (or the default daily page if page_title_uid is also blank).'
        },
        outline: {
          type: 'array',
          description: 'Array of outline items with block text and explicit nesting level. Must be a valid hierarchy: the first item must be level 1, and subsequent levels cannot increase by more than 1 at a time (e.g., a level 3 cannot follow a level 1).',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Content of the block'
              },
              level: {
                type: 'integer',
                description: 'Indentation level (1-10, where 1 is top level). Levels must be sequential and cannot be skipped (e.g., a level 3 item cannot directly follow a level 1 item).',
                minimum: 1,
                maximum: 10
              },
              heading: {
                type: 'integer',
                description: 'Optional: Heading formatting for this block (1-3)',
                minimum: 1,
                maximum: 3
              },
              children_view_type: {
                type: 'string',
                description: 'Optional: The view type for children of this block ("bullet", "document", or "numbered")',
                enum: ["bullet", "document", "numbered"]
              }
            },
            required: ['text', 'level']
          }
        }
      },
      required: ['outline']
    }
  },
  roam_import_markdown: {
    name: 'roam_import_markdown',
    description: 'Import nested markdown content into Roam under a specific block. Can locate the parent block by UID (preferred) or by exact string match within a specific page. If a `parent_string` is provided and the block does not exist, it will be created. Returns a nested structure of the created blocks.\n**API Usage Note:** This tool fetches the full nested structure after import for verification. For large imports or when rate limits are a concern, consider using `roam_process_batch_actions` with pre-structured actions instead.\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Nested markdown content to import'
        },
        page_uid: {
          type: 'string',
          description: 'Optional: UID of the page containing the parent block (preferred for accuracy).'
        },
        page_title: {
          type: 'string',
          description: 'Optional: Title of the page containing the parent block (used if page_uid is not provided).'
        },
        parent_uid: {
          type: 'string',
          description: 'Optional: UID of the parent block to add content under (preferred for accuracy).'
        },
        parent_string: {
          type: 'string',
          description: 'Optional: Exact string content of an existing parent block to add content under (used if parent_uid is not provided; requires page_uid or page_title). If the block does not exist, it will be created.'
        },
        order: {
          type: 'string',
          description: 'Optional: Where to add the content undeIs this tr the parent ("first" or "last")',
          enum: ['first', 'last'],
          default: 'first'
        }
      },
      required: ['content']
    }
  },
  roam_search_for_tag: {
    name: 'roam_search_for_tag',
    description: 'Search for blocks containing a specific tag and optionally filter by blocks that also contain another tag nearby or exclude blocks with a specific tag. This tool supports pagination via the `limit` and `offset` parameters. Use this tool to search for memories tagged with the MEMORIES_TAG.',
    inputSchema: {
      type: 'object',
      properties: {
        primary_tag: {
          type: 'string',
          description: 'The main tag to search for (without the [[ ]] brackets)',
        },
        page_title_uid: {
          type: 'string',
          description: 'Optional: Title or UID of the page to search in (UID is preferred for accuracy). Defaults to today\'s daily page if not provided.',
        },
        near_tag: {
          type: 'string',
          description: 'Optional: Another tag to filter results by - will only return blocks where both tags appear',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Optional: Whether the search should be case-sensitive. If false, it will search for the provided tag, capitalized versions, and first word capitalized versions.',
          default: false
        },
        limit: {
          type: 'integer',
          description: 'Optional: The maximum number of results to return. Defaults to 50. Use -1 for no limit, but be aware that very large results sets can impact performance.',
          default: 50
        },
        offset: {
          type: 'integer',
          description: 'Optional: The number of results to skip before returning matches. Useful for pagination. Defaults to 0.',
          default: 0
        }
      },
      required: ['primary_tag']
    }
  },
  roam_search_by_status: {
    name: 'roam_search_by_status',
    description: 'Search for blocks with a specific status (TODO/DONE) across all pages or within a specific page.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Status to search for (TODO or DONE)',
          enum: ['TODO', 'DONE']
        },
        page_title_uid: {
          type: 'string',
          description: 'Optional: Title or UID of the page to search in (UID is preferred for accuracy). If not provided, searches across all pages.'
        },
        include: {
          type: 'string',
          description: 'Optional: Comma-separated list of terms to filter results by inclusion (matches content or page title)'
        },
        exclude: {
          type: 'string',
          description: 'Optional: Comma-separated list of terms to filter results by exclusion (matches content or page title)'
        }
      },
      required: ['status']
    }
  },
  roam_search_block_refs: {
    name: 'roam_search_block_refs',
    description: 'Search for block references within a page or across the entire graph. Can search for references to a specific block, a page title, or find all block references.',
    inputSchema: {
      type: 'object',
      properties: {
        block_uid: {
          type: 'string',
          description: 'Optional: UID of the block to find references to (searches for ((uid)) patterns in text)'
        },
        title: {
          type: 'string',
          description: 'Optional: Page title to find references to (uses :block/refs for [[page]] and #tag links)'
        },
        page_title_uid: {
          type: 'string',
          description: 'Optional: Title or UID of the page to search in (UID is preferred for accuracy). If not provided, searches across all pages.'
        }
      }
    }
  },
  roam_search_hierarchy: {
    name: 'roam_search_hierarchy',
    description: 'Search for parent or child blocks in the block hierarchy. Can search up or down the hierarchy from a given block.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_uid: {
          type: 'string',
          description: 'Optional: UID of the block to find children of'
        },
        child_uid: {
          type: 'string',
          description: 'Optional: UID of the block to find parents of'
        },
        page_title_uid: {
          type: 'string',
          description: 'Optional: Title or UID of the page to search in (UID is preferred for accuracy).'
        },
        max_depth: {
          type: 'integer',
          description: 'Optional: How many levels deep to search (default: 1)',
          minimum: 1,
          maximum: 10
        }
      }
      // Note: Validation for either parent_uid or child_uid is handled in the server code
    }
  },
  roam_find_pages_modified_today: {
    name: 'roam_find_pages_modified_today',
    description: 'Find pages that have been modified today (since midnight), with pagination and sorting options.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'The maximum number of pages to retrieve (default: 50). Use -1 for no limit, but be aware that very large result sets can impact performance.',
          default: 50
        },
        offset: {
          type: 'integer',
          description: 'The number of pages to skip before returning matches. Useful for pagination. Defaults to 0.',
          default: 0
        },
        sort_order: {
          type: 'string',
          description: 'Sort order for pages based on modification date. "desc" for most recent first, "asc" for oldest first.',
          enum: ['asc', 'desc'],
          default: 'desc'
        }
      }
    }
  },
  roam_search_by_text: {
    name: 'roam_search_by_text',
    description: 'Search for blocks containing specific text across all pages or within a specific page. This tool supports pagination via the `limit` and `offset` parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to search for'
        },
        page_title_uid: {
          type: 'string',
          description: 'Optional: Title or UID of the page to search in (UID is preferred for accuracy). If not provided, searches across all pages.'
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Optional: Whether the search should be case-sensitive. If false, it will search for the provided text, capitalized versions, and first word capitalized versions.',
          default: false
        },
        limit: {
          type: 'integer',
          description: 'Optional: The maximum number of results to return. Defaults to 50. Use -1 for no limit, but be aware that very large results sets can impact performance.',
          default: 50
        },
        offset: {
          type: 'integer',
          description: 'Optional: The number of results to skip before returning matches. Useful for pagination. Defaults to 0.',
          default: 0
        }
      },
      required: ['text']
    }
  },
  roam_search_by_date: {
    name: 'roam_search_by_date',
    description: 'Search for blocks or pages based on creation or modification dates. Not for daily pages with ordinal date titles.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in ISO format (YYYY-MM-DD)',
        },
        end_date: {
          type: 'string',
          description: 'Optional: End date in ISO format (YYYY-MM-DD)',
        },
        type: {
          type: 'string',
          enum: ['created', 'modified', 'both'],
          description: 'Whether to search by creation date, modification date, or both',
        },
        scope: {
          type: 'string',
          enum: ['blocks', 'pages', 'both'],
          description: 'Whether to search blocks, pages',
        },
        include_content: {
          type: 'boolean',
          description: 'Whether to include the content of matching blocks/pages',
          default: true,
        }
      },
      required: ['start_date', 'type', 'scope']
    }
  },
  roam_markdown_cheatsheet: {
    name: 'roam_markdown_cheatsheet',
    description: 'Provides the content of the Roam Markdown Cheatsheet resource, optionally concatenated with custom instructions if CUSTOM_INSTRUCTIONS_PATH is set.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  roam_remember: {
    name: 'roam_remember',
    description: 'Add a memory or piece of information to remember, stored on the daily page with MEMORIES_TAG tag and optional categories. \nNOTE on Roam-flavored markdown: For direct linking: use [[link]] syntax. For aliased linking, use [alias]([[link]]) syntax. Do not concatenate words in links/hashtags - correct: #[[multiple words]] #self-esteem (for typically hyphenated words).\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        memory: {
          type: 'string',
          description: 'The memory detail or information to remember'
        },
        categories: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Optional categories to tag the memory with (will be converted to Roam tags)'
        },
        heading: {
          type: 'string',
          description: 'Optional heading text to nest the memory under (e.g., "Memories" or "## LLM Memories"). If the heading does not exist on the daily page, it will be created. Ignored if parent_uid is provided.'
        },
        parent_uid: {
          type: 'string',
          description: 'Optional UID of a specific block to nest the memory under. Takes precedence over heading parameter.'
        }
      },
      required: ['memory']
    }
  },
  roam_recall: {
    name: 'roam_recall',
    description: 'Retrieve all stored memories on page titled MEMORIES_TAG, or tagged block content with the same name. Returns a combined, deduplicated list of memories. Optionally filter blcoks with a specific tag and sort by creation date.',
    inputSchema: {
      type: 'object',
      properties: {
        sort_by: {
          type: 'string',
          description: 'Sort order for memories based on creation date',
          enum: ['newest', 'oldest'],
          default: 'newest'
        },
        filter_tag: {
          type: 'string',
          description: 'Include only memories with a specific filter tag. For single word tags use format "tag", for multi-word tags use format "tag word" (without brackets)'
        }
      }
    }
  },
  roam_datomic_query: {
    name: 'roam_datomic_query',
    description: 'Execute a custom Datomic query on the Roam graph for advanced data retrieval beyond the available search tools. This provides direct access to Roam\'s query engine. Note: Roam graph is case-sensitive.\n\n__Optimal Use Cases for `roam_datomic_query`:__\n- __Advanced Filtering (including Regex):__ Use for scenarios requiring complex filtering, including regex matching on results post-query, which Datalog does not natively support for all data types. It can fetch broader results for client-side post-processing.\n- __Highly Complex Boolean Logic:__ Ideal for intricate combinations of "AND", "OR", and "NOT" conditions across multiple terms or attributes.\n- __Arbitrary Sorting Criteria:__ The go-to for highly customized sorting needs beyond default options.\n- __Proximity Search:__ For advanced search capabilities involving proximity, which are difficult to implement efficiently with simpler tools.\n\nList of some of Roam\'s data model Namespaces and Attributes: ancestor (descendants), attrs (lookup), block (children, heading, open, order, page, parents, props, refs, string, text-align, uid), children (view-type), create (email, time), descendant (ancestors), edit (email, seen-by, time), entity (attrs), log (id), node (title), page (uid, title), refs (text).\nPredicates (clojure.string/includes?, clojure.string/starts-with?, clojure.string/ends-with?, <, >, <=, >=, =, not=, !=).\nAggregates (distinct, count, sum, max, min, avg, limit).\nTips: Use :block/parents for all ancestor levels, :block/children for direct descendants only; combine clojure.string for complex matching, use distinct to deduplicate, leverage Pull patterns for hierarchies, handle case-sensitivity carefully, and chain ancestry rules for multi-level queries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The Datomic query to execute (in Datalog syntax). Example: `[:find ?block-string :where [?block :block/string ?block-string] (or [(clojure.string/includes? ?block-string "hypnosis")] [(clojure.string/includes? ?block-string "trance")] [(clojure.string/includes? ?block-string "suggestion")]) :limit 25]`'
        },
        inputs: {
          type: 'array',
          description: 'Optional array of input parameters for the query',
          items: {
            type: 'string'
          }
        },
        regexFilter: {
          type: 'string',
          description: 'Optional: A regex pattern to filter the results client-side after the Datomic query. Applied to JSON.stringify(result) or specific fields if regexTargetField is provided.'
        },
        regexFlags: {
          type: 'string',
          description: 'Optional: Flags for the regex filter (e.g., "i" for case-insensitive, "g" for global).',
        },
        regexTargetField: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Optional: An array of field paths (e.g., ["block_string", "page_title"]) within each Datomic result object to apply the regex filter to. If not provided, the regex is applied to the stringified full result.'
        }
      },
      required: ['query']
    }
  },
  roam_process_batch_actions: {
    name: 'roam_process_batch_actions',
    description: '**RATE LIMIT EFFICIENT:** This is the most API-efficient tool for multiple block operations. Combine all create/update/delete operations into a single call whenever possible. For intensive page updates or revisions, prefer this tool over multiple sequential calls.\n\nExecutes a sequence of low-level block actions (create, update, move, delete) in a single, non-transactional batch. Actions are executed in the provided order.\n\n**UID Placeholders for Nested Blocks:** Use `{{uid:name}}` syntax for parent-child references within the same batch. The server generates proper random UIDs and returns a `uid_map` showing placeholder→UID mappings. Example: `{ uid: "{{uid:parent1}}", string: "Parent" }` then `{ location: { "parent-uid": "{{uid:parent1}}" }, string: "Child" }`. Response includes `{ success: true, uid_map: { "parent1": "Xk7mN2pQ9" } }`.\n\nFor actions on existing blocks, a valid block UID is required. Note: Roam-flavored markdown, including block embedding with `((UID))` syntax, is supported within the `string` property for `create-block` and `update-block` actions. For actions on existing blocks or within a specific page context, it is often necessary to first obtain valid page or block UIDs. Tools like `roam_fetch_page_by_title` or other search tools can be used to retrieve these UIDs before executing batch actions. For simpler, sequential outlines, `roam_create_outline` is often more suitable.\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'An array of action objects to execute in order.',
          items: {
            type: 'object',
            properties: {
              "action": {
                type: 'string',
                description: 'The specific action to perform.',
                enum: ['create-block', 'update-block', 'move-block', 'delete-block']
              },
              "uid": {
                type: 'string',
                description: 'The UID of the block to target for "update-block", "move-block", or "delete-block" actions.'
              },
              "string": {
                type: 'string',
                description: 'The content for the block, used in "create-block" and "update-block" actions.'
              },
              "open": {
                type: "boolean",
                description: "Optional: Sets the open/closed state of a block, used in 'update-block' or 'create-block'. Defaults to true."
              },
              "heading": {
                type: "integer",
                description: "Optional: The heading level (1, 2, or 3) for 'create-block' or 'update-block'.",
                enum: [1, 2, 3]
              },
              "text-align": {
                type: "string",
                description: "Optional: The text alignment for 'create-block' or 'update-block'.",
                enum: ["left", "center", "right", "justify"]
              },
              "children-view-type": {
                type: "string",
                description: "Optional: The view type for children of the block, for 'create-block' or 'update-block'.",
                enum: ["bullet", "document", "numbered"]
              },
              "location": {
                type: 'object',
                description: 'Specifies where to place a block, used in "create-block" and "move-block" actions.',
                properties: {
                  "parent-uid": {
                    type: 'string',
                    description: 'The UID of the parent block or page.'
                  },
                  "order": {
                    type: ['integer', 'string'],
                    description: 'The position of the block under its parent (e.g., 0, 1, 2) or a keyword ("first", "last").'
                  }
                }
              }
            },
            required: ['action']
          }
        }
      },
      required: ['actions']
    }
  },
  roam_fetch_block_with_children: {
    name: 'roam_fetch_block_with_children',
    description: 'Fetch a block by its UID along with its hierarchical children down to a specified depth. Returns a nested object structure containing the block\'s UID, text, order, and an array of its children.',
    inputSchema: {
      type: 'object',
      properties: {
        block_uid: {
          type: 'string',
          description: 'The UID of the block to fetch.'
        },
        depth: {
          type: 'integer',
          description: 'Optional: The number of levels deep to fetch children. Defaults to 4.',
          minimum: 0,
          maximum: 10
        }
      },
      required: ['block_uid']
    },
  },
  roam_create_table: {
    name: 'roam_create_table',
    description: 'Create a table in Roam with specified headers and rows. This tool abstracts the complex nested structure that Roam tables require, making it much easier to create properly formatted tables.\n\n**Why use this tool:**\n- Roam tables require precise nested block structures that are error-prone to create manually\n- Automatically handles the {{[[table]]}} container and nested column structure\n- Validates row/column consistency before execution\n- Converts empty cells to spaces (required by Roam)\n\n**Example:** A table with headers ["", "Column A", "Column B"] and rows [{label: "Row 1", cells: ["A1", "B1"]}] creates a 2x3 table.\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_uid: {
          type: 'string',
          description: 'The UID of the parent block or page where the table should be created.'
        },
        order: {
          type: ['integer', 'string'],
          description: 'Optional: Position under the parent. Can be a number (0-based) or "first"/"last". Defaults to "last".',
          default: 'last'
        },
        headers: {
          type: 'array',
          description: 'Column headers for the table. The first header is typically empty (for the row label column). Example: ["", "Option A", "Option B"]',
          items: {
            type: 'string'
          },
          minItems: 1
        },
        rows: {
          type: 'array',
          description: 'Data rows for the table. Each row has a label (first column) and cells (remaining columns).',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'The row label (first column content). Use empty string for blank.'
              },
              cells: {
                type: 'array',
                description: 'Cell values for this row. Must have exactly (headers.length - 1) items.',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['label', 'cells']
          }
        }
      },
      required: ['parent_uid', 'headers', 'rows']
    }
  },
  roam_move_block: {
    name: 'roam_move_block',
    description: 'Move a block to a new location (different parent or position). This is a convenience wrapper around `roam_process_batch_actions` for single block moves.',
    inputSchema: {
      type: 'object',
      properties: {
        block_uid: {
          type: 'string',
          description: 'The UID of the block to move'
        },
        parent_uid: {
          type: 'string',
          description: 'The UID of the new parent block or page'
        },
        order: {
          type: ['integer', 'string'],
          description: 'Position under the new parent. Can be a number (0-based index) or "first"/"last". Defaults to "last".',
          default: 'last'
        }
      },
      required: ['block_uid', 'parent_uid']
    }
  },
  roam_update_page_markdown: {
    name: 'roam_update_page_markdown',
    description: 'Update an existing page with new markdown content using smart diff. Preserves block UIDs where possible and generates minimal changes. This is ideal for:\n- Syncing external markdown files to Roam\n- AI-assisted content updates that preserve references\n- Batch content modifications without losing block references\n\n**How it works:**\n1. Fetches existing page blocks\n2. Matches new content to existing blocks by text similarity\n3. Generates minimal create/update/move/delete operations\n4. Preserves UIDs for matched blocks (keeping references intact)\n\nIMPORTANT: Before using this tool, ensure that you have loaded into context the \'Roam Markdown Cheatsheet\' resource.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the page to update'
        },
        markdown: {
          type: 'string',
          description: 'New GFM markdown content for the page'
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, returns the planned actions without executing them. Useful for previewing changes.',
          default: false
        }
      },
      required: ['title', 'markdown']
    }
  },
};
