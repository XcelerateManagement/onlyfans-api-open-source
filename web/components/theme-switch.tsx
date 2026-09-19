"use client";

import { FC } from "react";
import { VisuallyHidden } from "@react-aria/visually-hidden";
import { SwitchProps, useSwitch } from "@heroui/switch";
import { useTheme } from "@/lib/theme-context";
import { useIsSSR } from "@react-aria/ssr";
import clsx from "clsx";

import { MoonFilledIcon } from "@/components/icons";

export interface ThemeSwitchProps {
  className?: string;
  classNames?: SwitchProps["classNames"];
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({
  className,
  classNames,
}) => {
  const { theme } = useTheme();
  const isSSR = useIsSSR();

  const {
    Component,
    slots,
    getBaseProps,
    getInputProps,
    getWrapperProps,
  } = useSwitch({
    isSelected: false,
    "aria-label": "Dark mode enabled",
    onChange: () => {},
  });

  return (
    <Component
      {...getBaseProps({
        className: clsx(
          "px-px transition-opacity hover:opacity-80 cursor-pointer touch-target mobile-interactive",
          className,
          classNames?.base,
        ),
      })}
    >
      <VisuallyHidden>
        <input {...getInputProps()} />
      </VisuallyHidden>
      <div
        {...getWrapperProps()}
        className={slots.wrapper({
          class: clsx(
            [
              "w-10 h-10 sm:w-auto sm:h-auto",
              "bg-default-100 sm:bg-transparent",
              "rounded-full sm:rounded-lg",
              "flex items-center justify-center",
              "!text-default-500",
              "p-2 sm:p-0",
              "m-0",
            ],
            classNames?.wrapper,
          ),
        })}
      >
        <MoonFilledIcon size={22} />
      </div>
    </Component>
  );
};
