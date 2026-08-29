import type { InputHTMLAttributes } from "react";
import { FIELD_BASE_CLASSES } from "./fieldStyles";

export default function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_BASE_CLASSES} ${className}`} {...rest} />;
}
