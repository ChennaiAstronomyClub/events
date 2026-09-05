import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { AdminGate } from "@/components/admin/AdminGate";
import {
  getDefaultAttendanceFormId,
  getFormConfig,
  getListedFormConfigs,
} from "@/config/forms";
import {
  applyCalendarEventOverrides,
  CALENDAR_TITLE_MAX,
  CALENDAR_URL_MAX,
  CALENDAR_VENUE_MAX,
  getCalendarEvent,
} from "@/lib/calendar/event";
import {
  defaultInviteHtml,
  defaultInviteSubject,
  htmlHasText,
  INVITE_SUBJECT_MAX,
} from "@/lib/calendar/email";
import { formatIstDateTime, formatIstTime } from "@/lib/datetime";
import {
  fetchAttendanceList,
  type AttendanceRecord,
} from "@/lib/attendance";
import { sendCalendarInvites } from "@/lib/calendar-invites";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const InviteRichTextEditor = lazy(() => import("@/components/admin/InviteRichTextEditor"));

export function CalendarInvitesPage() {
  return (
    <AdminGate>
      <CalendarInvitesPanel />
    </AdminGate>
  );
}

function CalendarInvitesPanel() {
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
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState(
    () => getCalendarEvent(initialFormId)?.title ?? ""
  );
  const [eventVenue, setEventVenue] = useState(
    () => getCalendarEvent(initialFormId)?.venue ?? ""
  );
  const [eventUrl, setEventUrl] = useState(
    () => getCalendarEvent(initialFormId)?.url ?? ""
  );
  const [subject, setSubject] = useState(() => {
    const event = getCalendarEvent(initialFormId);
    return event ? defaultInviteSubject(event) : "";
  });
  const [body, setBody] = useState(() => {
    const event = getCalendarEvent(initialFormId);
    return event ? defaultInviteHtml(event) : "";
  });
  const [editorKey, setEditorKey] = useState(0);

  const selectedForm = getFormConfig(formId);
  const calendarEvent = formId ? getCalendarEvent(formId) : null;

  const loadRoster = useCallback(async (targetFormId: string) => {
    setLoading(true);
    setError(null);
    setResultMessage(null);
    setConfirming(false);
    try {
      const data = await fetchAttendanceList(targetFormId);
      if (!data.success || !data.registrations) {
        setError(data.error ?? data.message ?? "Failed to load roster");
        setRecords([]);
        setSelectedEmails(new Set());
        return;
      }
      setRecords(data.registrations);
      setSelectedEmails(
        new Set(
          data.registrations
            .map((record) => record.email.trim().toLowerCase())
            .filter(Boolean)
        )
      );
    } catch {
      setError("Network error");
      setRecords([]);
      setSelectedEmails(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  function applyDefaultCopy(nextFormId: string) {
    const event = getCalendarEvent(nextFormId);
    const title = event?.title ?? "";
    const venue = event?.venue ?? "";
    const url = event?.url ?? "";
    setEventTitle(title);
    setEventVenue(venue);
    setEventUrl(url);
    const forCopy = event
      ? applyCalendarEventOverrides(event, { title, venue, url })
      : null;
    setSubject(forCopy ? defaultInviteSubject(forCopy) : "");
    setBody(forCopy ? defaultInviteHtml(forCopy) : "");
    setEditorKey((key) => key + 1);
  }

  useEffect(() => {
    if (!formId) return;
    void loadRoster(formId);
  }, [formId, loadRoster]);

  function handleFormChange(nextFormId: string) {
    setFormId(nextFormId);
    setSearchParams({ formId: nextFormId }, { replace: true });
    applyDefaultCopy(nextFormId);
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((record) => {
      const name = record.name.toLowerCase();
      const email = record.email.toLowerCase();
      const phone = record.phone.toLowerCase();
      return name.includes(q) || email.includes(q) || phone.includes(q);
    });
  }, [records, search]);

  const filteredEmails = useMemo(
    () =>
      filteredRecords
        .map((record) => record.email.trim().toLowerCase())
        .filter(Boolean),
    [filteredRecords]
  );

  const allFilteredSelected =
    filteredEmails.length > 0 && filteredEmails.every((email) => selectedEmails.has(email));

  function toggleEmail(email: string) {
    const key = email.trim().toLowerCase();
    if (!key) return;
    setSelectedEmails((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedEmails((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        for (const email of filteredEmails) next.delete(email);
      } else {
        for (const email of filteredEmails) next.add(email);
      }
      return next;
    });
  }

  const selectedCount = selectedEmails.size;
  const copyReady = Boolean(subject.trim() && htmlHasText(body) && eventTitle.trim());

  function resetEmailCopy() {
    applyDefaultCopy(formId);
  }

  async function handleSend() {
    if (!calendarEvent || selectedCount === 0 || !copyReady) return;
    setSending(true);
    setError(null);
    setResultMessage(`Sending 0 of ${selectedCount}…`);
    try {
      const data = await sendCalendarInvites(
        formId,
        [...selectedEmails],
        {
          subject: subject.trim(),
          body: body.trim(),
          title: eventTitle.trim(),
          venue: eventVenue.trim(),
          url: eventUrl.trim(),
        },
        ({ processed, total }) => {
          if (total > 0) {
            setResultMessage(`Sending ${processed} of ${total}…`);
          }
        }
      );
      if (!data.success) {
        setError(data.message ?? data.error ?? "Failed to send invites");
        if ((data.sent ?? 0) > 0) {
          setResultMessage(
            `Sent ${data.sent ?? 0}. Failed ${data.failed ?? 0}. Skipped ${data.skipped ?? 0}.`
          );
        }
        return;
      }
      setResultMessage(
        `Sent ${data.sent ?? 0}. Failed ${data.failed ?? 0}. Skipped ${data.skipped ?? 0}.`
      );
      setConfirming(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send invites";
      setError(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="-mx-1 space-y-4 sm:mx-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Calendar invites</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Email an ICS calendar invite to all or selected confirmed registrants.
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
        ) : (
          <p className="text-xs text-muted-foreground">
            This event has no start and end time, so calendar invites cannot be sent.
          </p>
        )}

        <Input
          type="search"
          placeholder="Search name, email, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={filteredEmails.length === 0}
            onClick={toggleSelectAllFiltered}
          >
            {allFilteredSelected ? "Deselect all" : "Select all"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {selectedCount} selected
          </span>
        </div>

        {confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Send invite to {selectedCount} {selectedCount === 1 ? "person" : "people"}?
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={sending || !calendarEvent || !copyReady}
                onClick={() => void handleSend()}
              >
                <CalendarPlus className="size-4" />
                {sending ? "Sending…" : "Confirm send"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={!calendarEvent || selectedCount === 0 || loading || sending || !copyReady}
            onClick={() => setConfirming(true)}
          >
            <CalendarPlus className="size-4" />
            Send invite{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </Button>
        )}
      </div>

      {calendarEvent ? (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Calendar event</h2>
            <Button type="button" variant="ghost" size="sm" onClick={resetEmailCopy}>
              Reset to default
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-title">Title</Label>
            <Input
              id="invite-title"
              value={eventTitle}
              maxLength={CALENDAR_TITLE_MAX}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="Event title"
              disabled={sending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-venue">Venue</Label>
            <Input
              id="invite-venue"
              value={eventVenue}
              maxLength={CALENDAR_VENUE_MAX}
              onChange={(e) => setEventVenue(e.target.value)}
              placeholder="Location shown on the calendar invite"
              disabled={sending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-url">Event URL</Label>
            <Input
              id="invite-url"
              value={eventUrl}
              maxLength={CALENDAR_URL_MAX}
              onChange={(e) => setEventUrl(e.target.value)}
              placeholder="https://"
              disabled={sending}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            These fields go into the attached calendar invite. Start and end times
            come from the event and cannot be changed here.
          </p>
        </div>
      ) : null}

      {calendarEvent ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Email</h2>
          <div className="space-y-2">
            <Label htmlFor="invite-subject">Subject</Label>
            <Input
              id="invite-subject"
              value={subject}
              maxLength={INVITE_SUBJECT_MAX}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>
          <div className="space-y-2">
            <Label>Body</Label>
            <Suspense
              fallback={
                <div className="text-muted-foreground min-h-48 rounded-md border px-3 py-2 text-sm">
                  Loading editor…
                </div>
              }
            >
              <InviteRichTextEditor
                key={`${formId}-${editorKey}`}
                initialHtml={body}
                onChange={setBody}
                disabled={sending}
              />
            </Suspense>
            <p className="text-xs text-muted-foreground">
              Format text and add links. The calendar file is attached. An Add to
              Google Calendar link is added if the body does not already have one.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {resultMessage ? (
        <p className="text-sm text-green-700" role="status">
          {resultMessage}
        </p>
      ) : null}

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading roster…</div>
      ) : filteredRecords.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {records.length === 0
            ? "No confirmed registrations for this event."
            : "No matches for your search."}
        </div>
      ) : (
        <ul className="space-y-2 pb-8">
          {filteredRecords.map((record) => {
            const emailKey = record.email.trim().toLowerCase();
            const checked = selectedEmails.has(emailKey);
            return (
              <li key={record.sheetRow}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    checked && "border-primary/40 bg-muted/40"
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleEmail(record.email)}
                    className="mt-1"
                    disabled={!emailKey}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight">
                      {record.name || "—"}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {record.email || "No email"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
