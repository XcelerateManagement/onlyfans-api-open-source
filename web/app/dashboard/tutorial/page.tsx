"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@heroui/button";
import { Tabs, Tab } from "@heroui/tabs";

import { GlassCard } from "@/components/dashboard/GlassCard";
import {
  PxPlay,
  PxLayoutDashboard,
  PxUsers,
  PxUser,
  PxUserCheck,
  PxMail,
  PxDollarSign,
  PxReceipt,
  PxMegaphone,
  PxBell,
  PxActivity,
  PxZap,
  PxLink,
  PxBookOpen,
  PxFileText,
  PxSettings,
  PxCheck,
  PxChevronRight,
  PxKey,
  PxShield,
  PxGlobe,
  PxLock,
  PxRefresh,
  PxTrendingUp,
  PxSearch,
  PxFilter,
  PxPalette,
  PxCode2,
  PxSend,
} from "@/components/ui/PixelIcons";

import { SECTIONS, ALL_FEATURE_KEYS } from "./_data";
import type { FeatureMeta, IconKey, SectionMeta } from "./_data";
import { useTour } from "@/lib/tour-context";

function Icon({ k, className }: { k: IconKey; className?: string }) {
  switch (k) {
    case "play":
      return <PxPlay className={className} />;
    case "dashboard":
      return <PxLayoutDashboard className={className} />;
    case "users":
      return <PxUsers className={className} />;
    case "user":
      return <PxUser className={className} />;
    case "userCheck":
      return <PxUserCheck className={className} />;
    case "mail":
      return <PxMail className={className} />;
    case "dollar":
      return <PxDollarSign className={className} />;
    case "receipt":
      return <PxReceipt className={className} />;
    case "megaphone":
      return <PxMegaphone className={className} />;
    case "bell":
      return <PxBell className={className} />;
    case "activity":
      return <PxActivity className={className} />;
    case "zap":
      return <PxZap className={className} />;
    case "link":
      return <PxLink className={className} />;
    case "book":
      return <PxBookOpen className={className} />;
    case "file":
      return <PxFileText className={className} />;
    case "settings":
      return <PxSettings className={className} />;
    case "check":
      return <PxCheck className={className} />;
    case "chevronRight":
      return <PxChevronRight className={className} />;
    case "key":
      return <PxKey className={className} />;
    case "shield":
      return <PxShield className={className} />;
    case "globe":
      return <PxGlobe className={className} />;
    case "lock":
      return <PxLock className={className} />;
    case "refresh":
      return <PxRefresh className={className} />;
    case "trending":
      return <PxTrendingUp className={className} />;
    case "search":
      return <PxSearch className={className} />;
    case "filter":
      return <PxFilter className={className} />;
    case "palette":
      return <PxPalette className={className} />;
    case "code":
      return <PxCode2 className={className} />;
    case "send":
      return <PxSend className={className} />;
    default:
      return null;
  }
}

const METHOD_COLORS: Record<string, string> = {
  GET: "#22c55e",
  POST: "#f54900",
  PATCH: "#facc15",
  DELETE: "#ef4444",
};

export default function TutorialPage() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string>("start");
  const [openFeature, setOpenFeature] = useState<FeatureMeta | null>(null);
  const { start: startTour, chapters: tourChapters, steps: tourSteps } = useTour();
  // Estimate ~15s per atomic step → minute estimate is friendlier than "30 steps".
  const estMinutes = Math.max(2, Math.ceil((tourSteps.length * 15) / 60));

  const toggle = (k: string) =>
    setCompleted((prev) => ({ ...prev, [k]: !prev[k] }));

  const doneCount = useMemo(
    () => ALL_FEATURE_KEYS.filter((k) => completed[k]).length,
    [completed]
  );
  const pct = Math.round((doneCount / ALL_FEATURE_KEYS.length) * 100);
  const activeSection: SectionMeta = SECTIONS.find((s) => s.key === active)!;

  return (
    <div className="space-y-6 w-full">
      {/* Hero header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative border border-white/[0.06] bg-[#0d0d0d] overflow-hidden"
      >
        {/* decorative gradient backdrop */}
        <div
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            background:
              "radial-gradient(ellipse at 0% 0%, rgba(var(--theme-accent-rgb,245,73,0),0.08) 0%, transparent 50%), radial-gradient(ellipse at 100% 100%, rgba(var(--theme-accent-rgb,245,73,0),0.05) 0%, transparent 50%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative px-5 md:px-7 py-6 md:py-8 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end">
          <div>
            <p className="overline uppercase mb-2">Tutorial</p>
            <h2 className="heading-2">Tour the panel</h2>
            <p className="text-default-500 mt-2 max-w-2xl text-sm md:text-base leading-relaxed">
              Every feature in the dashboard, with a step-by-step guide. Click{" "}
              <span className="text-[color:var(--theme-accent,#f54900)] font-semibold">
                Show guide
              </span>{" "}
              on any card for a deep walk-through, or hit{" "}
              <span className="text-[color:var(--theme-accent,#f54900)] font-semibold">
                Start guided tour
              </span>{" "}
              for a popover-by-popover walk-through of the live panel.
            </p>
            {/* Primary CTA */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <Button
                  size="md"
                  onPress={startTour}
                  className="!rounded-none text-xs uppercase tracking-wider font-bold text-white relative overflow-hidden"
                  style={{
                    backgroundColor: "var(--theme-accent,#f54900)",
                    boxShadow:
                      "0 0 0 1px rgba(255,255,255,0.06), 0 0 24px rgba(var(--theme-accent-rgb,245,73,0),0.35)",
                  }}
                  startContent={<PxPlay className="h-3.5 w-3.5" />}
                >
                  Start guided tour
                  <span className="ml-1 text-[10px] opacity-80 font-mono">
                    {tourChapters.length} chapters · ~{estMinutes} min
                  </span>
                </Button>
              </motion.div>
              <span className="text-[10px] text-default-500 font-mono uppercase tracking-wider">
                Esc to pause · ←/→ to navigate · leave anytime
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 min-w-[260px]">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
              <span className="text-default-500 font-semibold">
                Self-paced progress
              </span>
              <span className="font-mono tabular-nums text-default-300">
                {doneCount} / {ALL_FEATURE_KEYS.length}
              </span>
            </div>
            <div className="h-[4px] bg-white/[0.05] overflow-hidden relative">
              <motion.div
                className="h-full"
                style={{ backgroundColor: "var(--theme-accent,#f54900)" }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <div className="flex items-center gap-2 text-[10px] text-default-400">
              <PxBookOpen className="h-3 w-3" />
              <span>Local to this session</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tab switcher */}
      <Tabs
        aria-label="Tutorial sections"
        selectedKey={active}
        onSelectionChange={(k) => setActive(String(k))}
        variant="underlined"
        classNames={{
          base: "w-full",
          tabList:
            "gap-0 w-full overflow-x-auto styled-scrollbar p-0 bg-[#0d0d0d] border border-white/[0.06] !rounded-none flex-nowrap",
          tab: "!rounded-none px-4 h-12 data-[hover-unselected=true]:opacity-100 data-[hover-unselected=true]:bg-white/[0.02]",
          tabContent:
            "text-[11px] uppercase tracking-wider font-semibold text-default-400 group-data-[selected=true]:text-white",
          cursor:
            "!rounded-none w-full bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.10)] border-b-2 border-l-0 border-r-0 border-t-0 border-[color:var(--theme-accent,#f54900)]",
          panel: "px-0 pt-5",
        }}
      >
        {SECTIONS.map((section) => (
          <Tab
            key={section.key}
            title={
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span
                  style={{
                    color:
                      section.key === active
                        ? "var(--theme-accent,#f54900)"
                        : undefined,
                  }}
                >
                  <Icon k={section.iconKey} className="h-4 w-4" />
                </span>
                {section.label}
                <span
                  className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 border border-white/[0.06] bg-white/[0.02]"
                  style={{
                    color:
                      section.key === active
                        ? "var(--theme-accent,#f54900)"
                        : undefined,
                  }}
                >
                  {section.features.length}
                </span>
              </span>
            }
          >
            <SectionPanel
              section={activeSection}
              completed={completed}
              toggle={toggle}
              onOpenGuide={setOpenFeature}
            />
          </Tab>
        ))}
      </Tabs>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center justify-between gap-4 pt-4 border-t border-white/[0.06] flex-wrap"
      >
        <p className="text-xs text-default-500 flex items-center gap-2">
          <PxBookOpen className="h-3.5 w-3.5" />
          Stuck? The API Docs cover every endpoint with a live try-it panel.
        </p>
        <Link
          href="/dashboard/api-docs"
          className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--theme-accent,#f54900)] hover:underline"
        >
          API Docs →
        </Link>
      </motion.div>

      {/* Detail drawer */}
      <FeatureDrawer
        feature={openFeature}
        onClose={() => setOpenFeature(null)}
        completed={openFeature ? !!completed[openFeature.key] : false}
        onToggleComplete={() => openFeature && toggle(openFeature.key)}
      />
    </div>
  );
}

function SectionPanel({
  section,
  completed,
  toggle,
  onOpenGuide,
}: {
  section: SectionMeta;
  completed: Record<string, boolean>;
  toggle: (k: string) => void;
  onOpenGuide: (f: FeatureMeta) => void;
}) {
  const sectionDone = section.features.filter(
    (f) => completed[f.key]
  ).length;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={section.key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25 }}
      >
        <GlassCard hover={false} animate={false}>
          {/* Section header inside the big box */}
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <span
                className="shrink-0 flex items-center justify-center h-9 w-9 border"
                style={{
                  backgroundColor:
                    "rgba(var(--theme-accent-rgb,245,73,0),0.08)",
                  borderColor: "rgba(255,255,255,0.06)",
                  color: "var(--theme-accent,#f54900)",
                }}
              >
                <Icon k={section.iconKey} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                  {section.label}
                </h3>
                <p className="text-xs text-default-400 mt-0.5 leading-snug max-w-2xl">
                  {section.intro}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 border border-white/[0.06] bg-white/[0.02] text-default-400 shrink-0">
              <span className="text-white tabular-nums">{sectionDone}</span>
              <span className="opacity-50"> / </span>
              <span className="tabular-nums">{section.features.length}</span>
              <span className="ml-1 opacity-50">done</span>
            </span>
          </div>

          {/* Feature rows */}
          <motion.ul
            className="divide-y divide-white/[0.06]"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.04 } },
            }}
          >
            {section.features.map((feature, idx) => (
              <FeatureRow
                key={feature.key}
                feature={feature}
                index={idx}
                done={!!completed[feature.key]}
                onToggle={() => toggle(feature.key)}
                onOpenGuide={() => onOpenGuide(feature)}
              />
            ))}
          </motion.ul>
        </GlassCard>
      </motion.div>
    </AnimatePresence>
  );
}

function FeatureRow({
  feature,
  index,
  done,
  onToggle,
  onOpenGuide,
}: {
  feature: FeatureMeta;
  index: number;
  done: boolean;
  onToggle: () => void;
  onOpenGuide: () => void;
}) {
  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.22 }}
      className="px-5 py-4 hover:bg-white/[0.015] transition-colors"
    >
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        {/* Index / check */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={done ? "Mark unexplored" : "Mark explored"}
          className="shrink-0 flex items-center justify-center h-9 w-9 border transition-colors mt-0.5"
          style={{
            backgroundColor: done
              ? "rgba(34,197,94,0.1)"
              : "rgba(var(--theme-accent-rgb,245,73,0),0.06)",
            borderColor: done
              ? "rgba(34,197,94,0.3)"
              : "rgba(var(--theme-accent-rgb,245,73,0),0.2)",
            color: done ? "#22c55e" : "var(--theme-accent,#f54900)",
          }}
        >
          {done ? (
            <PxCheck className="h-4 w-4" />
          ) : (
            <span className="font-mono font-bold text-sm tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
        </button>

        {/* Title + description + highlights */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: "var(--theme-accent,#f54900)" }}>
              <Icon k={feature.iconKey} className="h-4 w-4" />
            </span>
            <h4
              className={`font-semibold text-sm leading-tight ${
                done ? "text-default-500 line-through" : "text-white"
              }`}
            >
              {feature.title}
            </h4>
          </div>
          <p className="text-xs text-default-400 leading-relaxed">
            {feature.description}
          </p>
          {feature.highlights && feature.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {feature.highlights.map((h, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-white/[0.08] bg-white/[0.02] text-default-400"
                >
                  <span className="text-[color:var(--theme-accent,#f54900)]">
                    <Icon k={h.iconKey} className="h-3 w-3" />
                  </span>
                  {h.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions — side-by-side */}
        <div className="flex flex-row gap-1.5 shrink-0 w-full md:w-auto mt-2 md:mt-0">
          <Button
            size="sm"
            variant="solid"
            onPress={onOpenGuide}
            className="!rounded-none text-[10px] uppercase tracking-wider font-bold h-8 text-white whitespace-nowrap flex-1 md:flex-none md:w-[150px]"
            style={{ backgroundColor: "var(--theme-accent,#f54900)" }}
            startContent={<PxBookOpen className="h-3 w-3" />}
          >
            Show guide
          </Button>
          {feature.href && feature.cta ? (
            <Link href={feature.href} className="block flex-1 md:flex-none">
              <Button
                size="sm"
                variant="bordered"
                className="!rounded-none border-white/[0.08] text-[10px] uppercase tracking-wider font-semibold h-8 w-full md:w-[150px] justify-between"
                endContent={<PxChevronRight className="h-3 w-3" />}
              >
                {feature.cta}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

function FeatureDrawer({
  feature,
  onClose,
  completed,
  onToggleComplete,
}: {
  feature: FeatureMeta | null;
  onClose: () => void;
  completed: boolean;
  onToggleComplete: () => void;
}) {
  // Lock body scroll + Esc to close
  useEffect(() => {
    if (!feature) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handler);
    };
  }, [feature, onClose]);

  return (
    <AnimatePresence>
      {feature && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] z-50 bg-[#0d0d0d] border-l border-white/[0.08] flex flex-col shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={feature.title}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-start gap-3">
              <span
                className="flex items-center justify-center h-10 w-10 border shrink-0"
                style={{
                  backgroundColor:
                    "rgba(var(--theme-accent-rgb,245,73,0),0.08)",
                  borderColor: "rgba(255,255,255,0.06)",
                  color: "var(--theme-accent,#f54900)",
                }}
              >
                <Icon k={feature.iconKey} className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-default-500 font-semibold mb-0.5">
                  Guide
                </p>
                <h3 className="text-base font-semibold text-white leading-tight">
                  {feature.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close guide"
                className="shrink-0 h-8 w-8 flex items-center justify-center border border-white/[0.08] hover:bg-white/[0.04] text-default-400 hover:text-white transition-colors"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto styled-scrollbar">
              <div className="px-5 py-5 space-y-6">
                {/* Intro */}
                <p className="text-sm text-white/80 leading-relaxed">
                  {feature.guide.intro}
                </p>

                {/* Steps */}
                <section>
                  <SectionLabel
                    icon={<PxCheck className="h-3.5 w-3.5" />}
                    label="Walk-through"
                  />
                  <ol className="space-y-3">
                    {feature.guide.steps.map((step, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 border border-white/[0.06] bg-black/20 p-3"
                      >
                        <span
                          className="shrink-0 h-6 w-6 flex items-center justify-center border font-mono font-bold text-xs tabular-nums"
                          style={{
                            backgroundColor:
                              "rgba(var(--theme-accent-rgb,245,73,0),0.06)",
                            borderColor:
                              "rgba(var(--theme-accent-rgb,245,73,0),0.2)",
                            color: "var(--theme-accent,#f54900)",
                          }}
                        >
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white leading-snug">
                            {step.title}
                          </p>
                          <p className="text-xs text-default-400 leading-relaxed mt-1">
                            {step.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                {/* Tips / gotchas */}
                {feature.guide.tips && feature.guide.tips.length > 0 && (
                  <section>
                    <SectionLabel
                      icon={<PxBookOpen className="h-3.5 w-3.5" />}
                      label="Tips & gotchas"
                    />
                    <ul className="space-y-2">
                      {feature.guide.tips.map((t, i) => (
                        <li
                          key={i}
                          className="border-l-2 px-3 py-2 bg-white/[0.02]"
                          style={{
                            borderColor:
                              t.kind === "tip"
                                ? "var(--theme-accent,#f54900)"
                                : "#facc15",
                          }}
                        >
                          <p
                            className="text-[10px] uppercase tracking-wider font-bold mb-1"
                            style={{
                              color:
                                t.kind === "tip"
                                  ? "var(--theme-accent,#f54900)"
                                  : "#facc15",
                            }}
                          >
                            {t.kind === "tip" ? "Pro tip" : "Gotcha"}
                          </p>
                          <p className="text-xs text-white/80 leading-relaxed">
                            {t.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Endpoints */}
                {feature.guide.endpoints &&
                  feature.guide.endpoints.length > 0 && (
                    <section>
                      <SectionLabel
                        icon={<PxCode2 className="h-3.5 w-3.5" />}
                        label="Related endpoints"
                      />
                      <div className="space-y-1.5">
                        {feature.guide.endpoints.map((e, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 border border-white/[0.06] bg-black/20 px-2.5 py-2"
                          >
                            <span
                              className="shrink-0 text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 border"
                              style={{
                                color: METHOD_COLORS[e.method] || "#fff",
                                borderColor: `${METHOD_COLORS[e.method]}33`,
                                backgroundColor: `${METHOD_COLORS[e.method]}11`,
                              }}
                            >
                              {e.method}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-mono text-white/80 break-all leading-relaxed">
                                {e.path}
                              </p>
                              <p className="text-[10px] text-default-500 mt-0.5 leading-snug">
                                {e.what}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                {/* Related */}
                {feature.guide.related && feature.guide.related.length > 0 && (
                  <section>
                    <SectionLabel
                      icon={<PxLink className="h-3.5 w-3.5" />}
                      label="See also"
                    />
                    <div className="flex flex-wrap gap-2">
                      {feature.guide.related.map((r, i) => (
                        <Link
                          key={i}
                          href={r.href}
                          className="text-[11px] uppercase tracking-wider font-semibold border border-white/[0.08] px-2.5 py-1 hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] hover:text-[color:var(--theme-accent,#f54900)] transition-colors"
                        >
                          {r.label} →
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/[0.08] grid grid-cols-2 gap-2 bg-[#0a0a0a]">
              <Button
                size="md"
                variant="bordered"
                onPress={onToggleComplete}
                className="!rounded-none border-white/[0.08] text-[11px] uppercase tracking-wider font-semibold"
                startContent={
                  completed ? (
                    <PxCheck className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <span className="h-3.5 w-3.5 border border-white/[0.2]" />
                  )
                }
              >
                {completed ? "Marked done" : "Mark as done"}
              </Button>
              {feature.href && feature.cta ? (
                <Link href={feature.href} onClick={onClose}>
                  <Button
                    size="md"
                    className="!rounded-none w-full text-[11px] uppercase tracking-wider font-bold text-white"
                    style={{
                      backgroundColor: "var(--theme-accent,#f54900)",
                    }}
                    endContent={<PxChevronRight className="h-3.5 w-3.5" />}
                  >
                    {feature.cta}
                  </Button>
                </Link>
              ) : (
                <span />
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function SectionLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[color:var(--theme-accent,#f54900)]">{icon}</span>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-default-500">
        {label}
      </p>
      <span className="flex-1 h-px bg-white/[0.06]" />
    </div>
  );
}
