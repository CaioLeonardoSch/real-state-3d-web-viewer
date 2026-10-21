---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the rules in [guidelines.md](guidelines.md)
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

The rules are a pinned, reviewed copy of
`https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
(commit `434b7f9`), kept in [guidelines.md](guidelines.md). Do not fetch the live URL: an update
has to be reviewed and committed like any other change.

## Project notes

- This project is vanilla TypeScript, not React. Map rules written for React (`onKeyDown`,
  `htmlFor`, `useState`, hydration) to their DOM equivalents, and skip those that have none.
- The UI copy is Brazilian Portuguese. Ignore the "Title Case" rule for it: Portuguese uses
  sentence case.

## Usage

When a user provides a file or pattern argument:
1. Read the guidelines from [guidelines.md](guidelines.md)
2. Read the specified files
3. Apply all rules from the guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
