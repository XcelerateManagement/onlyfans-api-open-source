import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create owner account",
  description:
    "Create the owner account for your open-source, self-hosted OnlyFans and Fansly API panel.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
