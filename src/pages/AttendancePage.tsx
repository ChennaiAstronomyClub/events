import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { AdminGate } from "@/components/admin/AdminGate";
import {
  getDefaultAttendanceFormId,
  getFormConfig,
  getListedFormConfigs,
} from "@/config/forms";
import { formatIstDateTime, formatIstTime } from "@/lib/datetime";
import { AttendanceCard } from "@/components/admin/AttendanceCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAttendanceList,
  updateAttendanceRecord,
  expectedHeadcount,
  isAnyonePresent,
  presentHeadcount,
  type AttendanceRecord,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";

type AttendanceFilter = "all" | "here" | "not-here";

export function AttendancePage() {
  return (
    <AdminGate>
      <AttendanceCheckIn />
    </AdminGate>
  );
}

function AttendanceCheckIn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const listedForms = getListedFormConfigs();
  const defaultFormId = getDefaultAttendanceFormId();
  const paramFormId = searchParams.get("formId") ?? "";
  const initialFormId =
    paramFormId && getFormConfig(paramFormId) ? paramFormId : defaultFormId;

  const [formId, setFormId] = useState(initialFormId);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AttendanceFilter>("all");
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());

  const selectedForm = getFormConfig(formId);

  const loadRoster = useCallback(async (targetFormId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAttendanceList(targetFormId);
      if (!data.success || !data.registrations) {
        setError(data.error ?? data.message ?? "Failed to load roster");
        setRecords([]);
        return;
      }
      setRecords(data.registrations);
    } catch {
      setError("Network error");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!formId) return;
    void loadRoster(formId);
  }, [formId, loadRoster]);

  function handleFormChange(nextFormId: string) {
    setFormId(nextFormId);
    setSearchParams(nextFormId ? { formId: nextFormId } : {}, { replace: true });
  }

  const summary = useMemo(() => {
    let expected = 0;
    let present = 0;
    let checkedIn = 0;
    for (const record of records) {
      expected += expectedHeadcount(record);
      present += presentHeadcount(record);
      if (isAnyonePresent(record)) checkedIn += 1;
    }
    return {
      registrations: records.length,
      expected,
      present,
      checkedIn,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((record) => {
      if (filter === "here" && !isAnyonePresent(record)) return false;
      if (filter === "not-here" && isAnyonePresent(record)) return false;
      if (!q) return true;
      return (
        record.name.toLowerCase().includes(q) ||
        record.phone.toLowerCase().includes(q) ||
        record.email.toLowerCase().includes(q)
      );
    });
  }, [records, search, filter]);

  async function handleRecordChange(
    record: AttendanceRecord,
    patch: {
      registrantPresent: boolean;
      adultsPresent: number;
      kidsPresent: number;
    }
  ) {
    const previous = { ...record };
    const optimistic: AttendanceRecord = { ...record, ...patch };

    setRecords((prev) =>
      prev.map((r) => (r.sheetRow === record.sheetRow ? optimistic : r))
    );
    setSavingRows((prev) => new Set(prev).add(record.sheetRow));

    try {
      const result = await updateAttendanceRecord(formId, record, patch);
      if (!result.success) {
        setRecords((prev) =>
          prev.map((r) => (r.sheetRow === record.sheetRow ? previous : r))
        );
        setError(result.error ?? "Failed to save attendance");
        return;
      }
      setError(null);
    } catch {
      setRecords((prev) =>
        prev.map((r) => (r.sheetRow === record.sheetRow ? previous : r))
      );
      setError("Network error while saving");
    } finally {
      setSavingRows((prev) => {
        const next = new Set(prev);
        next.delete(record.sheetRow);
        return next;
      });
    }
  }

  return (
    <div className="-mx-1 space-y-4 sm:mx-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Attendance Check-in</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Mark registrants and +1s at the door. Changes save to Google Sheets.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">Admin home</Link>
        </Button>
      </div>

      <div className="sticky top-0 z-10 -mx-4 space-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-lg sm:border sm:px-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Select value={formId} onValueChange={handleFormChange}>
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent>
              {listedForms.map((form) => (
                <SelectItem key={form.id} value={form.id}>
                  {form.title}
                  {form.talkTitle ? ` — ${form.talkTitle}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            disabled={loading}
            onClick={() => void loadRoster(formId)}
          >
            <RefreshCw className={cn("mr-2 size-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {selectedForm?.startTime ? (
          <p className="text-xs text-muted-foreground">
            {formatIstDateTime(selectedForm.startTime)}
            {selectedForm.endTime ? ` – ${formatIstTime(selectedForm.endTime)}` : ""}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <SummaryTile label="Registered" value={String(summary.registrations)} />
          <SummaryTile
            label="People here"
            value={`${summary.present}/${summary.expected}`}
            highlight
          />
          <SummaryTile label="Parties checked in" value={String(summary.checkedIn)} />
        </div>

        <Input
          type="search"
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base"
        />

        <div className="flex gap-2">
          {(["all", "not-here", "here"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              className="flex-1"
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value === "here" ? "Here" : "Not here"}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading roster…</div>
      ) : filteredRecords.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {records.length === 0
            ? "No confirmed registrations for this event."
            : "No matches for your search or filter."}
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {filteredRecords.map((record) => (
            <AttendanceCard
              key={record.sheetRow}
              record={record}
              saving={savingRows.has(record.sheetRow)}
              onChange={(patch) => void handleRecordChange(record, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2 py-2",
        highlight && "border-green-600/30 bg-green-50/50 dark:bg-green-950/20"
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
