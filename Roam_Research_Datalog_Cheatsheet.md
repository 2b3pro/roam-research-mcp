# Roam Research Datalog Cheatsheet ([Gist](https://gist.github.com/2b3pro/231e4f230ed41e3f52e8a89ebf49848b))

## Basic Structure

- Roam uses Datascript (JavaScript/ClojureScript Datalog implementation)
- Each fact is a datom: `[entity-id attribute value transaction-id]`

## Core Components

### Entity IDs

- Hidden ID: Internal database entity-id
- Public ID: Block reference (e.g., `((GGv3cyL6Y))`) or page title (`[[Page Title]]`)

### Common Block Attributes

```clojure
:block/uid        # Nine-character block reference
:create/email     # Creator's email
:create/time      # Creation timestamp
:edit/email       # Editor's email
:edit/time        # Last edit timestamp
```

### Page-Specific Attributes

```clojure
:node/title       # Page title (pages only)
```

### Block Attributes

```clojure
:block/page      # Reference to page entity-id
:block/order     # Sequence within parent
:block/string    # Block content
:block/parents   # List of ancestor blocks
```

### Optional Block Attributes

```clojure
:children/view-type  # 'bullet', 'document', 'numbered'
:block/heading      # 1, 2, 3 for H1-H3
:block/props        # Image/iframe sizing, slider position
:block/text-align   # 'left', 'center', 'right', 'justify'
```

## Query Examples

### Graph Statistics

#### Count Pages

```clojure
[:find (count ?title)
 :where [_ :node/title ?title]]
```

#### Count Blocks

```clojure
[:find (count ?string)
 :where [_ :block/string ?string]]
```

#### Find Blocks with Most Descendants

```clojure
[:find ?ancestor (count ?block)
 :in $ %
 :where
 [?ancestor :block/string]
 [?block :block/string]
 (ancestor ?block ?ancestor)]
```

### Page Queries

#### List Pages in Namespace

```clojure
[:find ?title:name ?title:uid ?time:date
 :where
 [?page :node/title ?title:name]
 [?page :block/uid ?title:uid]
 [?page :edit/time ?time:date]
 [(clojure.string/starts-with? ?title:name "roam/")]]
```

#### Find Pages Modified Today

```clojure
[:find ?page_title:name ?page_title:uid
 :in $ ?start_of_day %
 :where
 [?page :node/title ?page_title:name]
 [?page :block/uid ?page_title:uid]
 (ancestor ?block ?page)
 [?block :edit/time ?time]
 [(> ?time ?start_of_day)]]
```

### Block Queries

#### Find Direct Children

```clojure
[:find ?block_string
 :where
 [?p :node/title "Page Title"]
 [?p :block/children ?c]
 [?c :block/string ?block_string]]
```

#### Find with Pull Pattern

```clojure
[:find (pull ?e [*{:block/children [*]}])
 :where [?e :node/title "Page Title"]]
```

### Advanced Queries

#### Search with Case-Insensitive Pattern

```javascript
let fragment = "search_term";
let query = `[:find ?title:name ?title:uid ?time:date
              :where [?page :node/title ?title:name]
                    [?page :block/uid ?title:uid]
                    [?page :edit/time ?time:date]]`;

let results = window.roamAlphaAPI
  .q(query)
  .filter((item, index) => item[0].toLowerCase().indexOf(fragment) > 0)
  .sort((a, b) => a[0].localeCompare(b[0]));
```

#### List Namespace Attributes

```clojure
[:find ?namespace ?attribute
 :where [_ ?attribute]
 [(namespace ?attribute) ?namespace]]
```

## Tips

- Use `:block/parents` for ancestors (includes all levels)
- Use `:block/children` for immediate descendants only
- Combine `clojure.string` functions for complex text matching
- Use `distinct` to avoid duplicate results
- Use Pull patterns for hierarchical data retrieval
- Handle case sensitivity in string operations carefully
- Chain ancestry rules for multi-level traversal

## Common Predicates

Available functions:

- clojure.string/includes?
- clojure.string/starts-with?
- clojure.string/ends-with?
- count
- <, >, <=, >=, =, not=, !=

## Aggregates

Available functions:

- sum
- max
- min
- avg
- count
- distinct

# Sources/References:

- [Deep Dive Into Roam's Data Structure - Why Roam is Much More Than a Note Taking App](https://www.zsolt.blog/2021/01/Roam-Data-Structure-Query.html)
- [Query Reference | Datomic](https://docs.datomic.com/query/query-data-reference.html)
- [Datalog Queries for Roam Research | David Bieber](https://davidbieber.com/snippets/2020-12-22-datalog-queries-for-roam-research/)
