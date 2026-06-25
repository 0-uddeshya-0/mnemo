import { CapturePanel } from "@/components/capture/capture-panel";
import { ConnectorsPanel } from "@/components/capture/connectors-panel";
import { ArchiveImport } from "@/components/capture/archive-import";
import { listConnectorStatus } from "@/lib/connectors/status";

export default async function CapturePage() {
  const connectors = await listConnectorStatus().catch(() => []);
  return (
    <div className="h-full overflow-y-auto">
      <CapturePanel
        importTab={
          <div className="flex flex-col gap-5">
            <ArchiveImport />
            <ConnectorsPanel initial={connectors} />
          </div>
        }
      />
    </div>
  );
}
