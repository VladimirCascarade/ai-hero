# Markdown Table Support

> **Status:** Implemented in `chat-message.tsx` with `remark-gfm` and consolidated `prose` on the shared `Markdown` component.

## Problem

Pipe tables (GFM syntax) in assistant answers render as plain text:

```markdown
| Column A | Column B |
| -------- | -------- |
| foo      | bar      |
```

Two things cause this:

1. **`react-markdown` does not parse GFM tables by default.** It needs the `remark-gfm` plugin.
2. **Table styling is already available** via `@tailwindcss/typography` — the project configures `--tw-prose-th-borders` and `--tw-prose-td-borders` in `tailwind.config.ts`. We just need parsed `<table>` elements inside a `.prose` container.

No custom table components are required. Let the typography plugin do the work.

## What not to change

| File | Reason |
| --- | --- |
| `tailwind.config.ts` | Table border tokens for `prose-invert` are already configured |
| `markdown-joiner-transform.ts` | Only buffers `[` and `*` for links/bold — does not affect tables |
| Backend / streaming | Tables are plain markdown in the streamed text |

## Step 1 — Install `remark-gfm`

```bash
pnpm add remark-gfm
```

## Step 2 — Enable GFM parsing in `chat-message.tsx`

Import the plugin and pass it to `ReactMarkdown`:

```tsx
import remarkGfm from "remark-gfm";
```

Update the shared `Markdown` component:

```tsx
const Markdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
};
```

That is the only functional change required for tables to parse correctly.

## Step 3 — Ensure tables sit inside `.prose`

The answer area already wraps streamed text in typography classes:

```tsx
<div className="prose prose-invert max-w-none">
  {parts.map((part, index) => {
    if (part?.type === "text" && part.text) {
      return <Markdown key={index}>{part.text}</Markdown>;
    }
    return null;
  })}
</div>
```

`@tailwindcss/typography` styles tables via descendant selectors (`.prose table`, `.prose th`, `.prose td`). As long as:

- `remark-gfm` parses the markdown into `<table>` elements, and
- those elements are rendered inside the existing `.prose prose-invert` wrapper,

…tables will pick up the default invert theme styling with no extra component overrides.

**Do not add** `table`, `thead`, `tbody`, `tr`, `th`, or `td` entries to the `components` map unless you have a specific reason — that would bypass the typography plugin defaults.

## Optional — Consolidate prose on the `Markdown` component

Reasoning-step markdown (research plans, evaluator feedback) uses the same `Markdown` component but **without** a `.prose` wrapper today. Tables are unlikely there, but if you want one consistent approach:

```tsx
const Markdown = ({ children }: { children: string }) => {
  return (
    <div className="prose prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
};
```

Then remove the outer `prose prose-invert` div from the answer area to avoid nesting `.prose` twice.

Only do this if you want typography styling everywhere `Markdown` is used. It will change the appearance of reasoning-step text (plans, feedback), not just tables.

## Optional — Horizontal scroll for wide tables

If wide tables overflow on small screens, add a single utility wrapper. This is the only custom styling worth considering:

```tsx
const Markdown = ({ children }: { children: string }) => {
  return (
    <div className="prose prose-invert max-w-none overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
};
```

Tailwind Typography does not add overflow handling by default.

## Summary

| Change | Required? |
| --- | --- |
| `pnpm add remark-gfm` | Yes |
| `remarkPlugins={[remarkGfm]}` on `ReactMarkdown` | Yes |
| Custom `table` / `th` / `td` components | No — use typography defaults |
| `tailwind.config.ts` changes | No — already configured |
| Move `.prose` onto shared `Markdown` | Optional |
| `overflow-x-auto` on prose wrapper | Optional, for wide tables |

## Verify

Ask a question that produces a comparison table, e.g.:

> Compare Pinecone, Weaviate, and Qdrant on pricing, rate limits, and enterprise SSO.

You should see a bordered table with invert-theme colours, not raw pipe characters.
