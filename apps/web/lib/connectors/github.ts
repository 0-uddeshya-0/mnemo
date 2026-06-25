/**
 * GitHub connector — sees what the owner is building: their repos + recent activity.
 * Token-based (a personal access token in GITHUB_TOKEN; `repo` + `read:user` scopes).
 * Reads are senses; opening an issue is a hand → surfaced as a proposal. REST via fetch.
 */
import { secret } from "@/lib/connectors/secrets";

const API = "https://api.github.com";

export function githubConfigured(): boolean {
  return secret("GITHUB_TOKEN").length > 0;
}

async function gh(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secret("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "user-agent": "MNEMO",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return res.json();
}

export async function githubMe(): Promise<{ login: string }> {
  return gh("/user") as Promise<{ login: string }>;
}

export async function githubMyRepos(limit = 10) {
  const repos = (await gh(`/user/repos?sort=pushed&affiliation=owner&per_page=${limit}`)) as any[];
  return repos.map((r) => ({
    name: r.full_name,
    description: r.description,
    language: r.language,
    pushedAt: r.pushed_at,
    private: r.private,
    stars: r.stargazers_count,
    url: r.html_url,
  }));
}

export async function githubRecentActivity(limit = 15) {
  const me = await githubMe();
  const events = (await gh(`/users/${me.login}/events?per_page=${limit}`)) as any[];
  return events.map((e) => ({
    type: e.type,
    repo: e.repo?.name,
    at: e.created_at,
    commits: e.payload?.commits?.map((c: any) => c.message).slice(0, 3),
    action: e.payload?.action,
  }));
}

export async function githubCreateIssue(input: { repo: string; title: string; body?: string }): Promise<{ url: string }> {
  const data = (await gh(`/repos/${input.repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: input.title, body: input.body ?? "" }),
  })) as { html_url?: string };
  return { url: String(data.html_url ?? "") };
}
