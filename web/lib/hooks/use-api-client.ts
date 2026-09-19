"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { CrmApiClient } from "@/lib/api-client";

/**
 * Returns a `CrmApiClient` bound to the user's session crm_id. The client no
 * longer carries an API key — calls go through the same-origin proxy at
 * `/api/crm/[...path]`, which attaches the key server-side from the JWT.
 */
export function useApiClient(): CrmApiClient | null {
  const { data: session } = useSession();

  return useMemo(() => {
    const crmId = session?.user?.crmId;
    if (!crmId) return null;
    return new CrmApiClient(crmId);
  }, [session?.user?.crmId]);
}
