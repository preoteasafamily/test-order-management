import React, { useState, useEffect } from "react";
import { FileText, Download, RefreshCw } from "lucide-react";

const InvoicesScreen = ({ API_URL, orders, clients, showMessage }) => {
  const [localInvoices, setLocalInvoices] = useState([]);
  const [loading, setLoading] = useState(false);

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

  const handleDownloadPdf = async (externalInvoiceId) => {
    try {
      const response = await fetch(
        `${API_URL}/api/billing/invoices/${externalInvoiceId}/pdf`
      );
      if (!response.ok) {
        const err = await response.json();
        showMessage(err.error || "Eroare la descărcarea PDF-ului", "error");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `factura-${externalInvoiceId}.pdf`;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Facturi</h2>
        <button
          onClick={loadLocalInvoices}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 transition text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Reîncarcă
        </button>
      </div>

      {localInvoices.length === 0 && !loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Nu există facturi generate.</p>
          <p className="text-sm mt-1">
            Folosiți butonul "Generează factură" din Matrice Comenzi.
          </p>
        </div>
      )}

      {localInvoices.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Comandă
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Serie / Nr. extern
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
                  return (
                    <tr
                      key={inv.id}
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {client?.nume || inv.external_client_id || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>{order?.date || "-"}</div>
                        <div className="text-xs text-gray-400">
                          {inv.order_id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{inv.series || "-"}</div>
                        <div className="text-xs text-gray-400">
                          {inv.external_invoice_id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {inv.document_date || "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {inv.total_with_vat != null
                          ? Number(inv.total_with_vat).toFixed(2)
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                          {inv.status || "created"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {inv.external_invoice_id ? (
                          <button
                            onClick={() =>
                              handleDownloadPdf(inv.external_invoice_id)
                            }
                            className="p-1.5 hover:bg-blue-100 rounded text-blue-600 transition"
                            title="Descarcă PDF"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
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
          <p className="text-sm text-gray-600">Valoare totală</p>
          <p className="text-2xl font-bold text-blue-600">
            {localInvoices
              .reduce((s, i) => s + (i.total_with_vat || 0), 0)
              .toFixed(2)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Cu PDF disponibil</p>
          <p className="text-2xl font-bold text-green-600">
            {localInvoices.filter((i) => i.external_invoice_id).length}
          </p>
        </div>
      </div>
    </div>
  );
};

export default InvoicesScreen;
