import React, { useState, useEffect } from "react";
import { FileText, Download, RefreshCw } from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import JSZip from "jszip";

/**
 * Generate a jsPDF document for a local invoice.
 * Uses company settings and only renders filled optional fields.
 * @param {object} inv  - billing_invoices row (with raw_snapshot parsed)
 * @param {object} company - company settings object
 * @returns {jsPDF} doc
 */
function generateInvoicePDF(inv, company) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const snap = inv.raw_snapshot || {};
  const client = snap.client || {};
  const items = snap.items || [];

  const leftMargin = 14;
  const pageWidth = 210;
  let y = 15;

  // ── HEADER: Company info ──────────────────────────────────────────────────
  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  doc.text(company.furnizorNume || "FURNIZOR", leftMargin, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");

  const companyLines = [
    company.furnizorCIF ? `CUI: ${company.furnizorCIF}` : null,
    company.furnizorNrRegCom ? `Nr. Reg. Com.: ${company.furnizorNrRegCom}` : null,
    [company.furnizorJudet, company.furnizorLocalitate].filter(Boolean).join(", ") || null,
    company.furnizorStrada || null,
    company.furnizorTelefon ? `Tel: ${company.furnizorTelefon}` : null,
    company.furnizorEmail ? `Email: ${company.furnizorEmail}` : null,
    company.furnizorBanca ? `Bancă: ${company.furnizorBanca}` : null,
    company.furnizorIBAN ? `IBAN: ${company.furnizorIBAN}` : null,
  ].filter(Boolean);

  companyLines.forEach((line) => {
    doc.text(line, leftMargin, y);
    y += 5;
  });

  // ── INVOICE TITLE ─────────────────────────────────────────────────────────
  y += 4;
  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  const invoiceCode = inv.invoice_code || snap.invoice_code || "FACTURA";
  doc.text(`FACTURĂ: ${invoiceCode}`, leftMargin, y);

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.text(
    `Data: ${inv.document_date || snap.orderDate || ""}`,
    pageWidth - leftMargin,
    y,
    { align: "right" }
  );
  y += 8;

  // ── CLIENT INFO ───────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text("CLIENT:", leftMargin, y);
  y += 5;
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");

  const clientLines = [
    client.nume || inv.client_name || snap.clientName || "-",
    client.cif ? `CUI: ${client.cif}` : null,
    client.nrRegCom ? `Nr. Reg. Com.: ${client.nrRegCom}` : null,
    [client.judet, client.localitate].filter(Boolean).join(", ") || null,
    client.strada || null,
  ].filter(Boolean);

  clientLines.forEach((line) => {
    doc.text(line, leftMargin, y);
    y += 5;
  });

  y += 4;

  // ── ITEMS TABLE ───────────────────────────────────────────────────────────
  const tableHead = [
    ["Nr.", "Denumire", "UM", "Cantitate", "Preț", "Valoare", "TVA%", "TVA"],
  ];
  const tableBody = items.map((item, idx) => {
    const product = item.product || {};
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    const value = qty * price;
    const vatPct = Number(product.cotaTVA ?? item.cotaTVA ?? 0);
    const vatAmt = value * (vatPct / 100);
    return [
      String(idx + 1),
      product.descriere || item.productId || "-",
      product.um || "-",
      qty.toFixed(3),
      price.toFixed(4),
      value.toFixed(2),
      `${vatPct}%`,
      vatAmt.toFixed(2),
    ];
  });

  doc.autoTable({
    head: tableHead,
    body: tableBody,
    startY: y,
    theme: "grid",
    styles: { fontSize: 8 },
    headStyles: { fillColor: [245, 158, 11] },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      7: { halign: "right" },
    },
  });

  y = doc.lastAutoTable.finalY + 6;

  // ── TOTALS ────────────────────────────────────────────────────────────────
  const totalFaraTVA = Number(inv.total || snap.total || 0);
  const totalTVA = Number(inv.total_vat || snap.totalTVA || 0);
  const totalCuTVA = Number(inv.total_with_vat || snap.totalWithVAT || 0);

  const totalsX = pageWidth - leftMargin - 60;
  doc.setFontSize(9);
  doc.text("Total fără TVA (RON):", totalsX, y);
  doc.text(totalFaraTVA.toFixed(2), pageWidth - leftMargin, y, { align: "right" });
  y += 5;
  doc.text("TVA (RON):", totalsX, y);
  doc.text(totalTVA.toFixed(2), pageWidth - leftMargin, y, { align: "right" });
  y += 5;
  doc.setFont(undefined, "bold");
  doc.text("Total de plată (RON):", totalsX, y);
  doc.text(totalCuTVA.toFixed(2), pageWidth - leftMargin, y, { align: "right" });
  doc.setFont(undefined, "normal");

  return doc;
}

/** Sanitize a string for use as a filename (remove diacritics, special chars). */
function sanitizeFilename(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const InvoicesScreen = ({ API_URL, orders, clients, company, showMessage }) => {
  const [localInvoices, setLocalInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [zipLoading, setZipLoading] = useState(false);

  const loadLocalInvoices = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/local-invoices`);
      if (response.ok) {
        const data = await response.json();
        setLocalInvoices(data);
        setSelected(new Set());
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
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === localInvoices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(localInvoices.map((i) => i.id)));
    }
  };

  /** Download a single invoice as PDF. */
  const handleDownloadSinglePdf = (inv) => {
    try {
      const co = company || {};
      const doc = generateInvoicePDF(inv, co);
      const code = sanitizeFilename(inv.invoice_code || inv.id);
      const clientName = sanitizeFilename(inv.client_name || "client");
      const date = inv.document_date || new Date().toISOString().split("T")[0];
      doc.save(`${code}_${clientName}_${date}.pdf`);
    } catch (err) {
      showMessage(`Eroare generare PDF: ${err.message}`, "error");
    }
  };

  /** Download selected invoices as a ZIP file containing individual PDFs. */
  const handleDownloadZip = async () => {
    const selectedInvoices = localInvoices.filter((i) => selected.has(i.id));
    if (selectedInvoices.length === 0) {
      showMessage("Selectați cel puțin o factură", "error");
      return;
    }
    setZipLoading(true);
    try {
      const co = company || {};
      const zip = new JSZip();

      selectedInvoices.forEach((inv) => {
        const doc = generateInvoicePDF(inv, co);
        const pdfBytes = doc.output("arraybuffer");
        const code = sanitizeFilename(inv.invoice_code || inv.id);
        const clientName = sanitizeFilename(inv.client_name || "client");
        const date = inv.document_date || new Date().toISOString().split("T")[0];
        zip.file(`${code}_${clientName}_${date}.pdf`, pdfBytes);
      });

      // Determine ZIP filename
      const dates = [...new Set(selectedInvoices.map((i) => i.document_date).filter(Boolean))];
      const zipDate =
        dates.length === 1
          ? dates[0].replace(/-/g, "_")
          : "multiple_dates";
      const zipName = `facturi_${zipDate}.zip`;

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showMessage(`✅ ZIP descărcat: ${zipName} (${selectedInvoices.length} facturi)`);
    } catch (err) {
      showMessage(`Eroare generare ZIP: ${err.message}`, "error");
    } finally {
      setZipLoading(false);
    }
  };

  const getOrderInfo = (orderId) => {
    const order = orders ? orders.find((o) => o.id === orderId) : null;
    const client =
      order && clients ? clients.find((c) => c.id === order.clientId) : null;
    return { order, client };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">Facturi</h2>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={handleDownloadZip}
              disabled={zipLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition text-sm"
            >
              <Download className={`w-4 h-4 ${zipLoading ? "animate-bounce" : ""}`} />
              Descarcă PDF (ZIP) ({selected.size})
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
            Folosiți butonul "Factură" din Matrice Comenzi.
          </p>
        </div>
      )}

      {localInvoices.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selected.size === localInvoices.length && localInvoices.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Cod Factură
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">
                    Dată
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">
                    Fără TVA (RON)
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">
                    TVA (RON)
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">
                    Total (RON)
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">
                    PDF
                  </th>
                </tr>
              </thead>
              <tbody>
                {localInvoices.map((inv) => {
                  const { client } = getOrderInfo(inv.order_id);
                  const clientName =
                    client?.nume || inv.client_name || inv.external_client_id || "-";
                  return (
                    <tr
                      key={inv.id}
                      className={`border-t border-gray-100 hover:bg-gray-50 ${
                        selected.has(inv.id) ? "bg-blue-50" : ""
                      }`}
                    >
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-blue-700">
                        {inv.invoice_code || inv.series || "-"}
                      </td>
                      <td className="px-4 py-3 font-medium">{clientName}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {inv.document_date || "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {inv.total != null ? Number(inv.total).toFixed(2) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {inv.total_vat != null
                          ? Number(inv.total_vat).toFixed(2)
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {inv.total_with_vat != null
                          ? Number(inv.total_with_vat).toFixed(2)
                          : "-"}
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
          <p className="text-sm text-gray-600">Valoare totală (RON)</p>
          <p className="text-2xl font-bold text-blue-600">
            {localInvoices
              .reduce((s, i) => s + (i.total_with_vat || 0), 0)
              .toFixed(2)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Selectate</p>
          <p className="text-2xl font-bold text-green-600">{selected.size}</p>
        </div>
      </div>
    </div>
  );
};

export default InvoicesScreen;
