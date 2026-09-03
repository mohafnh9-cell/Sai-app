"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/** shadcn Sheet pattern (Dialog primitive + off-canvas side variants), adapted to SequrAI tokens. */
const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/50 sheet-overlay-reveal", className)}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

const sheetVariants = cva("fixed z-50 gap-4 border-border bg-card shadow-premium-lg", {
  variants: {
    side: {
      left: "inset-y-0 left-0 h-full border-r sheet-reveal-left",
      right: "inset-y-0 right-0 h-full border-l",
      top: "inset-x-0 top-0 border-b",
      bottom: "inset-x-0 bottom-0 border-t",
    },
  },
  defaultVariants: { side: "right" },
})

type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
  VariantProps<typeof sheetVariants> & { showClose?: boolean }

const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ side = "right", showClose = true, className, children, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-lg p-1.5 opacity-70 seq-transition hover:opacity-100 hover:bg-surface-hover seq-focus-ring disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
)
SheetContent.displayName = DialogPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center justify-between", className)} {...props} />
)
SheetHeader.displayName = "SheetHeader"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-sm font-semibold text-foreground", className)} {...props} />
))
SheetTitle.displayName = DialogPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
SheetDescription.displayName = DialogPrimitive.Description.displayName

export { Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetTitle, SheetDescription }
