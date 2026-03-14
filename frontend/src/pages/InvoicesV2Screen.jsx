import React, { useState, useEffect } from "react";
import { FileText, FileCode, Download, RefreshCw, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Strip diacritics for safe filenames (slashes replaced with hyphens)
const stripDiacritics = (str) =>
  (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\//g, "-")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "_");

// Build a synchronized row list: each entry is { seller, buyer, bold }
// Rows where both seller and buyer are empty are skipped at render time.
const buildHeaderRows = (company, snap, client) => {
  const cName =
    snap.clientName || client?.nume || null;
  const cCIF = snap.clientCIF || client?.cif || null;
  const cNrRegCom = snap.clientNrRegCom || client?.nrRegCom || null;
  const cStrada = snap.clientStrada || client?.strada || null;
  const cLocalitate = snap.clientLocalitate || client?.localitate || null;
  const cJudet = snap.clientJudet || client?.judet || null;
  const cTara = snap.clientTara || client?.buyer_country || "RO";

  const sellerStreet  = company?.bt_35_seller_address || "";
  const sellerCityReg = [company?.bt_37_seller_city, company?.bt_39_seller_region].filter(Boolean).join(", ");
  const buyerCityReg  = [cLocalitate, cJudet].filter(Boolean).join(", ");

  return [
    {
      seller: company?.bt_27_seller_name || "",
      buyer: cName || "",
      bold: true,
    },
    {
      seller: company?.bt_31_32_seller_vat_identifier || company?.bt_29_seller_identifier
        ? `CIF: ${company.bt_31_32_seller_vat_identifier || company.bt_29_seller_identifier}`
        : "",
      buyer: cCIF ? `CIF: ${cCIF}` : "",
    },
    {
      seller: company?.bt_30_seller_legal_registration
        ? `Reg.Com.: ${company.bt_30_seller_legal_registration}`
        : "",
      buyer: cNrRegCom ? `Reg.Com.: ${cNrRegCom}` : "",
    },
    {
      seller: sellerStreet,
      buyer: cStrada || "",
    },
    {
      seller: sellerCityReg,
      buyer: buyerCityReg,
    },
    {
      seller: company?.bt_42_seller_phone
        ? `Tel: ${company.bt_42_seller_phone}`
        : "",
      buyer: cTara && cTara !== "RO" ? `Tara: ${cTara}` : "",
    },
    {
      seller: company?.bt_43_seller_email ? `Email: ${company.bt_43_seller_email}` : "",
      buyer: "",
    },
    {
      seller: company?.bt_85_payee_bank_name ? `Banca: ${company.bt_85_payee_bank_name}` : "",
      buyer: "",
    },
    {
      seller: company?.bt_84_payee_iban ? `IBAN: ${company.bt_84_payee_iban}` : "",
      buyer: "",
    },
  ].filter((r) => r.seller || r.buyer);
};

// Generate PDF: two-column header synchronized row by row, no titles/separators
const generatePDF = (inv, company, client) => {
  const doc = new jsPDF({ format: "a4", unit: "pt" });
  const snap =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? JSON.parse(inv.raw_snapshot)
      : {};

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 40;

  doc.setFontSize(16).setFont("helvetica", "bold");
  doc.text("FACTURA", pageWidth / 2, y, { align: "center" });
  y += 18;

  if (inv.invoice_code) {
    doc.setFontSize(12).setFont("helvetica", "normal");
    doc.text(`Nr: ${inv.invoice_code}`, pageWidth / 2, y, { align: "center" });
    y += 14;
  }

  doc.setFontSize(9).setFont("helvetica", "normal");
  doc.text(`Data: ${inv.document_date || "-"}`, pageWidth / 2, y, {
    align: "center",
  });
  y += 16;

  // Row-synchronized header: seller left, buyer right-aligned
  const leftX      = 40;
  const rightMargin = pageWidth - 40;
  const lineH      = 13;
  const halfWidth  = Math.floor(pageWidth / 2) - 50;

  // rightY tracks the buyer column's current vertical position separately,
  // so that the delivery section is placed immediately under the last buyer row
  // (not under the last seller row, which may extend further down).
  let rightY = y;
  const rows = buildHeaderRows(company, snap, client);
  for (const row of rows) {
    doc
      .setFont("helvetica", row.bold ? "bold" : "normal")
      .setFontSize(9);
    if (row.seller) doc.text(row.seller, leftX, y, { maxWidth: halfWidth });
    if (row.buyer) {
      doc.text(row.buyer, rightMargin, y, { align: "right", maxWidth: halfWidth });
      rightY = y + lineH;
    }
    y += lineH;
  }
  doc.setFont("helvetica", "normal");

  // Delivery section – right column, directly under buyer data; same font/size/style as buyer
  const dName    = snap.clientDeliveryName    || client?.delivery_name    || null;
  const dGLN     = snap.clientDeliveryGLN     || client?.delivery_gln     || null;
  const dAddress = snap.clientDeliveryAddress || client?.delivery_address || null;
  const dCity    = snap.clientDeliveryCity    || client?.delivery_city    || null;
  const dRegion  = snap.clientDeliveryRegion  || client?.delivery_region  || null;
  const hasDelivery = dName || dGLN || dAddress || dCity || dRegion;
  if (hasDelivery) {
    doc.setFontSize(9).setFont("helvetica", "normal");
    if (dName) {
      const ln = doc.splitTextToSize(`Denumire Loc Livrare: ${dName}`, halfWidth);
      doc.text(ln, rightMargin, rightY, { align: "right" }); rightY += ln.length * lineH;
    }
    if (dGLN) {
      const ln = doc.splitTextToSize(`GLN Loc Livrare: ${dGLN}`, halfWidth);
      doc.text(ln, rightMargin, rightY, { align: "right" }); rightY += ln.length * lineH;
    }
    if (dAddress) {
      const ln = doc.splitTextToSize(`Adresa Livrare: ${dAddress}`, halfWidth);
      doc.text(ln, rightMargin, rightY, { align: "right" }); rightY += ln.length * lineH;
    }
    if (dCity) {
      const ln = doc.splitTextToSize(`Localitate Livrare: ${dCity}`, halfWidth);
      doc.text(ln, rightMargin, rightY, { align: "right" }); rightY += ln.length * lineH;
    }
    if (dRegion) {
      doc.text(`Judet: ${dRegion}`, rightMargin, rightY, { align: "right" }); rightY += lineH;
    }
  }

  // Table starts below whichever column is taller
  y = Math.max(y, rightY) + lineH;

  // Products table: Nr. | Cod (barcode/EAN) | Descriere | UM | Cant. | Pret | Total
  const lines = snap.lines || snap.documentPositions || [];
  if (lines.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Nr.", "Cod", "Descriere", "UM", "Cant.", "Pret", "Total"]],
      body: lines.map((item, idx) => [
        item.lineId != null ? item.lineId : idx + 1,
        item.barcode || "-",
        item.description || item.descriere || "-",
        item.unit || item.um || "-",
        item.unitCount || item.quantity || "0",
        Number(item.price || 0).toFixed(2),
        Number(
          item.total ||
            parseFloat(item.unitCount || item.quantity || 0) *
              parseFloat(item.price || 0)
        ).toFixed(2),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [220, 220, 220], textColor: 0, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 25, halign: "right" },
        1: { cellWidth: 75 },
        3: { cellWidth: 28, halign: "center" },
        4: { cellWidth: 38, halign: "right" },
        5: { cellWidth: 50, halign: "right" },
        6: { cellWidth: 55, halign: "right" },
      },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Totals
  doc.setFontSize(9).setFont("helvetica", "normal");
  doc.text(
    `Total fara TVA: ${Number(inv.total || 0).toFixed(2)} RON`,
    pageWidth - 40,
    y,
    { align: "right" }
  );
  y += 12;
  doc.text(
    `TVA: ${Number(inv.total_vat || 0).toFixed(2)} RON`,
    pageWidth - 40,
    y,
    { align: "right" }
  );
  y += 12;
  doc.setFont("helvetica", "bold");
  doc.text(
    `TOTAL: ${Number(inv.total_with_vat || 0).toFixed(2)} RON`,
    pageWidth - 40,
    y,
    { align: "right" }
  );

  return doc;
};

// Generate UBL 2.1 XML: barcode → StandardItemIdentification (BT-157)
const generateUBL = (inv, company, client) => {
  const snap =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? JSON.parse(inv.raw_snapshot)
      : {};

  const esc = (v) =>
    String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const cName =
    snap.clientName || client?.nume || inv.client_name || "";
  const cCIF = snap.clientCIF || client?.cif || "";
  const cNrRegCom = snap.clientNrRegCom || client?.nrRegCom || "";
  const cStrada = snap.clientStrada || client?.strada || "";
  const cCity = snap.clientLocalitate || client?.localitate || "";
  const cRegion = snap.clientJudet || client?.judet || "";
  const cCountry = snap.clientTara || client?.buyer_country || "RO";

  const lines = snap.lines || snap.documentPositions || [];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${esc(inv.invoice_code || inv.id)}</cbc:ID>
  <cbc:IssueDate>${esc(inv.document_date || "")}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>\n`;

  if (company) {
    xml += `  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(company.bt_27_seller_name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(company.bt_35_seller_address)}</cbc:StreetName>
        <cbc:CityName>${esc(company.bt_37_seller_city)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(company.bt_39_seller_region)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(company.bt_40_seller_country || 'RO')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(company.bt_31_32_seller_vat_identifier || company.bt_29_seller_identifier)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(company.bt_27_seller_name)}</cbc:RegistrationName>
        <cbc:CompanyID>${esc(company.bt_30_seller_legal_registration)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>\n`;
  }

  xml += `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(cName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(cStrada)}</cbc:StreetName>
        <cbc:CityName>${esc(cCity)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(cRegion)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(cCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(cCIF)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(cName)}</cbc:RegistrationName>
        <cbc:CompanyID>${esc(cNrRegCom)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>\n`;

  lines.forEach((item, idx) => {
    const lineId = item.lineId != null ? item.lineId : idx + 1;
    const barcode = item.barcode || "";
    const productCode = item.productCode || "";
    const desc = item.description || item.descriere || "";
    const um = item.unit || item.um || "C62";
    const qty = Number(item.unitCount || item.quantity || 0).toFixed(3);
    const price = Number(item.price || 0).toFixed(4);
    const total = Number(
      item.total || parseFloat(qty) * parseFloat(price)
    ).toFixed(2);
    const vatRate = item.vat != null ? String(item.vat) : "19";

    xml += `  <cac:InvoiceLine>
    <cbc:ID>${lineId}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(um)}">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${total}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(desc)}</cbc:Name>\n`;
    if (productCode) {
      xml += `      <cac:SellersItemIdentification><cbc:ID>${esc(productCode)}</cbc:ID></cac:SellersItemIdentification>\n`;
    }
    if (barcode) {
      // schemeID "0160" = GS1 Global Trade Item Number (GTIN) per UBL 2.1 / GS1 standard
      xml += `      <cac:StandardItemIdentification><cbc:ID schemeID="0160">${esc(barcode)}</cbc:ID></cac:StandardItemIdentification>\n`;
    }
    xml += `      <cac:ClassifiedTaxCategory>
        <cbc:Percent>${esc(vatRate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="RON">${price}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>\n`;
  });

  xml += `</Invoice>`;
  return xml;
};

// ─── Component ────────────────────────────────────────────────────────────────

const InvoicesV2Screen = ({ API_URL, orders, clients, showMessage }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState(null);
  const [settings, setSettings] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [invRes, compRes, settRes] = await Promise.all([
        fetch(`${API_URL}/api/billing/local-invoices`),
        fetch(`${API_URL}/api/config/company`),
        fetch(`${API_URL}/api/billing/settings`),
      ]);
      if (invRes.ok) setInvoices(await invRes.json());
      if (compRes.ok) setCompany(await compRes.json());
      if (settRes.ok) setSettings(await settRes.json());
    } catch (err) {
      showMessage(`Eroare la incarcare: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getClientForInvoice = (inv) => {
    const order = orders ? orders.find((o) => o.id === inv.order_id) : null;
    return order && clients
      ? clients.find((c) => c.id === order.clientId) || null
      : null;
  };

  const handlePDF = (inv) => {
    try {
      const client = getClientForInvoice(inv);
      generatePDF(inv, company, client).save(
        `factura-${stripDiacritics(inv.invoice_code || inv.id)}.pdf`
      );
    } catch (err) {
      showMessage(`Eroare PDF: ${err.message}`, "error");
    }
  };

  const handleUBL = (inv) => {
    try {
      const client = getClientForInvoice(inv);
      const xml = generateUBL(inv, company, client);
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `factura-${stripDiacritics(inv.invoice_code || inv.id)}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(`Eroare UBL: ${err.message}`, "error");
    }
  };

  const toggleDetail = (inv) => {
    setSelectedInv((prev) => (prev?.id === inv.id ? null : inv));
  };

  return (
    <div className="space-y-4 p-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Facturi V2</h2>
        <div className="flex items-center gap-4">
          {settings && (
            <span className="text-sm text-gray-500">
              Serie:{" "}
              <strong>
                {settings.invoice_series}-
                {String(settings.invoice_next_number).padStart(
                  settings.invoice_number_padding,
                  "0"
                )}
              </strong>
            </span>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Reincarca
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && invoices.length === 0 && (
        <div className="text-center text-gray-500 py-10">
          <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          <p>Nu exista facturi generate.</p>
        </div>
      )}

      {/* Invoice list */}
      {invoices.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-3 py-2 text-left">
                  Nr. Factura
                </th>
                <th className="border border-gray-300 px-3 py-2 text-left">
                  Data
                </th>
                <th className="border border-gray-300 px-3 py-2 text-left">
                  Client
                </th>
                <th className="border border-gray-300 px-3 py-2 text-right">
                  Total cu TVA
                </th>
                <th className="border border-gray-300 px-3 py-2 text-center">
                  PDF
                </th>
                <th className="border border-gray-300 px-3 py-2 text-center">
                  UBL
                </th>
                <th className="border border-gray-300 px-3 py-2 text-center">
                  Detalii
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const client = getClientForInvoice(inv);
                const isSelected = selectedInv?.id === inv.id;
                const snap =
                  inv.raw_snapshot &&
                  typeof inv.raw_snapshot === "object"
                    ? inv.raw_snapshot
                    : inv.raw_snapshot
                    ? JSON.parse(inv.raw_snapshot)
                    : {};
                const lines =
                  snap.lines || snap.documentPositions || [];
                const headerRows = buildHeaderRows(company, snap, client);

                return (
                  <React.Fragment key={inv.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="border border-gray-300 px-3 py-2 font-mono">
                        {inv.invoice_code || "-"}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {inv.document_date || "-"}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {client?.nume ||
                          inv.client_name ||
                          inv.external_client_id ||
                          "-"}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right">
                        {inv.total_with_vat != null
                          ? Number(inv.total_with_vat).toFixed(2)
                          : "-"}{" "}
                        RON
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-center">
                        <button
                          onClick={() => handlePDF(inv)}
                          title="Descarca PDF"
                          className="p-1 hover:bg-blue-50 rounded"
                        >
                          <Download className="w-4 h-4 text-blue-600" />
                        </button>
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-center">
                        <button
                          onClick={() => handleUBL(inv)}
                          title="Descarca UBL XML"
                          className="p-1 hover:bg-green-50 rounded"
                        >
                          <FileCode className="w-4 h-4 text-green-600" />
                        </button>
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-center">
                        <button
                          onClick={() => toggleDetail(inv)}
                          title={isSelected ? "Inchide detalii" : "Detalii"}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          {isSelected ? (
                            <X className="w-4 h-4 text-gray-600" />
                          ) : (
                            <FileText className="w-4 h-4 text-gray-600" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Inline detail row */}
                    {isSelected && (
                      <tr>
                        <td
                          colSpan={7}
                          className="border border-gray-300 bg-gray-50 px-4 py-4"
                        >
                          {/* Two-column header: seller left, buyer right — synchronized row by row */}
                          <table className="w-full text-sm mb-4">
                            <tbody>
                              {headerRows.map((row, i) => (
                                <tr key={i}>
                                  <td
                                    className="w-1/2 py-0.5 pr-4 align-top"
                                    style={{
                                      fontWeight: row.bold ? "600" : "normal",
                                    }}
                                  >
                                    {row.seller}
                                  </td>
                                  <td
                                    className="w-1/2 py-0.5 pl-4 align-top"
                                    style={{
                                      fontWeight: row.bold ? "600" : "normal",
                                    }}
                                  >
                                    {row.buyer}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Products table */}
                          {lines.length > 0 ? (
                            <table className="w-full text-sm border-collapse border border-gray-300 mb-3">
                              <thead>
                                <tr className="bg-gray-200">
                                  <th className="border border-gray-300 px-2 py-1 text-right">
                                    Nr.
                                  </th>
                                  <th className="border border-gray-300 px-2 py-1 text-left">
                                    Cod
                                  </th>
                                  <th className="border border-gray-300 px-2 py-1 text-left">
                                    Descriere
                                  </th>
                                  <th className="border border-gray-300 px-2 py-1 text-center">
                                    UM
                                  </th>
                                  <th className="border border-gray-300 px-2 py-1 text-right">
                                    Cant.
                                  </th>
                                  <th className="border border-gray-300 px-2 py-1 text-right">
                                    Pret
                                  </th>
                                  <th className="border border-gray-300 px-2 py-1 text-right">
                                    Total
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((item, idx) => (
                                  <tr key={idx} className="hover:bg-white">
                                    <td className="border border-gray-300 px-2 py-1 text-right">
                                      {item.lineId ?? idx + 1}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1">
                                      {item.barcode || "-"}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1">
                                      {item.description ||
                                        item.descriere ||
                                        "-"}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1 text-center">
                                      {item.unit || item.um || "-"}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1 text-right">
                                      {item.unitCount || item.quantity || "0"}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1 text-right">
                                      {Number(item.price || 0).toFixed(2)}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1 text-right">
                                      {Number(
                                        item.total ||
                                          parseFloat(
                                            item.unitCount || item.quantity || 0
                                          ) * parseFloat(item.price || 0)
                                      ).toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-sm text-gray-400 mb-3">
                              Nu exista produse in snapshot.
                            </p>
                          )}

                          {/* Totals */}
                          <div className="text-sm text-right space-y-0.5">
                            <div>
                              Total fara TVA:{" "}
                              {Number(inv.total || 0).toFixed(2)} RON
                            </div>
                            <div>
                              TVA: {Number(inv.total_vat || 0).toFixed(2)} RON
                            </div>
                            <div className="font-bold">
                              TOTAL:{" "}
                              {Number(inv.total_with_vat || 0).toFixed(2)} RON
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InvoicesV2Screen;
