"use client";

import NextLink from "next/link";
import { Button, type ButtonProps } from "@heroui/button";

type CTAButtonProps = Omit<ButtonProps, "as" | "href"> & {
  href: string;
};

export function CTAButton({ href, ...props }: CTAButtonProps) {
  return <Button as={NextLink} href={href} {...props} />;
}
