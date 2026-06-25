/**
 * Connector registry — MNEMO's senses + hands over external services. A connector only
 * contributes tools once its credentials are present (so the agent never sees a tool it
 * can't use). Reads are "senses" (run freely); writes are "hands" — tier `external`, so the
 * runtime turns them into proposals the owner approves (read freely, ask before acting).
 */
import type { AgentTool } from "@/lib/agent/tools";
import { loadSecrets } from "@/lib/connectors/secrets";
import { notionConfigured, notionSearch, notionReadPage, notionCreatePage, notionAppend } from "@/lib/connectors/notion";
import {
  googleConfigured,
  calendarUpcoming,
  calendarCreateEvent,
  gmailSearch,
  gmailReadMessage,
  gmailCreateDraft,
} from "@/lib/connectors/google";
import { githubConfigured, githubMyRepos, githubRecentActivity, githubCreateIssue } from "@/lib/connectors/github";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export interface ConnectorStatus {
  provider: "notion" | "google" | "github";
  label: string;
  connected: boolean;
  senses: string[];
  hands: string[];
  setup: string;
}

export async function connectorStatus(): Promise<ConnectorStatus[]> {
  await loadSecrets();
  return [
    {
      provider: "notion",
      label: "Notion",
      connected: notionConfigured(),
      senses: ["search your pages", "read a page"],
      hands: ["create a page", "append to a page"],
      setup: "Create an internal integration at notion.so/my-integrations, share the pages you want MNEMO to see, then paste its token above.",
    },
    {
      provider: "google",
      label: "Google (Calendar + Gmail)",
      connected: googleConfigured(),
      senses: ["upcoming events", "search + read email"],
      hands: ["create a calendar event", "draft an email"],
      setup: "Create a 'Desktop app' OAuth client (with the Calendar + Gmail APIs enabled) in Google Cloud Console, paste its ID + secret above, then run `pnpm connect:google` to authorize.",
    },
    {
      provider: "github",
      label: "GitHub",
      connected: githubConfigured(),
      senses: ["your recent repos", "your recent activity"],
      hands: ["open an issue"],
      setup: "Create a token (repo + read:user) at github.com/settings/tokens and paste it above.",
    },
  ];
}

/** The tools contributed by all *configured* connectors. */
export function connectorTools(): AgentTool[] {
  const tools: AgentTool[] = [];

  if (notionConfigured()) {
    tools.push(
      {
        name: "notion_search",
        tier: "read",
        description: "notion_search(query: string) — search the owner's Notion pages/databases.",
        run: async (a) => JSON.stringify(await notionSearch(str(a.query), 8)),
      },
      {
        name: "notion_read",
        tier: "read",
        description: "notion_read(id: string) — read the text of a Notion page.",
        run: async (a) => notionReadPage(str(a.id)),
      },
      {
        name: "notion_create_page",
        tier: "external",
        description: "notion_create_page(parentPageId: string, title: string, content: string) — create a new Notion page under a parent page.",
        run: async (a) => JSON.stringify(await notionCreatePage({ parentPageId: str(a.parentPageId), title: str(a.title), content: str(a.content) })),
      },
      {
        name: "notion_append",
        tier: "external",
        description: "notion_append(pageId: string, text: string) — append a paragraph to a Notion page.",
        run: async (a) => { await notionAppend(str(a.pageId), str(a.text)); return "appended"; },
      },
    );
  }

  if (googleConfigured()) {
    tools.push(
      {
        name: "calendar_upcoming",
        tier: "read",
        description: "calendar_upcoming(limit?: number) — the owner's upcoming Google Calendar events.",
        run: async (a) => JSON.stringify(await calendarUpcoming(Number(a.limit) || 10)),
      },
      {
        name: "gmail_search",
        tier: "read",
        description: "gmail_search(query: string) — search the owner's Gmail (Gmail query syntax). Returns sender/subject/snippet.",
        run: async (a) => JSON.stringify(await gmailSearch(str(a.query), 8)),
      },
      {
        name: "gmail_read",
        tier: "read",
        description: "gmail_read(id: string) — read the body of a specific email.",
        run: async (a) => gmailReadMessage(str(a.id)),
      },
      {
        name: "calendar_create_event",
        tier: "external",
        description: "calendar_create_event(summary: string, startISO: string, endISO: string, description?: string, location?: string) — add an event to the owner's calendar.",
        run: async (a) => JSON.stringify(await calendarCreateEvent({ summary: str(a.summary), startISO: str(a.startISO), endISO: str(a.endISO), description: str(a.description), location: str(a.location) })),
      },
      {
        name: "gmail_draft",
        tier: "external",
        description: "gmail_draft(to: string, subject: string, body: string) — create a Gmail DRAFT (never sends; the owner reviews + sends).",
        run: async (a) => JSON.stringify(await gmailCreateDraft({ to: str(a.to), subject: str(a.subject), body: str(a.body) })),
      },
    );
  }

  if (githubConfigured()) {
    tools.push(
      {
        name: "github_my_repos",
        tier: "read",
        description: "github_my_repos() — the owner's most recently worked-on repositories.",
        run: async () => JSON.stringify(await githubMyRepos(10)),
      },
      {
        name: "github_recent_activity",
        tier: "read",
        description: "github_recent_activity() — the owner's recent GitHub activity (pushes, issues, PRs).",
        run: async () => JSON.stringify(await githubRecentActivity(15)),
      },
      {
        name: "github_open_issue",
        tier: "external",
        description: "github_open_issue(repo: string, title: string, body?: string) — open an issue on one of the owner's repos (repo as 'owner/name').",
        run: async (a) => JSON.stringify(await githubCreateIssue({ repo: str(a.repo), title: str(a.title), body: str(a.body) })),
      },
    );
  }

  return tools;
}
