import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HELP_TOPICS, searchHelp, type HelpTopic } from "@/help/topics";

/**
 * In-app knowledge base. Topics inline as runtime strings — see
 * apps/web/src/help/topics.ts. Fast keyword search; deep-link to a
 * specific topic via `/help?t=workbench`. The cmd-K palette also
 * indexes these.
 */

const CATEGORY_LABEL: Record<HelpTopic["category"], string> = {
  user: "For staff",
  admin: "For administrators",
  operator: "For operators",
  reference: "Reference",
};

const CATEGORY_ORDER: HelpTopic["category"][] = ["user", "admin", "operator", "reference"];

export function HelpPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const initialTopic = params.get("t") ?? null;
  const initialQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [activeId, setActiveId] = useState<string | null>(initialTopic);

  const matches = useMemo(() => searchHelp(query), [query]);
  const grouped = useMemo(() => {
    const out: Record<string, HelpTopic[]> = {};
    for (const t of matches) {
      out[t.category] ??= [];
      out[t.category]!.push(t);
    }
    return out;
  }, [matches]);

  const active = activeId ? HELP_TOPICS.find((t) => t.id === activeId) : null;

  function setTopic(id: string | null): void {
    setActiveId(id);
    const next = new URLSearchParams(params);
    if (id) next.set("t", id);
    else next.delete("t");
    if (query) next.set("q", query);
    setParams(next, { replace: true });
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]">
      <aside>
        <header className="mb-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BookOpen className="h-5 w-5 text-primary" /> Help
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Browse topics or search across the knowledge base.
          </p>
        </header>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="pl-8"
            autoFocus
          />
        </div>
        <nav className="space-y-4 text-sm">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABEL[cat]}
                </p>
                <ul className="space-y-0.5">
                  {items.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setTopic(t.id)}
                        className={
                          "block w-full rounded-md px-2 py-1 text-left transition-colors " +
                          (activeId === t.id
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-accent")
                        }
                      >
                        {t.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <section>
        {active ? (
          <Card>
            <CardHeader>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABEL[active.category]}
              </p>
              <CardTitle>{active.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <article className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownInline source={active.body} />
              </article>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Welcome to Help</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Pick a topic on the left or type to search. Common starting points:
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setTopic("getting-started")}
                  >
                    Getting started
                  </button>{" "}
                  — sign in, navigate, run your first calculation.
                </li>
                <li>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setTopic("workbench")}
                  >
                    TVM workbench
                  </button>{" "}
                  — the spreadsheet-grade time-value-of-money tool.
                </li>
                <li>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setTopic("calculators")}
                  >
                    Tax calculators
                  </button>{" "}
                  — what each one does and when to use it.
                </li>
                <li>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setTopic("exports")}
                  >
                    Reports & exports
                  </button>{" "}
                  — PDF / XLSX / CSV / DOCX, watermarks, signed PDFs.
                </li>
                <li>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setTopic("shortcuts")}
                  >
                    Keyboard shortcuts
                  </button>{" "}
                  — cmd-K, workbench keys.
                </li>
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Long-form docs (with full source links) live under{" "}
                <code className="rounded bg-muted px-1">/docs/</code> in the repository — open that
                on the host for the canonical reference.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

/**
 * Tiny inline markdown renderer. Supports headings (## / ###), code
 * blocks (``` fenced), inline code (`...`), bold (**...**), italic
 * (*...*), unordered lists (- ), tables (pipe-delimited), and
 * paragraphs. Deliberately small — no external dep, no runtime CVE
 * surface from a third-party Markdown lib.
 */
function MarkdownInline({ source }: { source: string }): JSX.Element {
  const lines = source.split("\n");
  const out: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      out.push(
        <pre
          key={out.length}
          className="overflow-x-auto rounded bg-muted p-3 text-xs font-mono text-foreground"
        >
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    // Heading
    if (line.startsWith("### ")) {
      out.push(
        <h3 key={out.length} className="mt-4 text-base font-semibold">
          {inline(line.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(
        <h2 key={out.length} className="mt-5 text-lg font-semibold">
          {inline(line.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }

    // Table
    if (line.includes("|") && lines[i + 1]?.match(/^[\s|:-]+$/)) {
      const headers = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|")) {
        const cells = lines[i]!.split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (cells.length > 0) rows.push(cells);
        i++;
      }
      out.push(
        <div key={out.length} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="border-b">
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2 py-1.5 text-left font-medium">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b last:border-b-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1.5 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // List
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        items.push(lines[i]!.slice(2));
        i++;
      }
      out.push(
        <ul key={out.length} className="my-2 list-disc space-y-1 pl-5 text-sm">
          {items.map((it, ii) => (
            <li key={ii}>{inline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? "")) {
        items.push(lines[i]!.replace(/^\d+\.\s/, ""));
        i++;
      }
      out.push(
        <ol key={out.length} className="my-2 list-decimal space-y-1 pl-5 text-sm">
          {items.map((it, ii) => (
            <li key={ii}>{inline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim().length === 0) {
      i++;
      continue;
    }

    // Paragraph (gather consecutive non-empty / non-special lines)
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim().length > 0 &&
      !lines[i]!.startsWith("#") &&
      !lines[i]!.startsWith("- ") &&
      !lines[i]!.startsWith("```") &&
      !/^\d+\.\s/.test(lines[i] ?? "") &&
      !lines[i]!.includes("|")
    ) {
      paragraph.push(lines[i]!);
      i++;
    }
    if (paragraph.length > 0) {
      out.push(
        <p key={out.length} className="my-2 text-sm leading-relaxed">
          {inline(paragraph.join(" "))}
        </p>,
      );
    }
  }
  return <>{out}</>;
}

/** Inline formatting: **bold**, *italic*, `code`, [text](url). */
function inline(s: string): JSX.Element {
  const out: (string | JSX.Element)[] = [];
  let rest = s;
  let key = 0;
  // Order matters: code first to skip its content from other patterns.
  const patterns: { re: RegExp; render: (m: RegExpMatchArray) => JSX.Element }[] = [
    {
      re: /`([^`]+)`/,
      render: (m) => (
        <code key={key++} className="rounded bg-muted px-1 text-[0.85em]">
          {m[1]}
        </code>
      ),
    },
    {
      re: /\*\*([^*]+)\*\*/,
      render: (m) => (
        <strong key={key++} className="font-semibold">
          {m[1]}
        </strong>
      ),
    },
    {
      re: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (m) => (
        <a
          key={key++}
          href={m[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-4 hover:underline"
        >
          {m[1]}
        </a>
      ),
    },
  ];
  while (rest.length > 0) {
    let earliest: { idx: number; len: number; el: JSX.Element } | null = null;
    for (const p of patterns) {
      const m = rest.match(p.re);
      if (m && m.index !== undefined) {
        if (!earliest || m.index < earliest.idx) {
          earliest = { idx: m.index, len: m[0].length, el: p.render(m) };
        }
      }
    }
    if (!earliest) {
      out.push(rest);
      break;
    }
    if (earliest.idx > 0) out.push(rest.slice(0, earliest.idx));
    out.push(earliest.el);
    rest = rest.slice(earliest.idx + earliest.len);
  }
  return (
    <>
      {out.map((c, i) =>
        typeof c === "string" ? <Fragment key={i}>{c}</Fragment> : <Fragment key={i}>{c}</Fragment>,
      )}
    </>
  );
}
