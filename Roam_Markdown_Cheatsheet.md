!!!! IMPORTANT: Always consult this cheatsheet for correct Roam-flavored markdown syntax BEFORE making any Roam tool calls.

# Roam Markdown Cheatsheet

⭐️📋 > > > START 📋⭐️

## Markdown Styles in Roam:

- **Bold Text here**
- **Italics Text here**
- External Link: `[Link text](URL)`
- Image Embed: `![Alt text](URL)`
- ^^Highlighted Text here^^
- Bullet points: - or \* followed by a space and the text
- {{[[TODO]]}} todo text
- {{[[DONE]]}} todo text
- LaTeX: `$$E=mc^2$$` or `$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$`
- Bullet points use dashes not asterisks.

## Roam-specific Markdown:

- Dates are in ordinal format: `[[January 1st, 2025]]`
- Block references: `((block-id))` This inserts a reference to the content of a specific block.
- Page references: `[[Page name]]` This creates a link to another page within your Roam graph.
- Link to blocks: `[Link Text](<((block-id))>)` This will link to the block.
- Embed block in a block: `{{[[embed]]: ((block-id))}}`
- To-do items: `{{[[TODO]]}} todo text` or `{{[[DONE]]}} todo text`
- Syntax highlighting for fenced code blocks (add language next to backticks before fenced code block - all in one block) - Example:
  ```javascript
      const foo(bar) => {
          return bar;
      }
  ```
- Tags:
  - one-word: `#word`
  - multiple words: `#[[two or more words]]`
  - hyphenated words: `#self-esteem`

## Roam Tables

Roam tables are created by nesting blocks under a `{{[[table]]}}` parent block. The key to correct table rendering is to ensure proper indentation levels for headers and data cells. Each subsequent header or data cell within a row must be nested one level deeper than the previous one.

- The `{{[[table]]}}` block acts as the container for the entire table.
- The first header block should be at level 2 (one level deeper than `{{[[table]]}}`).
- Subsequent header blocks must increase their level by one.
- Each row starts at level 2.
- The first data cell in a row is at level 3 (one level deeper than the row block).
- Subsequent data cells within the same row must increase their level by one.

Example of a 4x4 table structure:

```
{{[[table]]}}
    - Header 1
        - Header 2
            - Header 3
                - Header 4
    - Row 1
        - Data 1.1
            - Data 1.2
                - Data 1.3
                    - Data 1.4
    - Row 2
        - Data 2.1
            - Data 2.2
                - Data 2.3
                    - Data 2.4
    - Row 3
        - Data 3.1
            - Data 3.2
                - Data 3.3
                    - Data 3.4
    - Row 4
        - Data 4.1
            - Data 4.2
                - Data 4.3
                    - Data 4.4
```

## Roam Mermaid

This markdown structure represents a Roam Research Mermaid diagram. It begins with a `{{[[mermaid]]}}` block, which serves as the primary container for the diagram definition. Nested underneath this block, using bullet points, is the actual Mermaid syntax. Each bullet point corresponds to a line of the Mermaid graph definition, allowing Roam to render a visual diagram based on the provided code. For example, `graph TD` specifies a top-down directed graph, and subsequent bullet points define nodes and their connections.

```
- {{[[mermaid]]}}
    - graph TD
        - A[Start] --> B{Decision Point}
        - B -->|Yes| C[Process A]
        - B -->|No| D[Process B]
        - C --> E[Merge Results]
        - D --> E
        - E --> F[End]
```

## Roam Kanban Boards

The provided markdown structure represents a Roam Research Kanban board. It starts with a `{{[[kanban]]}}` block, under which nested bullet points define the Kanban cards. Each top-level bullet point directly under `{{[[kanban]]}}` serves as a card title, and any further nested bullet points under a card title act as details or sub-items for that specific card.

```
- {{[[kanban]]}}
    - card title 1
        - bullet point 1.1
        - bullet point 1.2
    - card title 2
        - bullet point 2.1
        - bullet point 2.2
```

---

## Roam Hiccup

This markdown structure allows embedding custom HTML or other content using Hiccup syntax. The `:hiccup` keyword is followed by a Clojure-like vector defining the HTML elements and their attributes in one block. This provides a powerful way to inject dynamic or custom components into your Roam graph. Example: `:hiccup [:iframe {:width "600" :height "400" :src "https://www.example.com"}]`

## Specific notes and preferences concerning my Roam Research graph
