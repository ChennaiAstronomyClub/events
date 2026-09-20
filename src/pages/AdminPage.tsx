import { Link } from "react-router-dom";
import { AdminGate } from "@/components/admin/AdminGate";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarPlus, ClipboardList, UserPlus } from "lucide-react";

/**
 * Admin hub for event administration tools.
 * Access requires the logged-in Discourse account to have admin: true.
 */
export function AdminPage() {
  return (
    <AdminGate>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-muted-foreground mt-1">
            Event administration tools for Discourse admins.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="size-4" />
              Attendance Check-in
            </CardTitle>
            <CardDescription>
              Tap All to check in the full party, or Partial to enter adult and kid
              counts. Syncs to Google Sheets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/admin/attendance">Open attendance</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarPlus className="size-4" />
              Calendar invites
            </CardTitle>
            <CardDescription>
              Temporarily disabled — calendar email sending is paused while we
              redesign this flow (Google Calendar integration coming later).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled className="w-full sm:w-auto">
              Send calendar invites (disabled)
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="size-4" />
              Registration whitelist
            </CardTitle>
            <CardDescription>
              Open a closed, not-yet-open, or full event for specific emails or
              phones, then copy a shareable invite link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/admin/whitelist">Manage whitelist</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  );
}
