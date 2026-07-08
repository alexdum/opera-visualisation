"use client";

import React, { useRef, useEffect, useCallback } from "react";
import { X, Download } from "lucide-react";
import { exportChartAsPng } from "@/utils/chartExport";

interface ChartModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  stationName?: string;
  country?: string;
}

/**
 * Fullscreen chart modal using native <dialog> for built-in focus trapping,
 * Esc-key handling, and top-layer stacking. Desktop only.
 */
export const ChartModal: React.FC<ChartModalProps> = ({
  title,
  isOpen,
  onClose,
  children,
  stationName,
  country,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Sync open state with native <dialog> API
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Close on backdrop click (click on <dialog> itself, not its content)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle native close event (e.g. Esc key)
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDownload = useCallback(() => {
    if (contentRef.current) {
      exportChartAsPng(contentRef.current, { title, stationName, country });
    }
  }, [title, stationName, country]);

  return (
    <dialog
      ref={dialogRef}
      className="chart-modal m-auto"
      onClick={handleBackdropClick}
      onClose={handleClose}
    >
      <div className="flex flex-col w-[90vw] h-[85vh] bg-white rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
            {title}
          </h2>
          <div className="flex items-center gap-1">
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={`Download ${title} as image`}
              onClick={handleDownload}
            >
              <Download size={16} />
            </button>
            <button
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Close expanded view"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Chart content — flex-1 lets ResponsiveContainer fill the available space */}
        <div ref={contentRef} className="flex-1 min-h-0 p-6">
          {isOpen && children}
        </div>
      </div>
    </dialog>
  );
};
