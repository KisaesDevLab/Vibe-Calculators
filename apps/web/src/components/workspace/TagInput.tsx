import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceApi, type TagRow } from "@/workspace/api";
import { Input } from "@/components/ui/input";

/**
 * Phase 20.4 — TagInput.
 *
 * Free-form tag input with autocomplete drawn from the firm-wide tag
 * pool. Selecting an existing tag attaches it; pressing Enter on a
 * novel string creates the tag *and* attaches it.
 *
 *   <TagInput entityKind="client" entityId={id} attachedTags={...} />
 */

export interface TagInputProps {
  entityKind: "client" | "engagement" | "calculation";
  entityId: string;
  attachedTags: TagRow[];
  onChange?: () => void;
}

export function TagInput({
  entityKind,
  entityId,
  attachedTags,
  onChange,
}: TagInputProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: suggestions } = useQuery({
    queryKey: ["workspace", "tags", "autocomplete", draft],
    queryFn: () => workspaceApi.listTags(draft || undefined),
    enabled: open,
    staleTime: 30_000,
  });

  const attachedNames = new Set(attachedTags.map((t) => t.name));

  async function attach(input: { tagId?: string; tagName?: string }): Promise<void> {
    await workspaceApi.attachTag({ ...input, entityKind, entityId });
    setDraft("");
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    onChange?.();
  }

  async function detach(tagId: string): Promise<void> {
    await workspaceApi.detachTag({ tagId, entityKind, entityId });
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    onChange?.();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {attachedTags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
          >
            {t.name}
            <button
              type="button"
              onClick={() => void detach(t.id)}
              aria-label={`Remove tag ${t.name}`}
              className="hover:text-destructive"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <Input
          ref={inputRef}
          value={draft}
          placeholder="Add tag…"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim().length > 0) {
              e.preventDefault();
              if (!attachedNames.has(draft.trim())) {
                void attach({ tagName: draft.trim() });
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && suggestions && suggestions.tags.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow">
            {suggestions.tags
              .filter((t) => !attachedNames.has(t.name))
              .slice(0, 8)
              .map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void attach({ tagId: t.id });
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>{t.name}</span>
                    {t.usageCount !== undefined && (
                      <span className="text-xs text-muted-foreground">{t.usageCount}×</span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
