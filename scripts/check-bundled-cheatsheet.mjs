#!/usr/bin/env node
/**
 * prepublishOnly guard: the bundled cheatsheet must end with exactly the
 * tracked default personalization template.
 *
 * `npm run build` concatenates `Roam_Markdown_Cheatsheet.md` with
 * `.roam/${CUSTOM_INSTRUCTIONS_PREFIX}custom-instructions.md`. That prefix is
 * a per-machine convenience for the author's own graph, and a private,
 * untracked file selected by it ships to every user if the publish happens
 * from that shell. 4.0.0 went out that way.
 *
 * This checks the artifact, not the environment: whatever produced
 * `build/Roam_Markdown_Cheatsheet.md`, it must end with the bytes of
 * `.roam/custom-instructions.md`. A stale build, a missing build, or any
 * appended private layer fails loudly here, before `npm publish` uploads.
 */
import { readFileSync } from 'node:fs';

const BUNDLED = 'build/Roam_Markdown_Cheatsheet.md';
const TEMPLATE = '.roam/custom-instructions.md';

let bundled;
try {
  bundled = readFileSync(BUNDLED, 'utf8');
} catch {
  console.error(`refusing to publish: ${BUNDLED} is missing. Run \`npm run build\` first.`);
  process.exit(1);
}

const template = readFileSync(TEMPLATE, 'utf8');

if (!bundled.endsWith(template)) {
  console.error(
    `refusing to publish: ${BUNDLED} does not end with ${TEMPLATE}.\n` +
      `The bundled cheatsheet carries something other than the tracked default template,\n` +
      `most likely a private layer selected by CUSTOM_INSTRUCTIONS_PREFIX ` +
      `(currently ${process.env.CUSTOM_INSTRUCTIONS_PREFIX ? `"${process.env.CUSTOM_INSTRUCTIONS_PREFIX}"` : 'unset'}).\n` +
      `Rebuild with the prefix unset: \`env -u CUSTOM_INSTRUCTIONS_PREFIX npm run build\`.`
  );
  process.exit(1);
}

console.log(`ok: ${BUNDLED} ends with the tracked default template.`);
