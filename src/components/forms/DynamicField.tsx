import { useFormContext } from "react-hook-form";
import type { FormFieldConfig } from "@/types/forms";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock } from "lucide-react";

interface DynamicFieldProps {
  field: FormFieldConfig;
  readOnly: boolean;
}

export function DynamicField({ field, readOnly }: DynamicFieldProps) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();

  const error = errors[field.name];
  const value = watch(field.name);

  const baseClass = readOnly ? "bg-muted cursor-not-allowed" : "";

  return (
    <div className={`flex flex-col${field.fullWidth ? " col-span-full" : ""}`}>
      {field.type !== "checkbox" && (
        <Label htmlFor={field.name} className="mb-2 flex-1">
          <span>
            {field.label}
            {field.required && <span className="text-destructive"> *</span>}
          </span>
          {readOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
        </Label>
      )}

      {field.type === "textarea" ? (
        <Textarea
          id={field.name}
          placeholder={field.placeholder}
          readOnly={readOnly}
          className={baseClass}
          rows={4}
          {...register(field.name)}
        />
      ) : field.type === "select" ? (
        <Select
          value={value ?? ""}
          onValueChange={(v) => setValue(field.name, v, { shouldValidate: true })}
          disabled={readOnly}
        >
          <SelectTrigger id={field.name} className={baseClass}>
            <SelectValue placeholder={field.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "radio" ? (
        <div className="flex gap-4">
          {field.options?.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                value={opt.value}
                disabled={readOnly}
                {...register(field.name)}
                className="accent-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      ) : field.type === "checkbox-group" ? (
        <div className="flex flex-col gap-2">
          {field.options?.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={opt.value}
                disabled={readOnly}
                checked={Array.isArray(value) && value.includes(opt.value)}
                onChange={(e) => {
                  const current: string[] = Array.isArray(value) ? value : [];
                  const next = e.target.checked
                    ? [...current, opt.value]
                    : current.filter((v: string) => v !== opt.value);
                  setValue(field.name, next, { shouldValidate: true });
                }}
                className="accent-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      ) : field.type === "checkbox" ? (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            {...register(field.name)}
            disabled={readOnly}
            className="mt-1 accent-primary"
          />
          <span className="flex items-center gap-1.5">
            {field.label}
            {field.required && <span className="text-destructive">*</span>}
            {readOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
          </span>
        </label>
      ) : (
        <Input
          id={field.name}
          type={field.type}
          placeholder={field.placeholder}
          readOnly={readOnly}
          className={baseClass}
          {...register(field.name, {
            valueAsNumber: field.type === "number",
          })}
        />
      )}

      {error && (
        <p className="mt-1 text-sm text-destructive">
          {error.message as string}
        </p>
      )}
    </div>
  );
}
