import { redirect } from "next/navigation";

export default function SignupRedirect(): never {
  redirect("/register");
}
