"use client";

import { Button } from "@heroui/button";
import NextLink from "next/link";
import { motion } from "framer-motion";

import { BrandLogo } from "@/components/icons";

export default function NotFound() {
  return (
    <section className="relative min-h-[100svh] flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-50 via-white to-brand-50 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950" />
      <div className="absolute inset-0 bg-pattern-grid opacity-50" />

      {/* Animated Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/3 -left-24 w-64 h-64 bg-primary-500/20 rounded-full blur-3xl"
          animate={{
            x: [0, 30, 0],
            y: [0, 20, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className="absolute bottom-1/3 -right-24 w-64 h-64 bg-brand-400/20 rounded-full blur-3xl"
          animate={{
            x: [0, -30, 0],
            y: [0, -20, 0],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      {/* Content */}
      <div className="container-section relative z-10 max-w-2xl mx-auto text-center py-12 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <BrandLogo size={80} />
            </motion.div>
          </div>

          {/* 404 Text */}
          <motion.h1
            className="text-8xl md:text-9xl font-bold gradient-text mb-4"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            404
          </motion.h1>

          <motion.h2
            className="text-2xl md:text-3xl font-semibold text-foreground mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            Page Not Found
          </motion.h2>

          <motion.p
            className="text-default-600 text-base md:text-lg mb-8 max-w-md mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
            Let&apos;s get you back on track.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            className="flex flex-col sm:flex-row gap-3 justify-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Button
              as={NextLink}
              href="/"
              color="primary"
              variant="shadow"
              size="lg"
              radius="full"
              className="font-semibold px-8 btn-glow"
            >
              Go Home
            </Button>
            <Button
              as={NextLink}
              href="/contact"
              variant="bordered"
              size="lg"
              radius="full"
              className="font-semibold px-8 border-default-300 dark:border-default-200"
            >
              Contact Us
            </Button>
          </motion.div>

          {/* Quick Links */}
          <motion.div
            className="mt-12 pt-8 border-t border-default-200/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <p className="text-sm text-default-400 mb-4">Or try these pages:</p>
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <NextLink
                href="/services"
                className="text-primary-500 hover:text-primary-600 transition-colors link-underline"
              >
                Services
              </NextLink>
              <NextLink
                href="/about"
                className="text-primary-500 hover:text-primary-600 transition-colors link-underline"
              >
                About Us
              </NextLink>
              <NextLink
                href="/contact"
                className="text-primary-500 hover:text-primary-600 transition-colors link-underline"
              >
                Contact
              </NextLink>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
