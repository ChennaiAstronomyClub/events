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
import { CalendarPlus, ClipboardList } from "lucide-react";

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
              Email an ICS calendar invite to all or selected confirmed
              participants for an event.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/admin/invites">Send calendar invites</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  );
}
