import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { AdminGate } from "@/components/admin/AdminGate";
import {
  getDefaultWhitelistFormId,
  getFormConfig,
  getWhitelistEnabledFormConfigs,
} from "@/config/forms";
import { formatIstDateTime, formatIstTime } from "@/lib/datetime";
import {
  addRegistrationWhitelistEntry,
  fetchRegistrationWhitelist,
  removeRegistrationWhitelistEntry,
  whitelistIdentityLabel,
  type AdminWhitelistEntry,
} from "@/lib/registration-whitelist";
import { buildWhitelistInvitePath } from "@/lib/whitelist-invite";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const NOTES_MAX = 200;

export function RegistrationWhitelistPage() {
  return (
    <AdminGate>
      <RegistrationWhitelistPanel />
    </AdminGate>
  );
}

function RegistrationWhitelistPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const whitelistForms = getWhitelistEnabledFormConfigs();
  const defaultFormId = getDefaultWhitelistFormId();
  const paramFormId = searchParams.get("formId") ?? "";
  const initialFormId =
    paramFormId && whitelistForms.some((form) => form.id === paramFormId)
      ? paramFormId
      : defaultFormId;

  const [formId, setFormId] = useState(initialFormId);
  const [entries, setEntries] = useState<AdminWhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedForm = getFormConfig(formId);

  const loadEntries = useCallback(async (targetFormId: string) => {
    if (!targetFormId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRegistrationWhitelist(targetFormId);
      if (!data.success || !data.entries) {
        setError(data.message ?? data.error ?? "Failed to load whitelist");
        setEntries([]);
        return;
      }
      setEntries(data.entries);
    } catch {
      setError("Network error");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries(formId);
  }, [formId, loadEntries]);

  function handleFormChange(nextFormId: string) {
    setFormId(nextFormId);
    setSearchParams(nextFormId ? { formId: nextFormId } : {}, { replace: true });
    setNotice(null);
    setEmail("");
    setPhone("");
    setNotes("");
  }

  const inviteOrigin = typeof window !== "undefined" ? window.location.origin : "";

  function inviteUrl(entry: AdminWhitelistEntry): string | null {
    if (!entry.inviteToken?.trim()) return null;
    return `${inviteOrigin}${buildWhitelistInvitePath(formId, entry.inviteToken)}`;
  }

  async function copyInvite(entry: AdminWhitelistEntry) {
    const url = inviteUrl(entry);
    if (!url) {
      setError("Invite token missing for this entry. Reload the whitelist and try again.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      const key = entryKey(entry);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2000);
    } catch {
      setError("Could not copy the invite link.");
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!formId) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const data = await addRegistrationWhitelistEntry(formId, {
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || undefined,
      });
      if (!data.success || !data.entry) {
        setError(data.message ?? data.error ?? "Failed to add");
        return;
      }
      setEmail("");
      setPhone("");
      setNotes("");
      setNotice("Added. Copy the invite link and send it to that person.");
      await loadEntries(formId);
    } catch {
      setError("Network error while adding");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(entry: AdminWhitelistEntry) {
    if (entry.source !== "sheet" || !entry.sheetRow) return;
    setRemovingRow(entry.sheetRow);
    setError(null);
    setNotice(null);
    try {
      const data = await removeRegistrationWhitelistEntry(formId, entry.sheetRow);
      if (!data.success) {
        setError(data.message ?? data.error ?? "Failed to remove");
        return;
      }
      setEntries((prev) => prev.filter((row) => row.sheetRow !== entry.sheetRow));
    } catch {
      setError("Network error while removing");
    } finally {
      setRemovingRow(null);
    }
  }

  const canAdd = useMemo(
    () => Boolean(email.trim() || phone.trim()) && !adding,
    [email, phone, adding]
  );

  if (whitelistForms.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold sm:text-2xl">Registration whitelist</h1>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin">Admin</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          No events currently allow whitelist bypass.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-1 space-y-4 sm:mx-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Registration whitelist</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Let a closed, not-yet-open, or full event accept one person. Ended events
            still cannot be reopened.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">Admin home</Link>
        </Button>
      </div>

      <div className="sticky top-0 z-10 -mx-4 space-y-3 border-b bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:mx-0 sm:rounded-lg sm:border sm:px-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Select value={formId} onValueChange={handleFormChange}>
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent>
              {whitelistForms.map((form) => (
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
            onClick={() => void loadEntries(formId)}
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
      </div>

      <form onSubmit={(event) => void handleAdd(event)} className="space-y-3 rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">Add a person</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="whitelist-email">Email</Label>
            <Input
              id="whitelist-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whitelist-phone">Phone</Label>
            <Input
              id="whitelist-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="whitelist-notes">Notes (optional)</Label>
          <Textarea
            id="whitelist-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={NOTES_MAX}
            placeholder="Why they were added"
          />
        </div>
        <Button type="submit" disabled={!canAdd}>
          {adding ? "Adding…" : "Add to whitelist"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Invite links use a secret token (?invite=). Anyone with the link can open
          the form — treat them like passwords.
        </p>
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading whitelist…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is on this event's whitelist yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const key = entryKey(entry);
            const envLocked = entry.source === "env";
            return (
              <li
                key={key}
                className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium break-all">{whitelistIdentityLabel(entry)}</p>
                  <p className="text-xs text-muted-foreground">
                    {envLocked
                      ? "From env (read-only)"
                      : [entry.addedBy, entry.addedAt, entry.notes]
                          .filter(Boolean)
                          .join(" · ") || "Sheet"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyInvite(entry)}
                  >
                    <Copy className="size-4" />
                    {copiedKey === key ? "Copied" : "Copy invite"}
                  </Button>
                  {envLocked ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={removingRow === entry.sheetRow}
                      onClick={() => void handleRemove(entry)}
                    >
                      <Trash2 className="size-4" />
                      {removingRow === entry.sheetRow ? "Removing…" : "Remove"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function entryKey(entry: AdminWhitelistEntry): string {
  if (entry.source === "sheet" && entry.sheetRow) return `sheet:${entry.sheetRow}`;
  return `env:${entry.email}:${entry.phone}`;
}
