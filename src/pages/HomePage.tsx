import { Link } from "react-router-dom";
import { formConfigs } from "@/config/forms";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatDateTime(isoString?: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function HomePage() {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Our Upcoming Events</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {formConfigs.map((form) => (
          <Card key={form.id}>
            <CardHeader>
              <CardTitle>{form.title}</CardTitle>
              {form.description && (
                <CardDescription>{form.description}</CardDescription>
              )}
              {form.startTime && form.endTime && (
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <p>
                    <span className="font-semibold">Start:</span> {formatDateTime(form.startTime)}
                  </p>
                  <p>
                    <span className="font-semibold">End:</span> {formatDateTime(form.endTime)}
                  </p>
                </div>
              )}
              <Button asChild className="mt-4">
                <Link to={`/form/${form.id}`}>Register</Link>
              </Button>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
