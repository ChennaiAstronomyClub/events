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
  displayName,
  expectedHeadcount,
  expectedAdultsCount,
  expectedKidsCount,
  arrivedAdultsCount,
  arrivedKidsCount,
  isAnyonePresent,
  presentHeadcount,
  type AttendancePatch,
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
  const [filter, setFilter] = useState<AttendanceFilter>("not-here");
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
    for (const record of records) {
      expected += expectedHeadcount(record);
      present += presentHeadcount(record);
    }
    return {
      registrations: records.length,
      expected,
      present,
      adultsPresent: arrivedAdultsCount(records),
      adultsExpected: expectedAdultsCount(records),
      kidsPresent: arrivedKidsCount(records),
      kidsExpected: expectedKidsCount(records),
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((record) => {
      if (filter === "here" && !isAnyonePresent(record)) return false;
      if (filter === "not-here" && isAnyonePresent(record)) return false;
      if (!q) return true;
      return (
        displayName(record).toLowerCase().includes(q) ||
        record.name.toLowerCase().includes(q) ||
        record.phone.toLowerCase().includes(q) ||
        record.email.toLowerCase().includes(q)
      );
    });
  }, [records, search, filter]);

  const handleSave = useCallback(
    async (record: AttendanceRecord, patch: AttendancePatch) => {
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
        if (result.record?.attendanceUpdatedAt) {
          setRecords((prev) =>
            prev.map((r) =>
              r.sheetRow === record.sheetRow
                ? { ...r, attendanceUpdatedAt: result.record!.attendanceUpdatedAt }
                : r
            )
          );
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
    },
    [formId]
  );

  return (
    <div className="-mx-1 space-y-3 sm:mx-0 sm:space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">Check-in</h1>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/admin">Admin</Link>
        </Button>
      </div>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:space-y-3 sm:rounded-lg sm:border sm:px-4 sm:py-3">
        <div className="flex gap-2">
          <Select value={formId} onValueChange={handleFormChange}>
            <SelectTrigger className="h-10 min-w-0 flex-1 text-sm sm:h-11 sm:text-base">
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
            size="icon"
            className="h-10 w-10 shrink-0 sm:h-11 sm:w-auto sm:px-3"
            disabled={loading}
            onClick={() => void loadRoster(formId)}
            aria-label="Refresh roster"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            <span className="hidden sm:ml-2 sm:inline">Refresh</span>
          </Button>
        </div>

        {selectedForm?.startTime ? (
          <p className="text-[11px] text-muted-foreground sm:text-xs">
            {formatIstDateTime(selectedForm.startTime)}
            {selectedForm.endTime ? ` – ${formatIstTime(selectedForm.endTime)}` : ""}
          </p>
        ) : null}

        <AttendanceSummaryBar summary={summary} />

        <Input
          type="search"
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 text-base sm:h-11"
        />

        <div className="flex gap-1.5 sm:gap-2">
          {(["all", "not-here", "here"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              className="h-9 flex-1 px-2 text-xs sm:h-8 sm:text-sm"
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value === "here" ? "Arrived" : "Waiting"}
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
              onSave={(patch) => void handleSave(record, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttendanceSummaryBar({
  summary,
}: {
  summary: {
    registrations: number;
    expected: number;
    present: number;
    adultsPresent: number;
    adultsExpected: number;
    kidsPresent: number;
    kidsExpected: number;
  };
}) {
  const detailParts = [`${summary.registrations} registered`];
  if (summary.adultsExpected > 0) {
    detailParts.push(`adults ${summary.adultsPresent}/${summary.adultsExpected}`);
  }
  if (summary.kidsExpected > 0) {
    detailParts.push(`kids ${summary.kidsPresent}/${summary.kidsExpected}`);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="shrink-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Arrived
        </p>
        <p className="text-2xl font-bold leading-none tabular-nums">
          {summary.present}
          <span className="text-base font-semibold text-muted-foreground">
            /{summary.expected}
          </span>
        </p>
      </div>
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground tabular-nums sm:text-xs">
        {detailParts.join(" · ")}
      </p>
    </div>
  );
}
