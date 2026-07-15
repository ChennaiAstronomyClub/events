import type { FormEvent, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EventDescription } from "@/components/events/EventDescription";
import type { FormConfig } from "@/types/forms";

interface FormWrapperProps {
  title: string;
  description?: FormConfig["description"];
  eventInfoLink?: FormConfig["eventInfoLink"];
  talkTitle?: FormConfig["talkTitle"];
  talkSpeaker?: FormConfig["talkSpeaker"];
  startTime?: FormConfig["startTime"];
  endTime?: FormConfig["endTime"];
  feeInfo?: FormConfig["feeInfo"];
  submitLabel?: string;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}

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

export function FormWrapper({
  title,
  description,
  eventInfoLink,
  talkTitle,
  talkSpeaker,
  startTime,
  endTime,
  feeInfo,
  submitLabel = "Submit",
  isSubmitting,
  submitDisabled = false,
  onSubmit,
  children,
}: FormWrapperProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {(description || eventInfoLink || talkTitle) && (
          <EventDescription
            description={description}
            eventInfoLink={eventInfoLink}
            talkTitle={talkTitle}
            talkSpeaker={talkSpeaker}
          />
        )}
        {(startTime && endTime) || feeInfo ? (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {startTime && (
              <p>
                <span className="font-semibold">Start:</span> {formatDateTime(startTime)}
              </p>
            )}
            {endTime && (
              <p>
                <span className="font-semibold">End:</span> {formatDateTime(endTime)}
              </p>
            )}
            {feeInfo && (
              <div>
                <p>
                  <span className="font-semibold">Fee:</span>
                </p>
                <div className="whitespace-pre-line">{feeInfo}</div>
              </div>
            )}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {children}
          <Button type="submit" disabled={isSubmitting || submitDisabled} className="w-full">
            {isSubmitting ? "Submitting..." : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
