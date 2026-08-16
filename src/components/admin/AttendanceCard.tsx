import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AttendanceRecord } from "@/lib/attendance";
import { cn } from "@/lib/utils";

interface AttendanceCardProps {
  record: AttendanceRecord;
  saving: boolean;
  onChange: (patch: {
    registrantPresent: boolean;
    adultsPresent: number;
    kidsPresent: number;
  }) => void;
}

function memberLabel(memberType: string): string {
  if (memberType === "verified-members") return "Verified";
  if (memberType === "guest") return "Guest";
  if (memberType === "regular") return "Member";
  return memberType || "Member";
}

export function AttendanceCard({ record, saving, onChange }: AttendanceCardProps) {
  const hasPlusOnes = record.adultParticipants > 0 || record.kidParticipants > 0;
  const isPresent = record.registrantPresent;

  function toggleRegistrant() {
    onChange({
      registrantPresent: !record.registrantPresent,
      adultsPresent: record.adultsPresent,
      kidsPresent: record.kidsPresent,
    });
  }

  function setAdults(count: number) {
    onChange({
      registrantPresent: record.registrantPresent,
      adultsPresent: Math.max(0, Math.min(count, record.adultParticipants)),
      kidsPresent: record.kidsPresent,
    });
  }

  function setKids(count: number) {
    onChange({
      registrantPresent: record.registrantPresent,
      adultsPresent: record.adultsPresent,
      kidsPresent: Math.max(0, Math.min(count, record.kidParticipants)),
    });
  }

  return (
    <Card
      className={cn(
        "transition-colors",
        isPresent && "border-green-600/40 bg-green-50/50 dark:bg-green-950/20"
      )}
    >
      <CardContent className="space-y-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight">{record.name || "—"}</p>
            {record.phone ? (
              <p className="text-sm text-muted-foreground mt-1">{record.phone}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5">{memberLabel(record.memberType)}</span>
              {hasPlusOnes ? (
                <span className="rounded-full bg-muted px-2 py-0.5">
                  +{record.adultParticipants} adult{record.adultParticipants !== 1 ? "s" : ""}
                  {record.kidParticipants > 0
                    ? `, ${record.kidParticipants} kid${record.kidParticipants !== 1 ? "s" : ""}`
                    : ""}
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5">Solo</span>
              )}
            </div>
          </div>
        </div>

        <Button
          type="button"
          variant={isPresent ? "default" : "outline"}
          className={cn(
            "h-12 w-full text-base font-semibold",
            isPresent && "bg-green-600 hover:bg-green-700"
          )}
          disabled={saving}
          onClick={toggleRegistrant}
        >
          {isPresent ? "Here ✓" : "Mark Here"}
        </Button>

        {record.adultParticipants > 0 ? (
          <StepperRow
            label={`Adults (${record.adultsPresent}/${record.adultParticipants})`}
            value={record.adultsPresent}
            max={record.adultParticipants}
            disabled={saving}
            onDecrement={() => setAdults(record.adultsPresent - 1)}
            onIncrement={() => setAdults(record.adultsPresent + 1)}
          />
        ) : null}

        {record.kidParticipants > 0 ? (
          <StepperRow
            label={`Kids (${record.kidsPresent}/${record.kidParticipants})`}
            value={record.kidsPresent}
            max={record.kidParticipants}
            disabled={saving}
            onDecrement={() => setKids(record.kidsPresent - 1)}
            onIncrement={() => setKids(record.kidsPresent + 1)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function StepperRow({
  label,
  value,
  max,
  disabled,
  onDecrement,
  onIncrement,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={disabled || value <= 0}
          onClick={onDecrement}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-4" />
        </Button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={disabled || value >= max}
          onClick={onIncrement}
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
