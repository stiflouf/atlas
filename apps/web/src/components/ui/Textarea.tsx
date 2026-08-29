import type { TextareaHTMLAttributes } from "react";
import { FIELD_BASE_CLASSES } from "./fieldStyles";

export default function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD_BASE_CLASSES} ${className}`} {...rest} />;
}
