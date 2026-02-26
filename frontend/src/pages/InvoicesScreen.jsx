import React, { useState, useEffect } from "react";
import { FileText, Download, RefreshCw, Settings, Save, CheckSquare, Square } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";

// Strip diacritics for safe filenames
const stripDiacritics = (str) =>
  (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "_");

// Generate a jsPDF invoice document
const generateInvoicePDF = (inv, company) => {
  const doc = new jsPDF({ format: "a4", unit: "pt" });
  const snapshot =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? JSON.parse(inv.raw_snapshot)
      : {};

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 40;

  // Company header (only filled fields)
  if (company) {
    const headerLines = [
      company.furnizorNume,
      company.furnizorCIF ? `CIF: ${company.furnizorCIF}` : null,
      company.furnizorNrRegCom ? `Reg. Com.: ${company.furnizorNrRegCom}` : null,
      company.furnizorStrada || company.furnizorLocalitate
        ? [company.furnizorStrada, company.furnizorLocalitate, company.furnizorJudet]
            .filter(Boolean)
            .join(", ")
        : null,
      company.furnizorTelefon ? `Tel: ${company.furnizorTelefon}` : null,
      company.furnizorEmail ? `Email: ${company.furnizorEmail}` : null,
      company.furnizorBanca ? `Bancă: ${company.furnizorBanca}` : null,
      company.furnizorIBAN ? `IBAN: ${company.furnizorIBAN}` : null,
    ].filter(Boolean);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    for (const line of headerLines) {
      doc.text(line, 40, y);
      y += 13;
    }
    y += 6;
  }

  // Title
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA", pageWidth / 2, y, { align: "center" });
  y += 22;

  if (inv.invoice_code) {
    doc.setFontSize(13);
    doc.setFont("helvetica", "normal");
    doc.text(`Nr: ${inv.invoice_code}`, pageWidth / 2, y, { align: "center" });
    y += 16;
  }

  doc.setFontSize(10);
  doc.text(`Data: ${inv.document_date || "-"}`, pageWidth / 2, y, { align: "center" });
  y += 20;

  // Client info
  const clientName = snapshot.clientName || inv.client_name || inv.external_client_id || "-";
  doc.setFont("helvetica", "bold");
  doc.text("Client:", 40, y);
  doc.setFont("helvetica", "normal");
  doc.text(clientName, 100, y);
  y += 20;

  // Items table
  const lines = snapshot.lines || snapshot.documentPositions || [];
  if (lines.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Descriere", "UM", "Cant.", "Pret", "TVA%", "Total"]],
      body: lines.map((item) => [
        item.description || item.descriere || "-",
        item.unit || item.um || "buc",
        item.unitCount || item.quantity || "0",
        Number(item.price || 0).toFixed(2),
        item.vat != null ? `${item.vat}%` : "-",
        Number(item.total || (parseFloat(item.unitCount || item.quantity || 0) * parseFloat(item.price || 0))).toFixed(2),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [245, 158, 11] },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Totals
  const totalFaraTva = Number(inv.total || 0).toFixed(2);
  const totalTva = Number(inv.total_vat || 0).toFixed(2);
  const totalCuTva = Number(inv.total_with_vat || 0).toFixed(2);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Total fara TVA: ${totalFaraTva} RON`, pageWidth - 40, y, { align: "right" });
  y += 14;
  doc.text(`TVA: ${totalTva} RON`, pageWidth - 40, y, { align: "right" });
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.text(`Total de plata: ${totalCuTva} RON`, pageWidth - 40, y, { align: "right" });

  return doc;
};

const InvoicesScreen = ({ API_URL, orders, clients, showMessage, currentUser }) => {
  const [localInvoices, setLocalInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Billing settings state
  const [settings, setSettings] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [editSettings, setEditSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const isAdmin = currentUser?.role === "admin";

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

  const loadCompany = async () => {
    try {
      const response = await fetch(`${API_URL}/api/config/company`);
      if (response.ok) {
        const data = await response.json();
        setCompany(data);
      }
    } catch (err) {
      // company load failure is non-critical
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
    loadCompany();
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

  const handleDownloadLocalPdf = (inv) => {
    try {
      const doc = generateInvoicePDF(inv, company);
      const filename = `factura-${stripDiacritics(inv.invoice_code || inv.id)}.pdf`;
      doc.save(filename);
    } catch (err) {
      showMessage(`Eroare la generarea PDF: ${err.message}`, "error");
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

  const handleBatchZip = async () => {
    if (selectedIds.size === 0) {
      showMessage("Selectați cel puțin o factură", "error");
      return;
    }
    try {
      const zip = new JSZip();
      const selected = localInvoices.filter((inv) => selectedIds.has(inv.id));
      for (const inv of selected) {
        const doc = generateInvoicePDF(inv, company);
        const { order, client } = getOrderInfo(inv.order_id);
        const clientName = stripDiacritics(
          client?.nume || inv.client_name || inv.external_client_id || "Client"
        );
        const sanitizedClientName = clientName.slice(0, 50); // limit filename length
        const date = inv.document_date || order?.date || "data";
        const code = stripDiacritics(inv.invoice_code || inv.id);
        const filename = `${code}_${sanitizedClientName}_${date}.pdf`;
        const pdfBytes = doc.output("arraybuffer");
        zip.file(filename, pdfBytes);
      }

      const dates = [...new Set(selected.map((i) => i.document_date).filter(Boolean))];
      const zipName =
        dates.length === 1
          ? `facturi_${dates[0].replace(/-/g, "_")}.zip`
          : "facturi_multiple_dates.zip";

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(`Eroare la generarea ZIP: ${err.message}`, "error");
    }
  };

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
          {isAdmin && (
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm"
            >
              <Settings className="w-4 h-4" />
              Setări numerotare
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={handleBatchZip}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
            >
              <Download className="w-4 h-4" />
              Descarcă PDF ({selectedIds.size}) ZIP
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

      {/* Billing Settings Panel */}
      {isAdmin && showSettings && editSettings && (
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
                  <th className="px-4 py-3 text-center">
                    <button onClick={toggleSelectAll} className="p-0.5">
                      {selectedIds.size === localInvoices.length && localInvoices.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-amber-600" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </th>
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
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleSelect(inv.id)} className="p-0.5">
                          {selectedIds.has(inv.id) ? (
                            <CheckSquare className="w-4 h-4 text-amber-600" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {client?.nume || inv.client_name || inv.external_client_id || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>{order?.date || "-"}</div>
                        <div className="text-xs text-gray-400">
                          {inv.order_id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono font-medium text-amber-700">
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
                          : "-"}{" "}
                        RON
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                          {inv.status || "created"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDownloadLocalPdf(inv)}
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
