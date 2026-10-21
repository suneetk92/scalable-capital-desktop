import { useState } from "react";
import { Modal } from "../ToolViews";
import { schemaArguments, type PublishedTool } from "../toolSchema";
import { pretty } from "../tools";
import { type Rec } from "../response";
import { Alert, btn, cx, EMPTY, RECORD_TABLE, SCROLL_X } from "../ui";

type Part = "arguments" | "input" | "output";
const PARTS: { id: Part; label: string }[] = [
  { id: "arguments", label: "Arguments" },
  { id: "input", label: "Input schema" },
  { id: "output", label: "Output schema" },
];

function Json({ value, empty }: { value: unknown; empty: string }) {
  if (value === null || value === undefined) return <p className={EMPTY}>{empty}</p>;
  return <pre className="max-h-96 overflow-auto rounded-control bg-inset p-2.5 break-words whitespace-pre-wrap select-text">{pretty(value)}</pre>;
}

/** Shows what Scalable publishes for one tool in `tools/list`: its arguments, input schema and output schema. */
export function ToolSchemaModal({
  name,
  tool,
  loading,
  error,
  onReload,
  onNotify,
  onClose,
}: {
  name: string;
  tool: PublishedTool | undefined;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onNotify: (text: string) => void;
  onClose: () => void;
}) {
  const [part, setPart] = useState<Part>("arguments");
  const rows = schemaArguments(tool?.inputSchema);
  const annotations = tool?.annotations as Rec | null | undefined;
  const hints = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].filter((key) => annotations?.[key] === true).map((key) => key.replace("Hint", ""));

  async function copy() {
    const value = part === "output" ? tool?.outputSchema : tool?.inputSchema;
    try {
      await navigator.clipboard.writeText(pretty(value ?? null));
      onNotify("Schema copied.");
    } catch {
      onNotify("Could not copy to the clipboard.");
    }
  }

  return (
    <Modal title={tool?.title || name} onClose={onClose} wide>
      <p className="mb-2 text-ink-muted">
        <code className="text-ink-accent-bright">{name}</code>
        {hints.length > 0 && ` · ${hints.join(", ")}`}
      </p>
      {error && <Alert>{error}</Alert>}
      {!tool && !error && <p className={EMPTY}>{loading ? "Fetching the schema from Scalable…" : "Scalable does not list this tool."}</p>}
      {tool && (
        <>
          {tool.description && <p className="mb-3 max-h-[7.3333rem] overflow-y-auto leading-relaxed text-ink-soft">{tool.description}</p>}
          <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Schema part">
            {PARTS.map((item) => (
              <button key={item.id} type="button" aria-pressed={part === item.id} className={btn.mode(part === item.id)} onClick={() => setPart(item.id)}>
                {item.label}
              </button>
            ))}
            {part !== "arguments" && (
              <button type="button" className={cx(btn.link, "ml-auto")} onClick={() => void copy()}>
                Copy JSON
              </button>
            )}
          </div>
          {part === "arguments" &&
            (rows.length === 0 ? (
              <p className={EMPTY}>This tool takes no arguments.</p>
            ) : (
              <div className={SCROLL_X}>
                <table className={cx(RECORD_TABLE, "[&_td]:max-w-none! [&_td]:whitespace-normal [&_td]:align-top")}>
                  <thead>
                    <tr>
                      <th scope="col">Argument</th>
                      <th scope="col">Type</th>
                      <th scope="col">Required</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name}>
                        <td>
                          <code>{row.name}</code>
                        </td>
                        <td className="break-words">{row.type}</td>
                        <td>{row.required ? "Yes" : "No"}</td>
                        <td className="text-ink-muted">{row.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          {part === "input" && <Json value={tool.inputSchema} empty="Scalable published no input schema for this tool." />}
          {part === "output" && <Json value={tool.outputSchema} empty="Scalable published no output schema for this tool." />}
        </>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-caption text-ink-muted">
        <span>Fetched from Scalable’s tool list, not stored in the app.</span>
        <button type="button" className={btn.link} disabled={loading} onClick={onReload}>
          {loading ? "Loading…" : "Reload from Scalable"}
        </button>
      </div>
    </Modal>
  );
}
