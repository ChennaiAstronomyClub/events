import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

/**
 * Admin hub for event administration tools.
 * Access requires the logged-in Discourse account to have admin: true.
 */
export function AdminPage() {
  const { isAuthenticated, user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading…</div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Please log in to continue.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    );
  }

  if (!user?.admin) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-lg font-semibold">Access Denied</h2>
        <p className="text-muted-foreground mt-1">
          This page requires a Discourse admin account.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    );
  }

  return (
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
            Mark registrants and +1s at the door. Mobile-friendly roster with live
            counts synced to Google Sheets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full sm:w-auto">
            <Link to="/admin/attendance">Open attendance</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
