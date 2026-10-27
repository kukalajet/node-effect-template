import { defineRule } from "@oxlint/plugins";
import type { Context } from "@oxlint/plugins";

import {
  reportMissingBlankLine,
  type StatementSibling,
} from "../shared/blank-lines.ts";

const blockTypes = new Set([
  "BlockStatement",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LabeledStatement",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);
const exitTypes = new Set([
  "BreakStatement",
  "ContinueStatement",
  "ReturnStatement",
  "ThrowStatement",
]);

// A guard belongs with the statement that produced the value it checks, so it
// is not separated from its neighbours.
function isGuard(node: StatementSibling): boolean {
  if (node.type !== "IfStatement" || node.alternate !== null) return false;

  // A block with more than one statement stays a BlockStatement here, which
  // is not an exit.
  const body = node.consequent.type === "BlockStatement" &&
      node.consequent.body.length === 1
    ? node.consequent.body[0]
    : node.consequent;

  return body !== undefined && exitTypes.has(body.type);
}

function isSeparatedBlock(node: StatementSibling): boolean {
  return blockTypes.has(node.type) &&
    node.loc.end.line > node.loc.start.line && !isGuard(node);
}

function checkSiblings(
  context: Context,
  siblings: ReadonlyArray<StatementSibling>,
): void {
  siblings.forEach((node, index) => {
    const previous = siblings[index - 1];
    // blank-line-before-return already owns the gap before a return.
    if (previous === undefined || node.type === "ReturnStatement") return;

    if (isSeparatedBlock(previous) || isSeparatedBlock(node)) {
      reportMissingBlankLine(context, previous, node, "blankLine");
    }
  });
}

const blankLineAroundBlocksRule = defineRule({
  meta: {
    type: "layout",
    docs: {
      description:
        "Require blank lines around multi-line block statements, except guard clauses.",
    },
    fixable: "whitespace",
    messages: {
      blankLine: "Separate this multi-line block with a blank line.",
    },
  },
  createOnce(context) {
    return {
      BlockStatement(node) {
        checkSiblings(context, node.body);
      },
      Program(node) {
        checkSiblings(context, node.body);
      },
      SwitchCase(node) {
        checkSiblings(context, node.consequent);
      },
    };
  },
});

export { blankLineAroundBlocksRule };
