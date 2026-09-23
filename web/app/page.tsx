import { redirect } from "next/navigation";

/**
 * A self-hosted install has no marketing site. Its first screen is account
 * creation so a fresh operator can claim the panel without already knowing
 * the registration URL. Existing operators can follow the sign-in link.
 */
export default function Home() {
  redirect("/register");
}
