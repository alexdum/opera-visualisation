import * as xlsx from "xlsx";

export const downloadCSV = (data: Record<string, unknown>[], filename: string) => {
  if (!data || data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map(row =>
      headers.map(header => {
        const val = row[header];
        return val === undefined || val === null ? "" : String(val);
      }).join(",")
    )
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const downloadExcel = (data: Record<string, unknown>[], filename: string) => {
  if (!data || data.length === 0) return;

  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Station Data");

  // Write and download
  xlsx.writeFile(workbook, `${filename}.xlsx`);
};
