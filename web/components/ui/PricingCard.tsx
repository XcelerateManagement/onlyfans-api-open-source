"use client";

import NextLink from "next/link";
import { Button } from "@heroui/button";
import { motion } from "framer-motion";

import { CornerBrackets } from "@/components/ui/CornerBrackets";

interface PricingCardProps {
  name: string;
  price: string;
  period: string;
  description: string;
  sectionHeading?: string;
  features: string[];
  cta: string;
  ctaLink: string;
  popular?: boolean;
}

function TechLogos() {
  return (
    <img
      src="/icons/tech-stack.png"
      alt="JavaScript, Laravel, PHP, Python, cURL"
      className="h-[58px] w-auto object-contain"
    />
  );
}

export function PricingCard({
  name,
  price,
  period,
  description,
  sectionHeading,
  features,
  cta,
  ctaLink,
  popular = false,
}: PricingCardProps) {
  return (
    <motion.div
      className={`pricing-card relative ${popular ? "popular" : ""}`}
      whileHover={{
        y: -6,
        boxShadow: popular ? "0 0 40px rgba(245, 73, 0, 0.15)" : "none",
      }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      <CornerBrackets />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-xl font-medium text-foreground italic">{name}</h3>
          {popular && (
            <span className="inline-flex items-center gap-1.5 text-[#f54900] text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-[#f54900]" />
              Most popular
            </span>
          )}
        </div>
        <p className="text-default-500 text-sm leading-relaxed">{description}</p>
      </div>

      {/* Price */}
      <div className="mb-6">
        <span className="text-4xl sm:text-5xl font-medium text-foreground">{price}</span>
        <div className="text-default-600 text-sm font-medium mt-1">{period}</div>
      </div>

      {/* CTA Button */}
      <div className="mb-8">
        <div className="relative inline-flex w-full">
          <span className="absolute -top-[2px] -left-[2px] w-[7px] h-[7px] border-t-2 border-l-2 border-[#f54900] pointer-events-none z-10" />
          <span className="absolute -top-[2px] -right-[2px] w-[7px] h-[7px] border-t-2 border-r-2 border-[#f54900] pointer-events-none z-10" />
          <span className="absolute -bottom-[2px] -left-[2px] w-[7px] h-[7px] border-b-2 border-l-2 border-[#f54900] pointer-events-none z-10" />
          <span className="absolute -bottom-[2px] -right-[2px] w-[7px] h-[7px] border-b-2 border-r-2 border-[#f54900] pointer-events-none z-10" />
          {ctaLink.startsWith("http") ? (
            <Button
              as="a"
              href={ctaLink}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              radius="none"
              variant={popular ? "solid" : "light"}
              className={`w-full font-bold uppercase tracking-wider text-sm min-h-[48px] group ${
                popular
                  ? "bg-[#f54900] text-white hover:bg-[#d63e00] border border-dashed border-[#f54900]/30"
                  : "text-white/80 hover:text-white border border-dashed border-white/15 hover:border-[#f54900]/40 bg-white/[0.03] hover:bg-white/[0.06] transition-all"
              }`}
            >
              {cta}
              {popular && (
                <span className="inline-block ml-1 transition-transform duration-200 group-hover:translate-x-1">&#9654;</span>
              )}
            </Button>
          ) : (
            <Button
              as={NextLink}
              href={ctaLink}
              size="lg"
              radius="none"
              variant={popular ? "solid" : "light"}
              className={`w-full font-bold uppercase tracking-wider text-sm min-h-[48px] group ${
                popular
                  ? "bg-[#f54900] text-white hover:bg-[#d63e00] border border-dashed border-[#f54900]/30"
                  : "text-white/80 hover:text-white border border-dashed border-white/15 hover:border-[#f54900]/40 bg-white/[0.03] hover:bg-white/[0.06] transition-all"
              }`}
            >
              {cta}
              {popular && (
                <span className="inline-block ml-1 transition-transform duration-200 group-hover:translate-x-1">&#9654;</span>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Tech stack integration */}
      <div className="mb-8 pb-8 border-b border-white/[0.06]">
        <p className="text-default-500 text-sm mb-4">Integrates with your existing stack</p>
        <TechLogos />
      </div>

      {/* Section heading */}
      {sectionHeading && (
        <p className="text-base font-semibold text-foreground mb-5">{sectionHeading}</p>
      )}

      {/* Features */}
      <ul className="space-y-4 flex-grow">
        {features.map((feature, index) => (
          <li
            key={index}
            className="flex items-start gap-3 text-sm text-default-500 leading-relaxed"
          >
            <span className="w-2 h-2 rounded-full border border-white/30 mt-1.5 flex-shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
