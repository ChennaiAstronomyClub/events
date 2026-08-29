import { Link, useLocation } from "react-router-dom";
import type { VerifiedSuccessInfo } from "@/types/forms";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCalendarEvent } from "@/lib/calendar/event";
import { buildCalendarIcs } from "@/lib/calendar/ics";
import { googleCalendarTemplateUrl } from "@/lib/calendar/google";
import { CalendarPlus, Download } from "lucide-react";

interface SuccessState {
  formId?: string;
  formTitle?: string;
  verifiedSuccess?: VerifiedSuccessInfo;
  backfillComplete?: boolean;
}

function downloadIcsFile(ics: string, filename: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SuccessPage() {
  const location = useLocation();
  const { formId, formTitle, verifiedSuccess, backfillComplete } =
    (location.state as SuccessState) || {};

  const calendarEvent = formId ? getCalendarEvent(formId) : null;

  function handleDownloadIcs() {
    if (!calendarEvent) return;
    const ics = buildCalendarIcs({ event: calendarEvent, method: "PUBLISH" });
    downloadIcsFile(ics, `${calendarEvent.formId}.ics`);
  }

  return (
    <div className="flex items-center justify-center py-12">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>{backfillComplete ? "Details Saved" : "Submission Successful"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            {backfillComplete
              ? "Your missing registration details have been saved. Thank you!"
              : formTitle
                ? `Your ${formTitle} has been submitted successfully.`
                : "Your form has been submitted successfully."}
          </p>
          {calendarEvent && !backfillComplete ? (
            <p className="text-sm text-muted-foreground">
              A calendar invite was sent to your email. You can also add the event
              below.
            </p>
          ) : null}
          {verifiedSuccess && (
            <div className="rounded-lg border bg-green-50 p-4 space-y-3">
              <p className="text-sm text-green-900">{verifiedSuccess.message}</p>
              {verifiedSuccess.linkUrl && (
                <Button asChild className="w-full">
                  <a href={verifiedSuccess.linkUrl} target="_blank" rel="noopener noreferrer">
                    {verifiedSuccess.linkLabel || "Open Link"}
                  </a>
                </Button>
              )}
            </div>
          )}
          {calendarEvent ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="outline" className="flex-1">
                <a
                  href={googleCalendarTemplateUrl(calendarEvent)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <CalendarPlus className="size-4" />
                  Add to Google Calendar
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleDownloadIcs}
              >
                <Download className="size-4" />
                Download .ics
              </Button>
            </div>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/">Back to Home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
