"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDownIcon } from "@/components/icons";
import { accordionVariants } from "@/lib/animations";

interface AccordionItemProps {
  question: string;
  answer: string;
}

export function AccordionItem({ question, answer }: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="accordion-item" data-state={isOpen ? "open" : "closed"}>
      <button onClick={() => setIsOpen(!isOpen)} className="accordion-header">
        <span className="text-left">{question}</span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDownIcon className="w-5 h-5" />
        </motion.div>
      </button>

      {/* Answer is ALWAYS mounted so it ships in the server-rendered HTML that
          crawlers and AI answer-engines read on first pass. Visibility is
          driven by the open/closed variants (height 0 ↔ auto), not by
          conditional mounting. */}
      <motion.div
        className="accordion-content overflow-hidden"
        initial={false}
        animate={isOpen ? "open" : "closed"}
        variants={accordionVariants}
        aria-hidden={!isOpen}
      >
        {answer}
      </motion.div>
    </div>
  );
}
