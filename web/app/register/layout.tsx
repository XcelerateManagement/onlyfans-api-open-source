import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign up — Free forever plan",
  description:
    "Create a free TheOnlyAPI account. 1 OnlyFans account, 1,000 API calls per month, every endpoint. No card required.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
