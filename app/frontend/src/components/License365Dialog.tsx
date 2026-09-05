import { useEffect, useState } from "react";
import { M365LicenseReport } from "../../wailsjs/go/main/App";
import type { m365 } from "../../wailsjs/go/models";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LicensePicker } from "./LicensePicker";

// On-grid 365 check: pick which detected licence(s) to check (or all), then
// keep only the queried users who hold them and add licence + sign-in columns.
export function License365Dialog({
  count,
  busy,
  onApply,
  onClose,
}: {
  count: number;
  busy: boolean;
  onApply: (skus: string[]) => void;
  onClose: () => void;
}) {
  const [skus, setSkus] = useState<m365.LicenseSku[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    M365LicenseReport().then((s) => setSkus(s ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="ledger-dialog-title">Check Microsoft 365 licences</DialogTitle>
          <DialogDescription className="text-[12px] text-ink-3">
            Keep only the {count.toLocaleString()} queried users who hold the selected licence(s), and add licence + last-sign-in columns.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {loading
            ? <div className="flex items-center gap-2 text-[12.5px] text-ink-2">Detecting licences…</div>
            : <LicensePicker skus={skus} selected={selected} onChange={setSelected} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="px-5" disabled={busy || loading} onClick={() => onApply(selected)}>
            {busy ? "Checking…" : `Check ${count.toLocaleString()} users`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
