import type { SelectHTMLAttributes } from "react";
import { FIELD_BASE_CLASSES } from "./fieldStyles";

export default function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD_BASE_CLASSES} ${className}`} {...rest} />;
}
