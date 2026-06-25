import { AskChat } from "@/components/ask/ask-chat";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <AskChat initialQuery={q ?? ""} />;
}
