import { useRef, useLayoutEffect, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
export function AccessibleDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement;
  }, [open]);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className="modal dialog-content"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
        >
          <Dialog.Close asChild>
            <button className="modal-close" aria-label="Close dialog">
              <X size={20} />
            </button>
          </Dialog.Close>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CancelAgreementDialog({
  open,
  onClose,
  onConfirm,
  amount,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  amount: string;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-backdrop" />
        <AlertDialog.Content className="modal dialog-content">
          <AlertDialog.Title>Cancel this group order?</AlertDialog.Title>
          <AlertDialog.Description>
            {amount} dUSD currently held will become claimable by the people who
            contributed. Each person must claim their own refund. The merchant
            cannot capture this order afterwards.
          </AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Cancel asChild>
              <button className="secondary" onClick={onClose}>
                Keep order
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button className="danger-button" onClick={onConfirm}>
                Cancel & unlock refunds
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
