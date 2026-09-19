"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { motion } from "framer-motion";
import { CopyIcon, CheckIcon } from "@/components/icons";

interface CodeBlockProps {
  code: string;
  language: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  code,
  language,
  showLineNumbers = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block relative rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-default-200 dark:border-neutral-800 overflow-hidden">
      {/* Language label */}
      <div className="absolute top-3 left-3 px-3 py-1 rounded-md bg-white dark:bg-neutral-900 text-xs font-semibold text-default-700 dark:text-default-300 border border-default-200 dark:border-neutral-800 shadow-sm">
        {language.toUpperCase()}
      </div>

      {/* Copy button */}
      <motion.button
        onClick={handleCopy}
        className="absolute top-3 right-3 p-2 rounded-md bg-white dark:bg-neutral-900 text-default-600 dark:text-default-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-950 transition-all border border-default-200 dark:border-neutral-800 shadow-sm"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label={copied ? "Copied!" : "Copy code"}
      >
        {copied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
      </motion.button>

      {/* Code content */}
      <div className="pt-10 pb-2">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          showLineNumbers={showLineNumbers}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "0.875rem",
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
