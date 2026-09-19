"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "@heroui/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/ui/GlassCard";
import {
  CodeIcon,
  BuildingIcon,
  PaletteIcon,
  LightbulbIcon,
  PlugIcon,
  WrenchIcon,
} from "@/components/icons";

const iconMap: Record<string, React.FC<{ className?: string }>> = {
  code: CodeIcon,
  building: BuildingIcon,
  palette: PaletteIcon,
  lightbulb: LightbulbIcon,
  plug: PlugIcon,
  wrench: WrenchIcon,
};

// Colors for each service type
const iconColors: Record<string, { bg: string; text: string; glow: string }> = {
  code: { bg: "bg-blue-500/10", text: "text-blue-500", glow: "shadow-blue-500/20" },
  building: { bg: "bg-purple-500/10", text: "text-purple-500", glow: "shadow-purple-500/20" },
  palette: { bg: "bg-pink-500/10", text: "text-pink-500", glow: "shadow-pink-500/20" },
  lightbulb: { bg: "bg-primary-500/10", text: "text-primary-500", glow: "shadow-primary-500/20" },
  plug: { bg: "bg-emerald-500/10", text: "text-emerald-500", glow: "shadow-emerald-500/20" },
  wrench: { bg: "bg-brand-500/10", text: "text-brand-500", glow: "shadow-brand-500/20" },
};

interface ServiceDetails {
  fullDescription: string;
  useCases: string[];
  technologies: string[];
}

interface ServiceCardProps {
  title: string;
  description: string;
  icon: string;
  features?: string[];
  href?: string;
  details?: ServiceDetails;
}

// Aero-style Popover Component with Portal
function AeroPopover({
  details,
  title,
  colors,
}: {
  details: ServiceDetails;
  title: string;
  colors: { bg: string; text: string; glow: string };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Check if mounted (for SSR)
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Calculate position when opening
  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top,
        left: rect.left,
      });
    }
    setIsOpen(!isOpen);
  };

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.top,
          left: rect.left,
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  const popoverContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: "spring", damping: 25, stiffness: 400 }}
          style={{
            position: "fixed",
            top: position.top - 12,
            left: Math.max(16, Math.min(position.left, window.innerWidth - 400)),
            transform: "translateY(-100%)",
          }}
          className="w-[calc(100vw-32px)] sm:w-80 md:w-96 z-[9999]"
        >
          {/* Aero Glass Container */}
          <div className="relative rounded-xl overflow-hidden shadow-2xl">
            {/* Aero glass background with blur */}
            <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl" />

            {/* Aero top highlight */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 dark:via-white/20 to-transparent" />

            {/* Aero inner glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/50 dark:from-white/5 to-transparent pointer-events-none" />

            {/* Aero border */}
            <div className="absolute inset-0 rounded-xl border border-white/50 dark:border-white/10 pointer-events-none" />
            <div className="absolute inset-0 rounded-xl ring-1 ring-black/5 dark:ring-white/5 pointer-events-none" />

            {/* Content */}
            <div className="relative p-4 sm:p-5">
              {/* Header with close button */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <h4 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                  {title}
                </h4>
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex-shrink-0 w-6 h-6 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                {details.fullDescription}
              </p>

              {/* Use Cases */}
              <div className="mb-4">
                <h5 className="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  Use Cases
                </h5>
                <ul className="space-y-1.5">
                  {details.useCases.map((useCase, index) => (
                    <li key={index} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span className={`w-1.5 h-1.5 rounded-full ${colors.bg.replace('/10', '')} flex-shrink-0`} />
                      {useCase}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Technologies */}
              <div>
                <h5 className="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  Technologies
                </h5>
                <div className="flex flex-wrap gap-1.5">
                  {details.technologies.map((tech, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] sm:text-xs font-medium bg-white/50 dark:bg-white/10 border border-white/60 dark:border-white/10 text-slate-700 dark:text-slate-200 shadow-sm"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Aero arrow/pointer */}
            <div className="absolute -bottom-2 left-4 sm:left-6">
              <div className="relative w-4 h-4 rotate-45">
                <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl" />
                <div className="absolute inset-0 border-r border-b border-white/50 dark:border-white/10" />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 text-primary-500 font-medium text-xs sm:text-sm group/link link-underline touch-target py-2 -my-2 mobile-interactive"
      >
        Learn more
        <motion.span
          animate={{ x: isOpen ? 4 : 0 }}
          className="transition-transform"
        >
          &rarr;
        </motion.span>
      </button>

      {isMounted && createPortal(popoverContent, document.body)}
    </div>
  );
}

export function ServiceCard({
  title,
  description,
  icon,
  features,
  href = "/services",
  details,
}: ServiceCardProps) {
  const IconComponent = iconMap[icon] || CodeIcon;
  const colors = iconColors[icon] || iconColors.code;

  return (
    <GlassCard isHoverable className="h-full gradient-border group touch-feedback">
      <GlassCardHeader className="flex flex-col items-start gap-3 pb-0 pt-5 sm:pt-6 px-4 sm:px-5">
        {/* Icon with glow effect */}
        <motion.div
          className={`p-2.5 sm:p-3 rounded-xl ${colors.bg} shadow-lg ${colors.glow} transition-all duration-300 group-hover:scale-110`}
          whileHover={{ rotate: [0, -10, 10, 0] }}
          transition={{ duration: 0.5 }}
        >
          <IconComponent className={`w-5 h-5 sm:w-6 sm:h-6 ${colors.text}`} />
        </motion.div>
        <h3 className="text-base sm:text-lg font-semibold text-foreground group-hover:text-primary-500 transition-colors">{title}</h3>
      </GlassCardHeader>
      <GlassCardBody className="pt-2 px-4 sm:px-5 pb-4 sm:pb-5">
        <p className="text-default-600 text-xs sm:text-sm mb-3 sm:mb-4 leading-relaxed">{description}</p>
        {features && features.length > 0 && (
          <ul className="space-y-1.5 sm:space-y-2 mb-3 sm:mb-4">
            {features.slice(0, 3).map((feature, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center gap-2 text-[11px] sm:text-xs text-default-500"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${colors.bg.replace('/10', '')} flex-shrink-0`} />
                {feature}
              </motion.li>
            ))}
          </ul>
        )}
{details ? (
          <AeroPopover details={details} title={title} colors={colors} />
        ) : (
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-primary-500 font-medium text-xs sm:text-sm group/link link-underline touch-target py-2 -my-2"
          >
            Learn more
            <motion.span
              className="transition-transform"
              whileHover={{ x: 4 }}
            >
              &rarr;
            </motion.span>
          </Link>
        )}
      </GlassCardBody>
    </GlassCard>
  );
}
