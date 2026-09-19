import { redirect } from "next/navigation";

// Top-level /console is a legacy alias. Lands users on the dashboard route
// (which is auth-gated by middleware).
export default function ConsoleRedirect(): never {
  redirect("/dashboard/api-keys");
}
