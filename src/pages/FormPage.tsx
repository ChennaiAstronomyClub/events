import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { getFormConfig } from "@/config/forms";
import { isVerifiedUser, VERIFIED_GROUP_NAME } from "@/config/discourse-fields";
import { updateUserFields } from "@/lib/discourse-api";
import { storage } from "@/lib/storage";
import { DynamicForm, type SaveToProfileField } from "@/components/forms/DynamicForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function FormPage() {
  const { formId } = useParams<{ formId: string }>();
  const { user, apiKey, refreshUser } = useAuth();
  const { isSubmitting, isDuplicate, error, submit } = useFormSubmit();
  const navigate = useNavigate();

  const config = formId ? getFormConfig(formId) : undefined;

  // Check if this user already submitted this form (client-side quick check)
  const alreadySubmitted = useMemo(() => {
    if (!config || !user) return false;
    const submission = storage.getFormSubmission(config.id);
    return submission !== null && submission.email === user.email;
  }, [config, user]);

  if (!config) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-lg font-semibold">Form Not Found</h2>
        <p className="text-muted-foreground">
          The form &quot;{formId}&quot; does not exist.
        </p>
      </div>
    );
  }

  if (!user) return null;

  // Show "Already Registered" card if duplicate detected (client or server)
  if (alreadySubmitted || isDuplicate) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Already Registered</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              You have already registered for {config.title}. Each participant
              can only register once.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSubmit(
    data: Record<string, unknown>,
    fieldsToSave: SaveToProfileField[]
  ) {
    const memberType = isVerifiedUser(user!.groups) ? VERIFIED_GROUP_NAME : "regular";
    const result = await submit(
      config!.sheetTab,
      data,
      user!.username,
      memberType
    );

    if (result.success) {
      // Mark form as submitted in localStorage
      storage.markFormSubmitted(config!.id, user!.email);

      // Save fields to Discourse profile if requested
      if (fieldsToSave.length > 0 && apiKey) {
        try {
          const userFields: Record<string, string> = {};
          for (const field of fieldsToSave) {
            // discourseField is like "user_fields.2" — extract the ID
            const fieldId = field.discourseField.replace("user_fields.", "");
            userFields[fieldId] = field.value;
          }
          await updateUserFields(user!.username, apiKey, userFields);
          // Refresh user profile so next form load has the saved data
          await refreshUser();
        } catch {
          // Profile save failed — not critical, form was still submitted
          console.warn("Failed to save fields to Discourse profile");
        }
      }

      navigate("/success", {
        state: {
          formTitle: config!.title,
          verifiedSuccess: isVerifiedUser(user!.groups) ? config!.verifiedSuccess : undefined,
        },
      });
    } else if (result.error === "duplicate") {
      // Server detected duplicate — mark localStorage so future visits show the card
      storage.markFormSubmitted(config!.id, user!.email);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DynamicForm
        config={config}
        user={user}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
