import { getInsights } from "@/lib/synthesis/feed";
import { InsightsFeed } from "@/components/insights/insights-feed";

export default async function InsightsPage() {
  const initial = await getInsights().catch(() => []);
  return <InsightsFeed initial={initial} />;
}
