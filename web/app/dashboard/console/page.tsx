import { redirect } from "next/navigation";

// /dashboard/console moved to /dashboard/api-keys.
export default function ConsoleRedirect(): never {
  redirect("/dashboard/api-keys");
}
