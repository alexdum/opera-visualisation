import React, { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";

interface WeatherTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  defaultSorting?: SortingState;
  onRowDoubleClick?: (row: T) => void;
  searchPlaceholder?: string;
  searchKey?: keyof T;
}

export function WeatherTable<T>({
  data,
  columns,
  defaultSorting = [],
  onRowDoubleClick,
  searchPlaceholder = "Filter records...",
  searchKey
}: WeatherTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(() => defaultSorting);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, filterValue) => {
      const val = row.getValue(columnId);
      if (val === undefined || val === null) return false;
      return String(val).toLowerCase().includes(String(filterValue).toLowerCase());
    },
    initialState: {
      pagination: {
        pageSize: 25
      }
    }
  });

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0">
      {/* Search Input bar */}
      {searchKey && (
        <div className="relative max-w-sm">
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-white/70 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        </div>
      )}

      {/* Grid container with sticky headers */}
      <div className="flex-1 w-full overflow-auto custom-scrollbar border border-slate-100 rounded-2xl bg-white shadow-sm min-h-0">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50/95 backdrop-blur z-10 border-b border-slate-100">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => {
                  const metaClassName = (header.column.columnDef.meta as any)?.className || "";
                  return (
                  <th
                    key={header.id}
                    className={`p-4 text-sm font-bold text-slate-500 uppercase tracking-wider select-none ${index === 0 ? "sticky left-0 bg-slate-50 z-20 shadow-[1px_0_0_0_#f1f5f9]" : ""} ${metaClassName}`}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                        className={`flex items-center gap-1.5 ${
                          header.column.getCanSort() ? "cursor-pointer hover:text-slate-800" : ""
                        }`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <ArrowUpDown size={13} className="text-slate-400 shrink-0" />
                        )}
                      </div>
                    )}
                  </th>
                )})}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => { if (window.innerWidth < 640 && onRowDoubleClick) onRowDoubleClick(row.original); }}
                onDoubleClick={() => onRowDoubleClick && onRowDoubleClick(row.original)}
                className={`group hover:bg-slate-50/80 transition-colors cursor-pointer ${
                  onRowDoubleClick ? "select-none" : ""
                }`}
              >
                {row.getVisibleCells().map((cell, index) => {
                  const metaClassName = (cell.column.columnDef.meta as any)?.className || "";
                  return (
                  <td 
                    key={cell.id} 
                    className={`p-4 text-sm text-slate-600 font-medium ${index === 0 ? "sticky left-0 bg-white shadow-[1px_0_0_0_#f1f5f9] z-10 group-hover:bg-slate-50" : ""} ${metaClassName}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                )})}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center text-sm text-slate-400 font-medium">
                  No records matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm text-slate-500 font-semibold">
          Page <span className="font-bold text-slate-700">{table.getState().pagination.pageIndex + 1}</span> of{" "}
          <span className="font-bold text-slate-700">{table.getPageCount()}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 active:scale-95 text-slate-600 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 active:scale-95 text-slate-600 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
