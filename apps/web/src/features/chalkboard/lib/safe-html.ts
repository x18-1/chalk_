"use client";

import DOMPurify from "dompurify";

/** Imported classroom markup is authored content, not trusted application UI. */
export function sanitizeClassroomMarkup(markup: string): string {
  return DOMPurify.sanitize(markup, {
    USE_PROFILES: { html: true, svg: true, svgFilters: false, mathMl: true },
    FORBID_TAGS: ["form", "iframe", "object", "embed"],
    FORBID_ATTR: ["autofocus"],
  });
}
