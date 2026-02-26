import React, { useState, useEffect } from "react";
import { FileText, Download, RefreshCw, Settings, Save } from "lucide-react";

const InvoicesScreen = ({ API_URL, orders, clients, showMessage }) => {
  const [localInvoices, setLocalInvoices] = useState([]);
  const [loading, setLoading] = useState(false);

  // Billing settings state
  const [settings, setSettings] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [editSettings, setEditSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

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

  const loadSettings = async () => {
    try {
      const response = await fetch(`${API_URL}/api/billing/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setEditSettings({ ...data });
      }
    } catch (err) {
      // settings load failure is non-critical
    }
  };

  useEffect(() => {
    loadLocalInvoices();
    loadSettings();
  }, []);

  const handleSaveSettings = async () => {
    setSettingsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_series: editSettings.invoice_series,
          invoice_next_number: parseInt(editSettings.invoice_next_number, 10),
          invoice_number_padding: parseInt(editSettings.invoice_number_padding, 10),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setSettings(data);
        setEditSettings({ ...data });
        showMessage("Setări salvate cu succes!");
      } else {
        showMessage(data.error || "Eroare la salvarea setărilor", "error");
      }
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleDownloadLocalPdf = async (invId, invoiceCode) => {
    try {
      const response = await fetch(
        `${API_URL}/api/billing/local-invoices/${invId}/pdf`
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
      a.download = `factura-${invoiceCode || invId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    }
  };

  const handleDownloadExternalPdf = async (externalInvoiceId) => {
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm"
          >
            <Settings className="w-4 h-4" />
            Setări numerotare
          </button>
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

      {/* Billing Settings Panel */}
      {showSettings && editSettings && (
        <div className="bg-white rounded-lg shadow p-5 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">
            Setări numerotare facturi
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Serie factură
              </label>
              <input
                type="text"
                value={editSettings.invoice_series || ""}
                onChange={(e) =>
                  setEditSettings((s) => ({ ...s, invoice_series: e.target.value }))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="e.g. FCT"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Următorul număr
              </label>
              <input
                type="number"
                min={1}
                value={editSettings.invoice_next_number || 1}
                onChange={(e) =>
                  setEditSettings((s) => ({ ...s, invoice_next_number: e.target.value }))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Padding număr (cifre)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={editSettings.invoice_number_padding || 6}
                onChange={(e) =>
                  setEditSettings((s) => ({ ...s, invoice_number_padding: e.target.value }))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleSaveSettings}
              disabled={settingsLoading}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 transition text-sm"
            >
              <Save className="w-4 h-4" />
              Salvează setările
            </button>
            {settings && (
              <span className="text-xs text-gray-500">
                Exemplu cod curent:{" "}
                <strong>
                  {settings.invoice_series}-
                  {String(settings.invoice_next_number).padStart(
                    settings.invoice_number_padding,
                    "0"
                  )}
                </strong>
              </span>
            )}
          </div>
        </div>
      )}

      {localInvoices.length === 0 && !loading && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Nu există facturi generate.</p>
          <p className="text-sm mt-1">
            Facturile sunt generate automat la salvarea comenzilor.
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
                    Nr. Factură
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
                        <div className="font-medium text-amber-700">
                          {inv.invoice_code || inv.series || "-"}
                        </div>
                        {inv.external_invoice_id && (
                          <div className="text-xs text-gray-400">
                            ext: {inv.external_invoice_id}
                          </div>
                        )}
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
                        <button
                          onClick={() =>
                            handleDownloadLocalPdf(inv.id, inv.invoice_code)
                          }
                          className="p-1.5 hover:bg-blue-100 rounded text-blue-600 transition"
                          title="Descarcă PDF local"
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
          <p className="text-sm text-gray-600">Valoare totală</p>
          <p className="text-2xl font-bold text-blue-600">
            {localInvoices
              .reduce((s, i) => s + (i.total_with_vat || 0), 0)
              .toFixed(2)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Cu PDF local</p>
          <p className="text-2xl font-bold text-green-600">
            {localInvoices.filter((i) => i.invoice_code).length}
          </p>
        </div>
      </div>
    </div>
  );
};

export default InvoicesScreen;
