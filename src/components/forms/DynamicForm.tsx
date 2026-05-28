/**
 * DynamicForm — the core form engine.
 *
 * Takes a FormConfig + Discourse user and renders a fully-functional form with:
 *   - Dynamic Zod validation schema built from field configs
 *   - Pre-filled values from Discourse profile
 *   - Conditional fields (showWhen), verified-user field skipping
 *   - Checkbox/checkbox-group → string serialization for Google Sheets
 *   - Optional "save to profile" for fields that changed from Discourse values
 */

import { useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import type { FormConfig, FormFieldConfig } from "@/types/forms";
import type { DiscourseUser } from "@/types/discourse";
import { isVerifiedUser } from "@/config/discourse-fields";
import { DynamicField } from "./DynamicField";
import { FormWrapper } from "./FormWrapper";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ---- Public types ----

interface DynamicFormProps {
  config: FormConfig;
  user: DiscourseUser;
  onSubmit: (
    data: Record<string, unknown>,
    fieldsToSave: SaveToProfileField[]
  ) => void | Promise<void>;
  isSubmitting?: boolean;
}

export interface SaveToProfileField {
  discourseField: string;
  value: string;
}

// ---- Discourse value helpers ----

/**
 * Read a value from the user profile by dot-path.
 * Supports top-level keys ("name", "email") and user_fields ("user_fields.2").
 */
export function getDiscourseValue(user: DiscourseUser, path: string): string {
  if (path.startsWith("user_fields.")) {
    const fieldId = path.replace("user_fields.", "");
    return user.user_fields?.[fieldId] ?? "";
  }
  return (user as unknown as Record<string, string>)[path] ?? "";
}

// ---- Schema builder ----

/** Build a Zod object schema dynamically from an array of field configs. */
function buildZodSchema(
  fields: FormFieldConfig[],
  atLeastOneOf?: FormConfig["atLeastOneOf"]
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  const conditionalRequired = fields.filter((f) => f.required && f.showWhen);

  for (const field of fields) {
    // Conditional fields may be hidden; we validate them separately when visible
    const isConditional = !!field.showWhen;
    const isRequired = field.required && !isConditional;

    if (field.type === "checkbox-group") {
      shape[field.name] = isRequired
        ? z.array(z.string()).min(1, "Please select at least one option")
        : z.array(z.string()).optional();
    } else if (field.type === "checkbox") {
      shape[field.name] = isRequired
        ? z.boolean().refine((val) => val === true, {
            message: "You must agree to this to continue",
          })
        : z.boolean().optional();
    } else if (field.type === "number") {
      const requiredMessage = field.validation?.message || `${field.label} is required`;
      const invalidMessage = field.validation?.message || `${field.label} must be a valid number`;
      const minMessage = field.validation?.message || `${field.label} must be at least ${field.validation?.min}`;
      const maxMessage = field.validation?.message || `${field.label} must be at most ${field.validation?.max}`;

      const parsedNumber = z.preprocess((value) => {
        // Empty number inputs in react-hook-form can arrive as NaN; normalize to undefined
        // so required validation shows a friendly message instead of a Zod type error.
        if (value === "" || value === null || value === undefined) return undefined;
        if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
        if (typeof value === "string") {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
      }, z.number().optional());

      let schema = parsedNumber;
      if (isRequired) {
        schema = schema.refine((value) => value !== undefined, { message: requiredMessage });
      }
      schema = schema.refine(
        (value) => value === undefined || Number.isFinite(value),
        { message: invalidMessage }
      );
      if (field.validation?.min !== undefined) {
        schema = schema.refine(
          (value) => value === undefined || value >= field.validation!.min!,
          { message: minMessage }
        );
      }
      if (field.validation?.max !== undefined) {
        schema = schema.refine(
          (value) => value === undefined || value <= field.validation!.max!,
          { message: maxMessage }
        );
      }

      shape[field.name] = schema;
    } else {
      // All text-like types: text, email, tel, textarea, select, radio
      let schema = z.string();
      if (isRequired) {
        schema = schema.min(1, field.validation?.message || `${field.label} is required`);
      }
      if (field.validation?.min !== undefined) {
        schema = schema.min(
          field.validation.min,
          field.validation.message || `Minimum ${field.validation.min} characters`
        );
      }
      if (field.validation?.max !== undefined) {
        schema = schema.max(
          field.validation.max,
          field.validation.message || `Maximum ${field.validation.max} characters`
        );
      }
      if (field.validation?.pattern) {
        schema = schema.regex(
          new RegExp(field.validation.pattern),
          field.validation.message || "Invalid format"
        );
      }
      shape[field.name] = isRequired ? schema : schema.optional().or(z.literal(""));
    }
  }

  return z.object(shape).superRefine((data, ctx) => {
    for (const field of conditionalRequired) {
      const condition = field.showWhen;
      if (!condition) continue;
      const shouldValidate = data[condition.field] === condition.value;
      if (!shouldValidate) continue;

      const value = data[field.name];
      let hasValue = true;

      if (field.type === "checkbox") {
        hasValue = value === true;
      } else if (field.type === "checkbox-group") {
        hasValue = Array.isArray(value) && value.length > 0;
      } else if (field.type === "number") {
        hasValue = value !== undefined && value !== null && !Number.isNaN(value as number);
      } else {
        hasValue = typeof value === "string" ? value.trim().length > 0 : !!value;
      }

      if (!hasValue) {
        ctx.addIssue({
          path: [field.name],
          code: z.ZodIssueCode.custom,
          message: field.validation?.message || `${field.label} is required`,
        });
      }
    }

    if (atLeastOneOf && atLeastOneOf.fields.length > 0) {
      const hasAnyValue = atLeastOneOf.fields.some((fieldName) => {
        const value = data[fieldName];
        if (typeof value === "number") return Number.isFinite(value);
        if (typeof value === "string") return value.trim().length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "boolean") return value;
        return value !== undefined && value !== null;
      });

      if (!hasAnyValue) {
        for (const fieldName of atLeastOneOf.fields) {
          ctx.addIssue({
            path: [fieldName],
            code: z.ZodIssueCode.custom,
            message: atLeastOneOf.message,
          });
        }
      }
    }
  });
}

// ---- Default value factory ----

function getDefaultValue(field: FormFieldConfig, user: DiscourseUser): unknown {
  if (field.discourseField) {
    const val = getDiscourseValue(user, field.discourseField);
    return field.type === "number" ? (val ? Number(val) : undefined) : val;
  }
  switch (field.type) {
    case "number":
      return undefined;
    case "checkbox-group":
      return [];
    case "checkbox":
      return false;
    default:
      return "";
  }
}

// ---- Component ----

export function DynamicForm({ config, user, onSubmit, isSubmitting }: DynamicFormProps) {
  const isVerified = isVerifiedUser(user.groups);
  const [saveToProfile, setSaveToProfile] = useState(true);

  // 1. Remove fields that verified users don't need to see
  const visibleFields = useMemo(
    () => config.fields.filter((f) => !(f.skipForVerified && isVerified)),
    [config.fields, isVerified]
  );

  // 2. Snapshot of original Discourse values (for save-to-profile diffing)
  const originalValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const field of visibleFields) {
      if (field.saveToProfile && field.discourseField) {
        map[field.name] = getDiscourseValue(user, field.discourseField);
      }
    }
    return map;
  }, [visibleFields, user]);

  // 3. Default values for all visible fields
  const defaultValues = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const field of visibleFields) {
      values[field.name] = getDefaultValue(field, user);
    }
    return values;
  }, [visibleFields, user]);

  // 4. Build Zod schema
  const schema = useMemo(
    () => buildZodSchema(visibleFields, config.atLeastOneOf),
    [visibleFields, config.atLeastOneOf]
  );

  // 5. React Hook Form
  const methods = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onChange",
  });

  const formValues = methods.watch();

  // 6. Evaluate showWhen conditions to get currently renderable fields
  const renderableFields = useMemo(
    () =>
      visibleFields.filter((f) => {
        if (!f.showWhen) return true;
        return formValues[f.showWhen.field] === f.showWhen.value;
      }),
    [visibleFields, formValues]
  );

  // 7. Detect profile fields that changed (for save-to-profile prompt)
  const changedProfileFields = useMemo(
    () =>
      renderableFields.filter((f) => {
        if (!f.saveToProfile || !f.discourseField) return false;
        return String(formValues[f.name] ?? "") !== (originalValues[f.name] ?? "");
      }),
    [renderableFields, formValues, originalValues]
  );

  // ---- Serialization + submit ----

  function handleFormSubmit(data: Record<string, unknown>) {
    // Collect fields the user wants saved back to Discourse
    const fieldsToSave: SaveToProfileField[] = [];
    if (saveToProfile) {
      for (const field of changedProfileFields) {
        const value = data[field.name];
        if (value !== undefined && value !== null && field.discourseField) {
          fieldsToSave.push({
            discourseField: field.discourseField,
            value: String(value),
          });
        }
      }
    }

    // Serialize ALL config fields (even hidden/skipped ones) so every
    // submission sends the same columns to Google Sheets.
    const serialized: Record<string, unknown> = {};
    for (const field of config.fields) {
      if (field.uiOnly) continue;
      const value = data[field.name];
      if (field.type === "checkbox-group" && Array.isArray(value)) {
        serialized[field.name] = value.join(", ");
      } else if (field.type === "checkbox") {
        serialized[field.name] = value === true ? "Yes" : "No";
      } else {
        serialized[field.name] = value ?? "";
      }
    }

    return onSubmit(serialized, fieldsToSave);
  }

  // ---- Render ----

  // Group renderable fields by their section heading
  const sections = useMemo(() => {
    const map = new Map<string, FormFieldConfig[]>();
    for (const field of renderableFields) {
      const section = field.section || "Other";
      if (!map.has(section)) map.set(section, []);
      map.get(section)!.push(field);
    }
    return Array.from(map);
  }, [renderableFields]);

  return (
    <FormWrapper
      title={config.title}
      description={config.description}
      talkTitle={config.talkTitle}
      talkSpeaker={config.talkSpeaker}
      startTime={config.startTime}
      endTime={config.endTime}
      feeInfo={config.feeInfo}
      submitLabel={config.submitLabel}
      isSubmitting={isSubmitting}
      onSubmit={methods.handleSubmit((data) => handleFormSubmit(data as Record<string, unknown>))}
    >
      <FormProvider {...methods}>
        {/* "Save to profile" prompt when Discourse fields have been edited */}
        {changedProfileFields.length > 0 && (
          <Alert className="mb-4">
            <AlertDescription className="flex items-start gap-3">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveToProfile}
                  onChange={(e) => setSaveToProfile(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  Save changes to{" "}
                  {changedProfileFields.map((f) => f.label.toLowerCase()).join(", ")}{" "}
                  in my profile for future forms
                </span>
              </label>
            </AlertDescription>
          </Alert>
        )}

        {sections.map(([section, fieldsInSection]) => (
          <div key={section} className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{section}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fieldsInSection.map((field) => (
                <DynamicField key={field.name} field={field} readOnly={false} />
              ))}
            </div>
          </div>
        ))}
      </FormProvider>
    </FormWrapper>
  );
}
