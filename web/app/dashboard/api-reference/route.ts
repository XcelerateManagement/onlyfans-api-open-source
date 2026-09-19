import { NextResponse } from "next/server";

/**
 * The Scalar-powered API Reference page has been retired — the interactive
 * API Docs (/dashboard/api-docs) is the single source of truth now. Keep this
 * URL alive as a redirect so old bookmarks / inbound links don't 404.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/dashboard/api-docs", request.url));
}
