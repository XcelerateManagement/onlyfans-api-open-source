"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import NextLink from "next/link";
import Image from "next/image";

interface IntegrationCardProps {
  name: string;
  description: string;
  logo: string;
  link: string;
}

export function IntegrationCard({
  name,
  description,
  logo,
  link,
}: IntegrationCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <motion.div whileHover={{ y: -4 }} className="integration-card">
      {/* Logo */}
      <div className="mb-4 h-16 flex items-center justify-center">
        {imageError ? (
          <div className="text-2xl font-bold text-primary-500">{name}</div>
        ) : (
          <Image
            src={logo}
            alt={name}
            width={120}
            height={40}
            className="object-contain"
            onError={() => setImageError(true)}
          />
        )}
      </div>

      {/* Content */}
      <h3 className="text-lg font-semibold text-foreground mb-2">{name}</h3>
      <p className="text-default-600 text-sm mb-6">{description}</p>

      {/* CTA */}
      <NextLink
        href={link}
        className="inline-block w-full py-2 px-4 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 text-primary-600 dark:text-primary-400 font-medium text-center transition-colors"
      >
        View Integration
      </NextLink>
    </motion.div>
  );
}
