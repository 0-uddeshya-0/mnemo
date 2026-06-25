"use client";
import * as React from "react";
import { Check, Copy, Ear, KeyRound, Plus, Shield, SlidersHorizontal, Smartphone, Terminal, Trash2 } from "lucide-react";
import type { ConnectorStatus } from "@/lib/connectors";
import {
  createApiKeyAction,
  deleteApiKeyAction,
  listApiKeysAction,
  saveConnectorSecretsAction,
  updateDevSettingsAction,
  updateExposureAction,
  type AgentLogEntry,
  type ApiKeyView,
} from "@/app/(app)/settings/agents/actions";
import type { AgentExposure, DevSettings } from "@/lib/settings";
import { NODE_TYPES, NODE_TYPE_COLORS, type NodeType } from "@/lib/graph/constants";
import { OfflineCard } from "@/components/offline/offline-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { cn, timeAgo } from "@/lib/utils";

export function AgentsSettings({
  initialKeys,
  initialExposure,
  initialLog,
  connectors,
  dev,
  repoRoot,
  httpPort,
  appUrl,
}: {
  initialKeys: ApiKeyView[];
  initialExposure: AgentExposure;
  initialLog: AgentLogEntry[];
  connectors: ConnectorStatus[];
  dev: DevSettings;
  repoRoot: string;
  httpPort: number;
  appUrl: string;
}) {
  const [keys, setKeys] = React.useState(initialKeys);
  const [exposure, setExposure] = React.useState(initialExposure);
  const [log] = React.useState(initialLog);
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const [devState, setDevState] = React.useState(dev);

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        mnemosyne: { command: "pnpm", args: ["--filter", "@mnemosyne/web", "mcp"], cwd: repoRoot },
      },
    },
    null,
    2,
  );

  async function refreshKeys() {
    setKeys(await listApiKeysAction());
  }

  async function toggleType(t: NodeType) {
    const hidden = exposure.hiddenTypes.includes(t)
      ? exposure.hiddenTypes.filter((x) => x !== t)
      : [...exposure.hiddenTypes, t];
    const next = await updateExposureAction({ hiddenTypes: hidden });
    setExposure(next);
  }

  async function togglePrivate(v: boolean) {
    const next = await updateExposureAction({ exposePrivate: v });
    setExposure(next);
  }

  return (
    <div className="mx-auto h-full w-full max-w-[1100px] overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="display-title mb-1 text-2xl text-foreground sm:text-3xl">Settings</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Connectors, agent access, behavior — on your terms.
      </p>

      <div className="flex flex-col gap-6">
        <DevCard dev={devState} onChange={setDevState} />
        <OfflineCard />

        {/* MCP — developer-only */}
        {devState.developerMode && (
          <Card className="p-5">
            <SectionTitle icon={Terminal} title="MCP — Claude Desktop / Cursor" />
            <p className="mb-3 text-sm text-muted-foreground">
              Add this to your client's MCP config (stdio). The worker/DB must be running.
            </p>
            <CodeBlock text={stdioConfig} />
            <p className="mb-1.5 mt-4 text-sm text-muted-foreground">
              Or run the HTTP transport (<span className="font-mono">pnpm mcp -- --http</span>) and point an
              agent at:
            </p>
            <CodeBlock text={`http://localhost:${httpPort}  (Bearer: a read-scoped API key)`} />
          </Card>
        )}

        {/* Siri */}
        <SiriCard httpPort={httpPort} appUrl={appUrl} />

        {/* Connectors — senses + hands */}
        <ConnectorsCard connectors={connectors} />

        {/* API keys */}
        <Card className="p-5">
          <SectionTitle icon={KeyRound} title="API keys" />
          {newKey && (
            <div className="mb-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
              <p className="mb-1.5 text-xs text-primary">Copy this now — it won't be shown again.</p>
              <CodeBlock text={newKey} />
            </div>
          )}
          <CreateKeyForm
            onCreated={(key) => {
              setNewKey(key);
              refreshKeys();
            }}
          />
          <div className="mt-4 flex flex-col gap-2">
            {keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No keys yet.</p>
            ) : (
              keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2"
                >
                  <span className="text-sm text-foreground">{k.name}</span>
                  <span className="flex gap-1">
                    {k.scopes.map((s) => (
                      <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {s}
                      </span>
                    ))}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}
                  </span>
                  <button
                    onClick={async () => {
                      await deleteApiKeyAction(k.id);
                      refreshKeys();
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete key"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Exposure */}
        <Card className="p-5">
          <SectionTitle icon={Shield} title="Exposure controls" />
          <p className="mb-3 text-sm text-muted-foreground">
            What agents may never see — enforced on every read, regardless of key scope.
          </p>
          <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
            <span className="text-sm text-foreground">Expose private (encrypted) nodes</span>
            <Switch checked={exposure.exposePrivate} onCheckedChange={togglePrivate} />
          </div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Hidden node types</p>
          <div className="flex flex-wrap gap-1.5">
            {NODE_TYPES.filter((t) => t !== "self").map((t) => {
              const hidden = exposure.hiddenTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
                    hidden
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: NODE_TYPE_COLORS[t] }} />
                  {t.replace("_", " ")}
                  {hidden && " · hidden"}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Agent log — developer-only */}
        {devState.developerMode && (
          <Card className="p-5">
            <SectionTitle icon={Terminal} title="Connected-agent activity" />
            {log.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agent activity yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {log.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 py-1 text-xs">
                    <span className="font-mono text-muted-foreground">{e.action}</span>
                    <span className="text-foreground">{e.keyName ?? "—"}</span>
                    <span className="ml-auto text-muted-foreground">{timeAgo(e.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function DevCard({ dev, onChange }: { dev: DevSettings; onChange: (d: DevSettings) => void }) {
  function toggle(key: keyof DevSettings, v: boolean) {
    onChange({ ...dev, [key]: v });
    updateDevSettingsAction({ [key]: v });
  }
  return (
    <Card className="p-5">
      <SectionTitle icon={SlidersHorizontal} title="Behavior & developer" />
      <p className="mb-3 text-sm text-muted-foreground">
        Tune how MNEMO behaves — no code, effective immediately.
      </p>
      <div className="flex flex-col divide-y divide-border">
        <DevRow
          label="Daily digest"
          desc="Each morning MNEMO reviews what's new and leaves proposals."
          checked={dev.digestEnabled}
          onChange={(v) => toggle("digestEnabled", v)}
        />
        <DevRow
          label="Proactive questions"
          desc="Let MNEMO ask you a clarifying or curious question now and then."
          checked={dev.proactiveQuestions}
          onChange={(v) => toggle("proactiveQuestions", v)}
        />
        <DevRow
          label="Developer mode"
          desc="Reveal advanced panels — MCP config and raw agent activity."
          checked={dev.developerMode}
          onChange={(v) => toggle("developerMode", v)}
        />
      </div>
    </Card>
  );
}

function DevRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const CONNECTOR_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  notion: [{ key: "NOTION_TOKEN", label: "Internal integration token", placeholder: "ntn_… / secret_…" }],
  github: [{ key: "GITHUB_TOKEN", label: "Personal access token (repo + read:user)", placeholder: "ghp_… / github_pat_…" }],
  google: [
    { key: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth client ID", placeholder: "…apps.googleusercontent.com" },
    { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth client secret", placeholder: "GOCSPX-…" },
  ],
};

function appOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

const GOOGLE_RESULT: Record<string, { title: string; ok: boolean }> = {
  connected: { title: "Google connected ✓", ok: true },
  denied: { title: "Google authorization was denied", ok: false },
  bad_state: { title: "Google auth expired — please try again", ok: false },
  error: { title: "Couldn’t connect Google — check the client ID/secret + redirect URI", ok: false },
  missing_client: { title: "Add the Google client ID + secret first", ok: false },
};

function ConnectorsCard({ connectors }: { connectors: ConnectorStatus[] }) {
  const [list, setList] = React.useState(connectors);

  // Surface the Google OAuth result after the callback redirect, then clean the URL.
  React.useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("google");
    const r = code && GOOGLE_RESULT[code];
    if (!r) return;
    toast({ title: r.title, variant: r.ok ? "success" : "error" });
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState({}, "", url.toString());
  }, []);

  return (
    <Card className="p-5">
      <SectionTitle icon={Ear} title="Senses & Hands — connectors" />
      <p className="mb-4 text-sm text-muted-foreground">
        Let MNEMO see and act in your world. Reading is automatic; anything it wants to <i>do</i> is
        always proposed for your approval first. Paste a token below — it&apos;s encrypted on your
        Mac and takes effect immediately, no restart.
      </p>
      <div className="flex flex-col gap-3">
        {list.map((c) => (
          <ConnectorRow key={c.provider} c={c} onSaved={setList} />
        ))}
      </div>
    </Card>
  );
}

function ConnectorRow({ c, onSaved }: { c: ConnectorStatus; onSaved: (next: ConnectorStatus[]) => void }) {
  const fields = CONNECTOR_FIELDS[c.provider] ?? [];
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  function save() {
    const payload = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.trim()));
    if (Object.keys(payload).length === 0) return;
    startTransition(async () => {
      const next = await saveConnectorSecretsAction(payload);
      onSaved(next);
      setVals({});
      toast({ title: `${c.label} saved`, variant: "success" });
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{c.label}</span>
        {c.connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
            <Check className="size-3" /> connected
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
            not connected
          </span>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><b className="font-medium text-foreground/80">Senses:</b> {c.senses.join(", ")}</span>
        <span><b className="font-medium text-foreground/80">Hands:</b> {c.hands.join(", ")}</span>
      </div>
      <div className="flex flex-col gap-2">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <label className="w-full text-xs text-muted-foreground sm:w-44 sm:shrink-0">{f.label}</label>
            <Input
              type="password"
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={c.connected ? "•••••• (saved — paste to replace)" : f.placeholder}
              className="min-w-0 flex-1 font-mono text-xs"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={pending || Object.values(vals).every((v) => !v.trim())} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {c.provider === "google" && (
          <Button size="sm" variant="secondary" asChild>
            <a href="/api/connectors/google/start">{c.connected ? "Re-authorize Google" : "Connect Google"}</a>
          </Button>
        )}
      </div>
      {c.provider === "google" ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Create a <b>Web application</b> OAuth client in Google Cloud Console (Calendar + Gmail APIs
          enabled), add{" "}
          <span className="font-mono break-all">{`${appOrigin()}/api/connectors/google/callback`}</span>{" "}
          as an authorized redirect URI, paste the client ID + secret above and Save, then click
          “Connect Google”.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{c.setup}</p>
      )}
    </div>
  );
}

function SiriCard({ httpPort }: { httpPort: number; appUrl: string }) {
  return (
    <Card className="p-5">
      <SectionTitle icon={Smartphone} title="Connect Siri — talk to MNEMO by voice" />
      <p className="mb-4 text-sm text-muted-foreground">
        No native app, no $99 Apple dev account. A free Shortcut sends your voice to MNEMO and
        speaks the answer back. MNEMO reads freely; anything it wants to write is queued in your
        digest inbox to approve — never done silently.
      </p>

      <Step n={1} title="Create an API key">
        Make a <span className="font-mono">read</span> key below (or a{" "}
        <span className="font-mono">write</span> key to let MNEMO propose edits from Siri). Copy it.
      </Step>

      <Step n={2} title="Get your MNEMO URL (Tailscale — already set up)">
        MNEMO is already served privately over HTTPS to your devices. Print your stable URL:
        <div className="mt-2">
          <CodeBlock text="pnpm mnemo:expose" />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          It shows <span className="font-mono">https://&lt;your-mac&gt;.&lt;tailnet&gt;.ts.net</span>.
          Make sure Tailscale is signed in on your iPhone too (same account).
        </p>
      </Step>

      <Step n={3} title='Build the “Ask MNEMO” Shortcut'>
        In the Shortcuts app (iPhone/iPad/Mac), add these actions, then say “Hey Siri, Ask MNEMO”:
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li><b>Dictate Text</b> — captures what you say.</li>
          <li>
            <b>Get Contents of URL</b> → <span className="font-mono">{`<TUNNEL_URL>/api/agent`}</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Method: <span className="font-mono">POST</span></li>
              <li>Header <span className="font-mono">Authorization</span> = <span className="font-mono">Bearer YOUR_KEY</span></li>
              <li>Request Body: <span className="font-mono">JSON</span> → field <span className="font-mono">task</span> = the <i>Dictated Text</i></li>
            </ul>
          </li>
          <li><b>Get Dictionary Value</b> for key <span className="font-mono">spoken</span>.</li>
          <li><b>Speak Text</b> (the value from step 3).</li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">The request body MNEMO expects:</p>
        <div className="mt-1.5">
          <CodeBlock text={`{ "task": "<Dictated Text>" }`} />
        </div>
      </Step>

      <p className="mt-4 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
        <b>Coming on iOS 26:</b> Apple Intelligence can connect Siri directly to MCP servers. When
        that lands, point it at the MCP HTTP transport (<span className="font-mono">port {httpPort}</span>)
        over the same tunnel — no Shortcut needed.
      </p>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex gap-3">
      <span className="clay flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-semibold">
        {n}
      </span>
      <div className="text-sm text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Shield; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground">
        {text}
      </pre>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 rounded-md border border-border bg-surface px-1.5 py-1 text-muted-foreground hover:text-foreground"
        aria-label="Copy"
      >
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function CreateKeyForm({ onCreated }: { onCreated: (key: string) => void }) {
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<("read" | "write")[]>(["read"]);
  const [pending, startTransition] = React.useTransition();

  function toggleScope(s: "read" | "write") {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Key name (e.g. Claude Desktop)"
        className="w-56"
      />
      {(["read", "write"] as const).map((s) => (
        <button
          key={s}
          onClick={() => toggleScope(s)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs",
            scopes.includes(s) ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground",
          )}
        >
          {s}
        </button>
      ))}
      <Button
        size="sm"
        disabled={pending || !name.trim() || scopes.length === 0}
        onClick={() =>
          startTransition(async () => {
            const res = await createApiKeyAction({ name: name.trim(), scopes });
            if (res.ok) {
              onCreated(res.key);
              setName("");
              toast({ title: "Key created", variant: "success" });
            } else toast({ title: "Failed", description: res.error, variant: "error" });
          })
        }
      >
        <Plus className="size-4" /> Create
      </Button>
    </div>
  );
}
