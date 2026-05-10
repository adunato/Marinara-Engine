import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CSSProperties } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Generate a unique ID, with fallback for insecure contexts (non-HTTPS). */
export function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Copy text to clipboard with fallback for insecure contexts (HTTP / Tailscale). */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy approach
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Avatar crop data stored in character extensions / on personas. */
export interface AvatarCrop {
  zoom: number;
  offsetX: number;
  offsetY: number;
  /** Opt-in: render with `object-fit: contain` so the full source image is reachable
   *  via zoom/pan (zoom can go below 1, pan works at any zoom). When omitted the
   *  legacy `object-fit: cover` behavior is preserved so already-shipped avatars
   *  don't shift visually in any render site. */
  fullImage?: boolean;
}

/** Returns inline styles for a cropped/zoomed avatar image.
 *  The parent container must have `overflow: hidden`.
 *
 *  Two render modes:
 *  - Legacy "cover": no `objectFit` returned (CSS class `object-cover` applies).
 *    The transform is only emitted at zoom > 1 — at zoom 1 the helper returns `{}`
 *    so there's literally no inline style change vs. before this field existed.
 *  - "fullImage": switches to `object-fit: contain` and always emits the transform,
 *    so zoom < 1 letterboxes the full image inside the container and pan works at
 *    any zoom level. */
export function getAvatarCropStyle(crop?: AvatarCrop | null): CSSProperties {
  if (!crop) return {};
  if (crop.fullImage) {
    return {
      objectFit: "contain",
      transform: `scale(${crop.zoom}) translate(${crop.offsetX}%, ${crop.offsetY}%)`,
    };
  }
  if (crop.zoom <= 1) return {};
  return {
    transform: `scale(${crop.zoom}) translate(${crop.offsetX}%, ${crop.offsetY}%)`,
  };
}
