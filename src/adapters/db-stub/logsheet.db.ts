import type { LogSheetPort, QueueImportRow } from "@/ports/logsheet";

// Sheets integration is a later phase; until then queue rows arrive via
// scripts/import-queue.ts or the dashboard, and write-back is a no-op.
export class DbStubLogSheetAdapter implements LogSheetPort {
  async importReadyRows(): Promise<QueueImportRow[]> {
    return [];
  }

  async writeBackStatus(): Promise<void> {
    // no-op until SheetsAdapter exists
  }
}
