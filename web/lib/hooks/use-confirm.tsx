"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { Button } from "@heroui/button";

export interface ConfirmOptions {
  title?: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive (red) action. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirm dialog provider — a styled replacement for the native
 * window.confirm() (which is unstyled and can be browser-suppressed). Mounted
 * once in the dashboard layout; call sites use `const confirm = useConfirm()`
 * then `if (!(await confirm({ ... }))) return;`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        isOpen={open}
        onClose={() => settle(false)}
        placement="center"
        backdrop="blur"
        radius="none"
      >
        <ModalContent>
          <ModalHeader>{opts.title || "Are you sure?"}</ModalHeader>
          <ModalBody>
            {opts.body ? (
              <div className="text-sm text-default-400">{opts.body}</div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => settle(false)}>
              {opts.cancelLabel || "Cancel"}
            </Button>
            <Button
              color={opts.danger ? "danger" : undefined}
              className={
                opts.danger
                  ? "rounded-none uppercase tracking-wider font-bold"
                  : "dashboard-btn-primary text-white rounded-none uppercase tracking-wider font-bold"
              }
              onPress={() => settle(true)}
            >
              {opts.confirmLabel || "Confirm"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return ctx;
}
