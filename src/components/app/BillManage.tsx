"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { archiveBillAction, deleteBillAction } from "@/app/actions/bills";
import { skipOccurrenceAction } from "@/app/actions/payments";
import { Button, LinkButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

export function BillManage({ billId, name, archived, openCount }: { billId: string; name: string; archived: boolean; openCount: number }) {
  const [dialog, setDialog] = useState<null | "archive" | "delete">(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <div className="flex flex-wrap gap-2">
      <LinkButton href={`/bills/${billId}/edit`} variant="secondary" size="sm">
        <Pencil size={16} aria-hidden /> Edit bill
      </LinkButton>
      {archived ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await archiveBillAction(billId, false);
              if (res.ok) {
                toast({ title: "Bill restored", mood: "neutral" });
                router.refresh();
              }
            })
          }
        >
          <ArchiveRestore size={16} aria-hidden /> Restore
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setDialog("archive")}>
          <Archive size={16} aria-hidden /> Archive
        </Button>
      )}
      <Button variant="danger" size="sm" onClick={() => setDialog("delete")}>
        <Trash2 size={16} aria-hidden /> Delete
      </Button>

      <Dialog open={dialog === "archive"} onClose={() => setDialog(null)} title={`Archive ${name}?`}>
        <p className="text-muted">Archiving stops reminders and hides the bill from your dashboard. Payment history is kept, and you can restore it any time.</p>
        {openCount > 0 && <p className="mt-3 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber">This bill has {openCount} unpaid {openCount === 1 ? "cycle" : "cycles"}. They&apos;ll stop showing until you restore it.</p>}
        <div className="mt-5 flex gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await archiveBillAction(billId, true);
                setDialog(null);
                if (res.ok) {
                  toast({ title: "Archived", body: "Reminders stopped. History kept.", mood: "neutral" });
                  router.refresh();
                } else toast({ title: res.error, tone: "error" });
              })
            }
          >
            Archive bill
          </Button>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <Dialog open={dialog === "delete"} onClose={() => setDialog(null)} title={`Delete ${name} permanently?`}>
        <p className="text-muted">This permanently deletes the bill, all its cycles, payment records and reminders. It can&apos;t be undone. To keep history, archive it instead.</p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await deleteBillAction(billId, confirm);
              if (!res.ok) return setError(res.error);
              toast({ title: "Bill deleted", mood: "neutral" });
              router.push("/bills");
              router.refresh();
            });
          }}
        >
          <Field label={`Type "${name}" to confirm`} htmlFor="confirm-delete" error={error ?? undefined}>
            <Input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" disabled={pending || confirm.trim().toLowerCase() !== name.trim().toLowerCase()}>
            Delete forever
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

export function UnskipButton({ occurrenceId }: { occurrenceId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await skipOccurrenceAction(occurrenceId, false);
          router.refresh();
        })
      }
    >
      Unskip
    </Button>
  );
}
