import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  clearPatch,
  displayName,
  expectedHeadcount,
  formatArrivedBreakdown,
  formatExpectedGuestHint,
  fullPartyPatch,
  maxAdultsTotal,
  partialPatch,
  presentHeadcount,
  recordToAdultsTotal,
  recordToKidsTotal,
  type AttendancePatch,
  type AttendanceRecord,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";

interface AttendanceCardProps {
  record: AttendanceRecord;
  saving: boolean;
  onSave: (patch: AttendancePatch) => void;
}

function memberLabel(memberType: string): string {
  if (memberType === "verified-members") return "Verified";
  if (memberType === "guest") return "Guest";
  if (memberType === "regular") return "Member";
  return memberType || "Member";
}

export function AttendanceCard({ record, saving, onSave }: AttendanceCardProps) {
  const expected = expectedHeadcount(record);
  const present = presentHeadcount(record);
  const isSaved = present > 0;
  const isFull = isSaved && present === expected;
  const isPartialSaved = isSaved && present < expected;
  const hasGuests = expected > 1;
  const guestHint = formatExpectedGuestHint(record);
  const arrivedBreakdown = formatArrivedBreakdown(record);

  const [partialOpen, setPartialOpen] = useState(false);
  const [draftAdults, setDraftAdults] = useState(1);
  const [draftKids, setDraftKids] = useState(0);

  useEffect(() => {
    setPartialOpen(false);
  }, [record.sheetRow, record.attendanceUpdatedAt]);

  function openPartialDraft(adults: number, kids: number) {
    setDraftAdults(adults);
    setDraftKids(kids);
    setPartialOpen(true);
  }

  function handleCheckInFullParty() {
    onSave(fullPartyPatch(record));
  }

  function handleClear() {
    onSave(clearPatch());
    setPartialOpen(false);
  }

  function handleSubmitPartial() {
    onSave(partialPatch(draftAdults, draftKids, record));
    setPartialOpen(false);
  }

  function handleEdit() {
    openPartialDraft(recordToAdultsTotal(record), recordToKidsTotal(record));
  }

  const draftTotal = draftAdults + draftKids;
  const maxAdults = maxAdultsTotal(record);
  const canSubmitPartial =
    draftTotal > 0 && draftTotal <= expected && !saving;

  return (
    <Card
      className={cn(
        "transition-colors",
        isFull && "border-primary/25 bg-muted/20",
        isPartialSaved && "border-amber-500/25 bg-muted/20"
      )}
    >
      <CardContent className="space-y-4 pt-4">
        <div>
          <p className="text-xl font-bold leading-tight">{displayName(record)}</p>
          {record.phone ? (
            <p className="text-sm text-muted-foreground mt-1">{record.phone}</p>
          ) : null}
          <p className="text-sm text-muted-foreground mt-1">
            {memberLabel(record.memberType)} · Party of {expected}
            {guestHint ? ` · ${guestHint}` : ""}
          </p>
        </div>

        {isSaved && !partialOpen ? (
          <SavedSummary
            present={present}
            expected={expected}
            isFull={isFull}
            breakdown={arrivedBreakdown}
            saving={saving}
            onClear={handleClear}
            onEdit={hasGuests ? handleEdit : undefined}
          />
        ) : partialOpen ? (
          <PartialForm
            draftAdults={draftAdults}
            draftKids={draftKids}
            maxAdults={maxAdults}
            maxKids={record.kidParticipants}
            expected={expected}
            draftTotal={draftTotal}
            canSubmit={canSubmitPartial}
            saving={saving}
            onAdultsChange={setDraftAdults}
            onKidsChange={setDraftKids}
            onSubmit={handleSubmitPartial}
            onCancel={() => setPartialOpen(false)}
          />
        ) : hasGuests ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="default"
              className="h-12 flex-1 text-base font-semibold"
              disabled={saving}
              onClick={handleCheckInFullParty}
            >
              All {expected}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 flex-1 text-base font-semibold"
              disabled={saving}
              onClick={() => openPartialDraft(1, 0)}
            >
              Partial
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="default"
            className="h-12 w-full text-base font-semibold"
            disabled={saving}
            onClick={handleCheckInFullParty}
          >
            Check In
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SavedSummary({
  present,
  expected,
  isFull,
  breakdown,
  saving,
  onClear,
  onEdit,
}: {
  present: number;
  expected: number;
  isFull: boolean;
  breakdown: string | null;
  saving: boolean;
  onClear: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium tabular-nums">
          {isFull ? `${present} arrived` : `${present} of ${expected} arrived`}
        </p>
        {breakdown ? (
          <p className="text-sm text-muted-foreground tabular-nums">{breakdown}</p>
        ) : null}
        {saving ? (
          <p className="text-xs text-muted-foreground">Saving…</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        {onEdit ? (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={saving}
            onClick={onEdit}
          >
            Edit
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={saving}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function PartialForm({
  draftAdults,
  draftKids,
  maxAdults,
  maxKids,
  expected,
  draftTotal,
  canSubmit,
  saving,
  onAdultsChange,
  onKidsChange,
  onSubmit,
  onCancel,
}: {
  draftAdults: number;
  draftKids: number;
  maxAdults: number;
  maxKids: number;
  expected: number;
  draftTotal: number;
  canSubmit: boolean;
  saving: boolean;
  onAdultsChange: (n: number) => void;
  onKidsChange: (n: number) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Partial check-in</p>
      <CountStepper
        label="Adults (incl. registrant)"
        value={draftAdults}
        min={0}
        max={maxAdults}
        onChange={onAdultsChange}
      />
      {maxKids > 0 ? (
        <CountStepper
          label="Kids"
          value={draftKids}
          min={0}
          max={maxKids}
          onChange={onKidsChange}
        />
      ) : null}
      <p className="text-sm text-muted-foreground tabular-nums">
        Total: {draftTotal} of {expected}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          className="flex-1"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {saving ? "Saving…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}

function CountStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-4" />
        </Button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
