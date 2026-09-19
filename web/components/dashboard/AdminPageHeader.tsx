"use client";

import React from "react";

/** Small shared header for every /dashboard/admin/* page. Keeps spacing,
 *  typography, and the "Admin · …" breadcrumb identical across pages so
 *  the surface feels like one tool, not seven. */
export function AdminPageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-default-500 font-semibold">
          Admin
        </p>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-default-500 mt-0.5 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
