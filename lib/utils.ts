import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms?: number | null) {
  if (!ms || Number.isNaN(ms)) {
    return "-";
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatUsd(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  if (value === 0) {
    return "$0.00";
  }

  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

export function formatTokenCount(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US").format(value);
}
