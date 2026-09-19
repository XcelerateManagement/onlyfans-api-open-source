"use client";

import { motion } from "framer-motion";

interface Endpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  title: string;
}

interface EndpointSelectorProps {
  endpoints: Endpoint[];
  activeEndpoint: string;
  onSelect: (id: string) => void;
}

const methodColors = {
  GET: "text-emerald-500",
  POST: "text-blue-500",
  PUT: "text-yellow-500",
  DELETE: "text-red-500",
};

export function EndpointSelector({
  endpoints,
  activeEndpoint,
  onSelect,
}: EndpointSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {endpoints.map((endpoint) => (
        <motion.button
          key={endpoint.id}
          onClick={() => onSelect(endpoint.id)}
          className={`
            flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm
            transition-all whitespace-nowrap border
            ${
              activeEndpoint === endpoint.id
                ? "bg-primary-500 text-white shadow-lg shadow-primary-500/30 border-primary-600"
                : "bg-white dark:bg-neutral-900 text-default-700 dark:text-default-200 hover:bg-default-100 dark:hover:bg-neutral-800 border-default-200 dark:border-neutral-700"
            }
          `}
          whileHover={{ scale: 1.03, y: -2 }}
          whileTap={{ scale: 0.97 }}
        >
          <span
            className={`font-mono font-bold ${
              activeEndpoint === endpoint.id
                ? "text-white"
                : methodColors[endpoint.method]
            }`}
          >
            {endpoint.method}
          </span>
          <span>{endpoint.title}</span>
        </motion.button>
      ))}
    </div>
  );
}
