import { redirect } from "next/navigation";

/**
 * A self-hosted install has no marketing site — the root is just the way in.
 * Unauthenticated visitors get bounced to /login by the dashboard layout.
 */
export default function Home() {
  redirect("/dashboard");
}
