import React, { useState, useEffect } from "react";
import { FileText, Download, RefreshCw, Archive, CheckSquare, Square } from "lucide-react";

const InvoicesScreen = ({ API_URL, orders, clients, company, showMessage }) => {
  const [localInvoices, setLocalInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloading, setDownloading] = useState(false);

  const loadLocalInvoices = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/local-invoices`);
      if (response.ok) {
        const data = await response.json();
        setLocalInvoices(data);
      } else {
        showMessage("Eroare la încărcarea facturilor", "error");
      }
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocalInvoices();
  }, []);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === localInvoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(localInvoices.map((i) => i.id)));
    }
  };

  const handleDownloadZip = async () => {
    if (selectedIds.size === 0) {
      showMessage("Selectați cel puțin o factură", "error");
      return;
    }
    setDownloading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/billing/local-invoices/pdf/batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceIds: Array.from(selectedIds) }),
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        showMessage(err.error || "Eroare la generarea ZIP-ului", "error");
        return;
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") || "";
      const match = contentDisposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : "facturi.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadSinglePdf = async (inv) => {
    try {
      const response = await fetch(
        `${API_URL}/api/billing/local-invoices/${inv.id}/pdf`
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        showMessage(err.error || "Eroare la descărcarea PDF-ului", "error");
        return;
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") || "";
      const match = contentDisposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `factura-${inv.id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    }
  };

  const getOrderInfo = (orderId) => {
    const order = orders ? orders.find((o) => o.id === orderId) : null;
    const client =
      order && clients
        ? clients.find((c) => c.id === order.clientId)
        : null;
    return { order, client };
  };

  const allSelected = localInvoices.length > 0 && selectedIds.size === localInvoices.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Facturi</h2>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handleDownloadZip}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition text-sm"
            >
              <Archive className={`w-4 h-4 ${downloading ? "animate-pulse" : ""}`} />
              Descarcă PDF (ZIP) ({selectedIds.size})
            </button>
          )}
          <button
            onClick={loadLocalInvoices}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 transition text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Reîncarcă
          </button>
        </div>
      </div>

      {localInvoices.length === 0 && !loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Nu există facturi generate.</p>
          <p className="text-sm mt-1">
            Facturile se creează automat la salvarea comenzilor.
          </p>
        </div>
      )}

      {localInvoices.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3">
                    <button onClick={toggleSelectAll} className="text-gray-600 hover:text-gray-900">
                      {allSelected
                        ? <CheckSquare className="w-4 h-4" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Cod factură
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Comandă
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Dată document
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">
                    Total cu TVA
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">
                    PDF
                  </th>
                </tr>
              </thead>
              <tbody>
                {localInvoices.map((inv) => {
                  const { order, client } = getOrderInfo(inv.order_id);
                  const isSelected = selectedIds.has(inv.id);
                  return (
                    <tr
                      key={inv.id}
                      className={`border-t border-gray-100 hover:bg-gray-50 ${isSelected ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => toggleSelect(inv.id)} className="text-blue-600 hover:text-blue-900">
                          {isSelected
                            ? <CheckSquare className="w-4 h-4" />
                            : <Square className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-blue-700">
                        {inv.invoice_code || "-"}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {inv.client_name || client?.nume || inv.external_client_id || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>{order?.date || "-"}</div>
                        <div className="text-xs text-gray-400">
                          {inv.order_id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {inv.document_date || "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {inv.total_with_vat != null
                          ? `${Number(inv.total_with_vat).toFixed(2)} RON`
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                          {inv.status || "draft"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDownloadSinglePdf(inv)}
                          className="p-1.5 hover:bg-blue-100 rounded text-blue-600 transition"
                          title="Descarcă PDF"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Total facturi</p>
          <p className="text-2xl font-bold text-gray-800">
            {localInvoices.length}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Valoare totală (cu TVA)</p>
          <p className="text-2xl font-bold text-blue-600">
            {localInvoices
              .reduce((s, i) => s + (i.total_with_vat || 0), 0)
              .toFixed(2)}{" "}
            RON
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Selectate</p>
          <p className="text-2xl font-bold text-green-600">
            {selectedIds.size}
          </p>
        </div>
      </div>
    </div>
  );
};

export default InvoicesScreen;

