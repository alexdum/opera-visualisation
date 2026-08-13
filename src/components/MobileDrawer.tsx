"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileDrawer({ isOpen, onClose, children }: MobileDrawerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isTransitioningRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const sheet = sheetRef.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const focusFirstControl = window.requestAnimationFrame(() => {
      sheet?.querySelector<HTMLElement>(focusableSelector)?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !sheet) return;
      const controls = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((control) => control.getClientRects().length > 0 && !control.hasAttribute("hidden") && control.getAttribute("aria-hidden") !== "true");
      if (controls.length === 0) {
        event.preventDefault();
        sheet.focus({ preventScroll: true });
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstControl);
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
    };
  }, [isOpen, onClose]);

  // Sync React state to Popover open state
  useEffect(() => {
    const popover = popoverRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!popover || !scroller || !sheet) return;

    if (isOpen) {
      if (!popover.matches(':popover-open')) {
        isTransitioningRef.current = true;
        // Show popover
        popover.showPopover();
        // Snap instantly to the closed position (scrolled so sheet is hidden)
        scroller.scrollTo({ left: sheet.offsetWidth, behavior: 'instant' });
        
        // Wait a frame for the jump to commit, then smooth scroll to the open position
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scroller.scrollTo({ left: 0, behavior: 'smooth' });
            setTimeout(() => { isTransitioningRef.current = false; }, 400); // approx smooth scroll time
          });
        });
      } else {
        // Already open popover, ensure scrolled to open position
        scroller.scrollTo({ left: 0, behavior: 'smooth' });
      }
    } else {
      if (popover.matches(':popover-open')) {
        // Smooth scroll to the closed position
        isTransitioningRef.current = true;
        scroller.scrollTo({ left: sheet.offsetWidth, behavior: 'smooth' });
        // The IntersectionObserver will fire hidePopover once the scroll completes
      }
    }
  }, [isOpen]);

  // Sync scroll completion (closed) back to React state and Popover hide
  useEffect(() => {
    const sheet = sheetRef.current;
    const popover = popoverRef.current;
    if (!sheet || !popover) return;

    const visibleThreshold = 1 / window.innerWidth;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      
      if (entry.intersectionRatio < visibleThreshold) {
        // If React says we should be open, and we are setting up the open animation, ignore this temporary hide event.
        if (isOpen && isTransitioningRef.current) return;

        if (popover.matches(':popover-open')) {
          popover.hidePopover();
        }
        if (isOpen) {
          onClose(); // Notify parent that the user swiped to close manually
        }
        isTransitioningRef.current = false;
      }
    }, { root: popover, threshold: [visibleThreshold, 1] });
    
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [isOpen, onClose]);

  return (
    <div 
      popover="manual" 
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-label="Radar controls"
      className="mobile-drawer fixed inset-0 z-[60] h-[100dvh] w-full border-0 bg-transparent p-0 m-0"
    >
      <div 
        ref={scrollerRef}
        onScroll={(e) => {
          // Drive the backdrop opacity based on scroll position!
          const scroller = e.currentTarget;
          const sheet = sheetRef.current;
          if (!sheet) return;
          // When scrollLeft is 0, drawer is fully open (opacity 1)
          // When scrollLeft is sheet.offsetWidth, drawer is closed (opacity 0)
          const ratio = 1 - (scroller.scrollLeft / sheet.offsetWidth);
          const clamped = Math.max(0, Math.min(1, ratio));
          popoverRef.current?.style.setProperty('--drawer-backdrop', clamped.toString());
        }}
        className="flex h-[100dvh] w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: 'none' }} // Hide scrollbar in Firefox
      >
        <style dangerouslySetInnerHTML={{ __html: `
          .mobile-drawer > div::-webkit-scrollbar { display: none; }
        ` }} />
        
        {/* The Drawer Sheet (Content) */}
        <div ref={sheetRef} tabIndex={-1} className="glass-sidebar relative h-full w-[min(280px,calc(100vw-2.5rem))] shrink-0 snap-start shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close radar controls"
            className="absolute right-3 top-3 z-[60] flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/20 bg-slate-900/60 text-white shadow-lg backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            <X size={20} aria-hidden="true" />
          </button>
          {children}
        </div>
        
        {/* The Spacer (Light dismiss swipe area) */}
        <div 
          className="h-full w-[100vw] shrink-0 snap-start" 
          onClick={() => {
             // Light dismiss tap on the empty space
             if (!isTransitioningRef.current) {
                 onClose();
             }
          }} 
        />
      </div>
    </div>
  );
}
