#!/usr/bin/env node

import { initializeGraph } from '@roam-research/roam-api-sdk';
import { API_TOKEN, GRAPH_NAME } from '../config/environment.js';
import { PageOperations } from '../tools/operations/pages.js';
import { parseMarkdown } from '../markdown-utils.js';

interface MarkdownNode {
  content: string;
  level: number;
  heading_level?: number;
  children: MarkdownNode[];
}

/**
 * Flatten nested MarkdownNode[] to flat array with absolute levels
 */
function flattenNodes(
  nodes: MarkdownNode[],
  baseLevel: number = 1
): Array<{ text: string; level: number; heading?: number }> {
  const result: Array<{ text: string; level: number; heading?: number }> = [];

  for (const node of nodes) {
    result.push({
      text: node.content,
      level: baseLevel,
      ...(node.heading_level && { heading: node.heading_level })
    });

    if (node.children.length > 0) {
      result.push(...flattenNodes(node.children, baseLevel + 1));
    }
  }

  return result;
}

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Show usage help
 */
function showUsage(): void {
  console.error('Usage: roam-import <page-title>');
  console.error('');
  console.error('Reads markdown from stdin and imports to Roam Research.');
  console.error('');
  console.error('Examples:');
  console.error('  cat document.md | roam-import "Meeting Notes"');
  console.error('  pbpaste | roam-import "Ideas"');
  console.error('  echo "- Item 1\\n- Item 2" | roam-import "Quick Note"');
  console.error('');
  console.error('Environment variables required:');
  console.error('  ROAM_API_TOKEN   Your Roam Research API token');
  console.error('  ROAM_GRAPH_NAME  Your Roam graph name');
}

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const pageTitle = args[0];

  if (!pageTitle || pageTitle === '--help' || pageTitle === '-h') {
    showUsage();
    process.exit(pageTitle ? 0 : 1);
  }

  // Check if stdin is a TTY (no input piped)
  if (process.stdin.isTTY) {
    console.error('Error: No input received. Pipe markdown content to this command.');
    console.error('');
    showUsage();
    process.exit(1);
  }

  // Read markdown from stdin
  const markdownContent = await readStdin();

  if (!markdownContent.trim()) {
    console.error('Error: Empty input received.');
    process.exit(1);
  }

  // Initialize Roam graph
  const graph = initializeGraph({
    token: API_TOKEN,
    graph: GRAPH_NAME
  });

  // Parse markdown to nodes
  const nodes = parseMarkdown(markdownContent) as MarkdownNode[];

  // Flatten nested structure to content blocks
  const contentBlocks = flattenNodes(nodes);

  if (contentBlocks.length === 0) {
    console.error('Error: No content blocks parsed from input.');
    process.exit(1);
  }

  // Create page with content
  const pageOps = new PageOperations(graph);
  const result = await pageOps.createPage(pageTitle, contentBlocks);

  if (result.success) {
    console.log(`Created page '${pageTitle}' (uid: ${result.uid})`);
  } else {
    console.error(`Failed to create page '${pageTitle}'`);
    process.exit(1);
  }
}

main().catch((error: Error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
