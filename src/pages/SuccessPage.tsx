import { Link, useLocation } from "react-router-dom";
import type { VerifiedSuccessInfo } from "@/types/forms";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SuccessState {
  formTitle?: string;
  verifiedSuccess?: VerifiedSuccessInfo;
}

export function SuccessPage() {
  const location = useLocation();
  const { formTitle, verifiedSuccess } = (location.state as SuccessState) || {};

  return (
    <div className="flex items-center justify-center py-12">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Submission Successful</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            {formTitle
              ? `Your ${formTitle} has been submitted successfully.`
              : "Your form has been submitted successfully."}
          </p>
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
          <Button asChild variant="outline">
            <Link to="/">Back to Home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
