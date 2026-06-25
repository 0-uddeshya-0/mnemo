import { CommandSearch } from "@/components/search/command-search";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return (
    <div className="h-full">
      <CommandSearch initialQuery={q ?? ""} />
    </div>
  );
}
