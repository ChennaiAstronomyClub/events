import type { FormEvent, ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface FormWrapperProps {
  title: string;
  description?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}

export function FormWrapper({
  title,
  description,
  submitLabel = "Submit",
  isSubmitting,
  onSubmit,
  children,
}: FormWrapperProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {children}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Submitting..." : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
