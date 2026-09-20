import { Link } from "react-router-dom";
import { AdminGate } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";

/**
 * Calendar invite sending is temporarily disabled (`api/calendar-invites` → 503).
 * Previous send UI / client helper lived in git history alongside
 * `src/lib/calendar/` (server) for the redesign.
 */
export function CalendarInvitesPage() {
  return (
    <AdminGate>
      <div className="mx-auto flex max-w-lg flex-col gap-4 py-12">
        <h1 className="text-xl font-semibold">Calendar invites</h1>
        <p className="text-sm text-muted-foreground">
          Calendar email sending is temporarily disabled while this flow is
          redesigned. The send API returns 503 until it is re-enabled.
        </p>
        <Button asChild variant="outline" className="w-fit">
          <Link to="/admin">Back to Admin</Link>
        </Button>
      </div>
    </AdminGate>
  );
}
