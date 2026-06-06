import { CardDescription } from "@/components/ui/card";
import type { FormConfig } from "@/types/forms";

type EventDescriptionProps = Pick<
  FormConfig,
  "description" | "talkTitle" | "talkSpeaker" | "eventInfoLink"
>;

/**
 * Renders event subtitle / talk info on cards and form headers.
 * When talkTitle is set, it is shown prominently; speaker line stays muted.
 */
export function EventDescription({
  description,
  talkTitle,
  talkSpeaker,
  eventInfoLink,
}: EventDescriptionProps) {
  if (talkTitle) {
    return (
      <CardDescription className="space-y-2">
        <div className="inline-flex w-fit rounded bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
          Talk
        </div>
        <p className="border-l-2 border-primary/30 pl-3 text-[0.95rem] font-medium leading-snug text-foreground/90">
          {talkTitle}
        </p>
        {talkSpeaker && (
          <p className="pl-3 text-sm font-normal text-muted-foreground">{talkSpeaker}</p>
        )}
      </CardDescription>
    );
  }

  if (eventInfoLink) {
    return (
      <CardDescription>
        {eventInfoLink.message}{" "}
        <a
          href={eventInfoLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {eventInfoLink.linkLabel || "Read event details"}
        </a>
      </CardDescription>
    );
  }

  if (!description) return null;

  return <CardDescription>{description}</CardDescription>;
}
