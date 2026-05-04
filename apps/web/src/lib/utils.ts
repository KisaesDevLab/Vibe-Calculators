import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The shadcn/ui canonical class-merging helper. Combines clsx
 * (conditional class lists) with tailwind-merge (conflict resolution
 * between competing Tailwind utility classes).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
