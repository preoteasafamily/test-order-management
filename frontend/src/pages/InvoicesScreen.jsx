import React, { useState, useEffect } from "react";
import { FileText, FileCode, Download, RefreshCw, Settings, Save, CheckSquare, Square, List, X, Plus, Trash2, Edit2 } from "lucide-react";
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
// Header: two-column layout – Seller (left, no title) | Buyer (right, no title)
// Right column is omitted gracefully when buyer data is absent. No branding on invoice.
// Table columns: Nr. crt. | Cod (EAN/barcode, BT-157) | Descriere | UM | Cant. | Preț | TVA% | Total
// Mapping: lineId -> Nr. crt. (BT-126), barcode -> Cod (BT-157),
//          description -> Denumire (BT-153), unit -> UM (BT-130), unitCount -> Cant. (BT-129),
//          price -> Preț (BT-146), vat -> TVA% (BT-152), total -> Total (BT-131)
const generateInvoicePDF = (inv, company, client) => {
  const doc = new jsPDF({ format: "a4", unit: "pt" });
  const snapshot =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? JSON.parse(inv.raw_snapshot)
      : {};

  // Resolve client fields: prefer snapshot (captured at invoice time), then live client object
  const cName         = snapshot.clientName         || client?.nume         || inv.client_name || inv.external_client_id || "-";
  const cCIF          = snapshot.clientCIF          || client?.cif          || null;
  const cNrRegCom     = snapshot.clientNrRegCom     || client?.nrRegCom     || null;
  const cStrada       = snapshot.clientStrada       || client?.strada       || null;
  const cLocalitate   = snapshot.clientLocalitate   || client?.localitate   || null;
  const cJudet        = snapshot.clientJudet        || client?.judet        || null;
  const cTara         = snapshot.clientTara         || client?.buyer_country || "RO";
  const dName         = snapshot.clientDeliveryName    || client?.delivery_name    || null;
  const dGLN          = snapshot.clientDeliveryGLN     || client?.delivery_gln     || null;
  const dAddress      = snapshot.clientDeliveryAddress || client?.delivery_address || null;
  const dCity         = snapshot.clientDeliveryCity    || client?.delivery_city    || null;
  const dRegion       = snapshot.clientDeliveryRegion  || client?.delivery_region  || null;
  const dCountry      = snapshot.clientDeliveryCountry || client?.delivery_country || "RO";

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 40;

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
  doc.setFont("helvetica", "normal");
  doc.text(`Data: ${inv.document_date || "-"}`, pageWidth / 2, y, { align: "center" });
  y += 18;

  // Two-column header: Seller (Vânzător) left | Buyer (Cumpărător) right-aligned
  // Seller is left-aligned; Buyer text is right-aligned to the right margin.
  // If buyer data is missing the right column is omitted and layout is unaffected.
  const colLeft       = 40;
  const rightMargin   = pageWidth - 40;
  const colRight      = Math.floor(pageWidth / 2) + 10;
  const leftColWidth  = colRight - colLeft - 10;
  const rightColWidth = rightMargin - colRight;
  let leftY = y;
  let rightY = y;

  // LEFT COLUMN – Seller (Vânzător); no section title per invoice requirements
  if (company) {
    const sellerName    = company.bt_27_seller_name;
    const sellerCIF     = company.bt_31_32_seller_vat_identifier || company.bt_29_seller_identifier;
    const sellerRegCom  = company.bt_30_seller_legal_registration;
    const sellerStreet  = company.bt_35_seller_address;
    const sellerCityReg = [company.bt_37_seller_city, company.bt_39_seller_region].filter(Boolean).join(", ");
    const sellerPhone   = company.bt_42_seller_phone;
    const sellerEmail   = company.bt_43_seller_email;
    const sellerBanca   = company.bt_85_payee_bank_name;
    const sellerIBAN    = company.bt_84_payee_iban;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    if (sellerName)    { const ln = doc.splitTextToSize(sellerName, leftColWidth); doc.text(ln, colLeft, leftY); leftY += ln.length * 12; }
    doc.setFont("helvetica", "normal");
    if (sellerCIF)     { doc.text(`CIF: ${sellerCIF}`, colLeft, leftY); leftY += 12; }
    if (sellerRegCom)  { doc.text(`Reg. Com.: ${sellerRegCom}`, colLeft, leftY); leftY += 12; }
    if (sellerStreet)  { const ln = doc.splitTextToSize(sellerStreet, leftColWidth); doc.text(ln, colLeft, leftY); leftY += ln.length * 12; }
    if (sellerCityReg) { doc.text(sellerCityReg, colLeft, leftY); leftY += 12; }
    if (sellerPhone)   { doc.text(`Tel: ${sellerPhone}`, colLeft, leftY); leftY += 12; }
    if (sellerEmail)   { doc.text(`Email: ${sellerEmail}`, colLeft, leftY); leftY += 12; }
    if (sellerBanca)   { doc.text(`Banca: ${sellerBanca}`, colLeft, leftY); leftY += 12; }
    if (sellerIBAN)    { const ln = doc.splitTextToSize(`IBAN: ${sellerIBAN}`, leftColWidth); doc.text(ln, colLeft, leftY); leftY += ln.length * 12; }
  }

  // RIGHT COLUMN – Buyer (Cumpărător); right-aligned; omitted gracefully if no buyer data; no section title
  const hasBuyerData = cName !== "-" || cCIF || cNrRegCom || cStrada || cLocalitate;
  if (hasBuyerData) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const nameLines = doc.splitTextToSize(cName, rightColWidth);
    doc.text(nameLines, rightMargin, rightY, { align: "right" }); rightY += nameLines.length * 12;
    doc.setFont("helvetica", "normal");
    if (cCIF)    { doc.text(`CIF: ${cCIF}`, rightMargin, rightY, { align: "right" }); rightY += 12; }
    if (cNrRegCom) { doc.text(`Reg. Com.: ${cNrRegCom}`, rightMargin, rightY, { align: "right" }); rightY += 12; }
    if (cStrada) {
      const ln = doc.splitTextToSize(cStrada, rightColWidth);
      doc.text(ln, rightMargin, rightY, { align: "right" }); rightY += ln.length * 12;
    }
    if (cLocalitate || cJudet) {
      doc.text([cLocalitate, cJudet].filter(Boolean).join(", "), rightMargin, rightY, { align: "right" });
      rightY += 12;
    }
    if (cTara && cTara !== "RO") { doc.text(`Tara: ${cTara}`, rightMargin, rightY, { align: "right" }); rightY += 12; }
  }

  y = Math.max(leftY, rightY) + 14;

  // Delivery address section (shown only when at least one delivery field is populated)
  const hasDelivery = dName || dGLN || dAddress || dCity || dRegion;
  if (hasDelivery) {
    doc.setFont("helvetica", "bold");
    doc.text("Livrare:", 40, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    if (dName)    { doc.text(`Denumire Loc Livrare: ${dName}`, 40, y); y += 13; }
    if (dGLN)     { doc.text(`GLN Loc Livrare: ${dGLN}`, 40, y); y += 13; }
    if (dAddress) { doc.text(`Adresă Livrare: ${dAddress}`, 40, y); y += 13; }
    if (dCity)    { doc.text(`Localitate Livrare: ${dCity}`, 40, y); y += 13; }
    if (dRegion)  { doc.text(`Județ/Regiune Livrare: ${dRegion}`, 40, y); y += 13; }
    y += 6;
  }

  // Items table – columns: Nr. crt. | Cod | Descriere | UM | Cant. | Preț | TVA% | Total
  const lines = snapshot.lines || snapshot.documentPositions || [];
  if (lines.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Nr.", "Cod", "Descriere", "UM", "Cant.", "Preț", "TVA%", "Total"]],
      body: lines.map((item, idx) => [
        item.lineId != null ? item.lineId : idx + 1,
        item.barcode || "-",
        item.description || item.descriere || "-",
        item.unit || item.um || "buc",
        item.unitCount || item.quantity || "0",
        Number(item.price || 0).toFixed(2),
        item.vat != null ? `${item.vat}%` : "-",
        Number(item.total || (parseFloat(item.unitCount || item.quantity || 0) * parseFloat(item.price || 0))).toFixed(2),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [245, 158, 11] },
      columnStyles: {
        0: { cellWidth: 25 },   // Nr.
        1: { cellWidth: 70 },   // Cod
        2: { cellWidth: "auto" }, // Descriere – flexible
        3: { cellWidth: 28 },   // UM
        4: { cellWidth: 35 },   // Cant.
        5: { cellWidth: 48 },   // Preț
        6: { cellWidth: 35 },   // TVA%
        7: { cellWidth: 50 },   // Total
      },
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

// Generate a UBL 2.1 XML string for a single invoice
// Structure: Invoice > AccountingSupplierParty, AccountingCustomerParty,
//            Delivery (BuyerDelivery with address + GLN), InvoiceLine[]
// Line columns: ID (Nr. crt. BT-126), StandardItemIdentification (Cod/EAN, BT-157),
//               SellersItemIdentification (codArticolFurnizor, BT-155, supplementary),
//               Item.Name (Denumire, BT-153), InvoicedQuantity (UM/Cant., BT-129),
//               Price.PriceAmount (Preț, BT-146), LineExtensionAmount (Total, BT-131)
// The barcode/EAN (item.barcode → BT-157) is the primary Cod identifier on each line,
// matching the "Cod" column in the PDF invoice table.
const generateInvoiceUBL = (inv, company, client) => {
  const snapshot =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? JSON.parse(inv.raw_snapshot)
      : {};

  const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const cName       = snapshot.clientName         || client?.nume         || inv.client_name || inv.external_client_id || "";
  const cCIF        = snapshot.clientCIF          || client?.cif          || "";
  const cNrRegCom   = snapshot.clientNrRegCom     || client?.nrRegCom     || "";
  const cStrada     = snapshot.clientStrada       || client?.strada       || "";
  const cCity       = snapshot.clientLocalitate   || client?.localitate   || "";
  const cRegion     = snapshot.clientJudet        || client?.judet        || "";
  const cCountry    = snapshot.clientTara         || client?.buyer_country || "RO";
  const dName       = snapshot.clientDeliveryName    || client?.delivery_name    || "";
  const dGLN        = snapshot.clientDeliveryGLN     || client?.delivery_gln     || "";
  const dAddress    = snapshot.clientDeliveryAddress || client?.delivery_address || "";
  const dCity       = snapshot.clientDeliveryCity    || client?.delivery_city    || "";
  const dRegion     = snapshot.clientDeliveryRegion  || client?.delivery_region  || "";
  const dCountry    = snapshot.clientDeliveryCountry || client?.delivery_country || "RO";

  const hasDelivery = dName || dGLN || dAddress || dCity || dRegion;

  const lines = snapshot.lines || snapshot.documentPositions || [];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${esc(inv.invoice_code || inv.id)}</cbc:ID>
  <cbc:IssueDate>${esc(inv.document_date || "")}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>\n`;

  // Seller (AccountingSupplierParty)
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

  // Buyer (AccountingCustomerParty)
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

  // Delivery / BuyerDelivery – shown only when at least one delivery field is populated
  if (hasDelivery) {
    xml += `  <cac:Delivery>
    <cac:DeliveryLocation>\n`;
    if (dGLN) {
      xml += `      <cbc:ID schemeID="GLN">${esc(dGLN)}</cbc:ID>\n`;
    }
    if (dName) {
      xml += `      <cbc:Name>${esc(dName)}</cbc:Name>\n`;
    }
    xml += `      <cac:Address>
        <cbc:StreetName>${esc(dAddress)}</cbc:StreetName>
        <cbc:CityName>${esc(dCity)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(dRegion)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(dCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:Address>
    </cac:DeliveryLocation>
  </cac:Delivery>\n`;
  }

  // Invoice lines – Nr. crt. | Cod | Denumire | UM | Cant. | Preț | Total
  lines.forEach((item, idx) => {
    const lineId = item.lineId != null ? item.lineId : idx + 1;
    const barcode = item.barcode || "";
    const productCode = item.productCode || "";
    const desc = item.description || item.descriere || "";
    const um = item.unit || item.um || "C62"; // C62 = unit (UN/CEFACT)
    const qty = Number(item.unitCount || item.quantity || 0).toFixed(3);
    const price = Number(item.price || 0).toFixed(4);
    const total = Number(item.total || (parseFloat(qty) * parseFloat(price))).toFixed(2);
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

const InvoicesScreen = ({ API_URL, orders, clients, products = [], showMessage, currentUser }) => {
  const [localInvoices, setLocalInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Billing settings state
  const [settings, setSettings] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [editSettings, setEditSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Invoice lines state
  const [linesInvoice, setLinesInvoice] = useState(null); // invoice whose lines are shown
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [editingLine, setEditingLine] = useState(null); // null = not editing, {} = new, line obj = edit
  const [lineForm, setLineForm] = useState({});

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
      const { client } = getOrderInfo(inv.order_id);
      const doc = generateInvoicePDF(inv, company, client);
      const filename = `factura-${stripDiacritics(inv.invoice_code || inv.id)}.pdf`;
      doc.save(filename);
    } catch (err) {
      showMessage(`Eroare la generarea PDF: ${err.message}`, "error");
    }
  };

  const handleDownloadLocalUBL = (inv) => {
    try {
      const { client } = getOrderInfo(inv.order_id);
      const xml = generateInvoiceUBL(inv, company, client);
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `factura-${stripDiacritics(inv.invoice_code || inv.id)}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(`Eroare la generarea UBL: ${err.message}`, "error");
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
        const { order, client } = getOrderInfo(inv.order_id);
        const doc = generateInvoicePDF(inv, company, client);
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

  // ---- Invoice Lines Management ----

  const openLines = async (inv) => {
    setLinesInvoice(inv);
    setEditingLine(null);
    setLineForm({});
    setLinesLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/local-invoices/${inv.id}/lines`);
      if (response.ok) {
        setLines(await response.json());
      } else {
        showMessage("Eroare la încărcarea liniilor", "error");
        setLines([]);
      }
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
      setLines([]);
    } finally {
      setLinesLoading(false);
    }
  };

  const closeLines = () => {
    setLinesInvoice(null);
    setLines([]);
    setEditingLine(null);
    setLineForm({});
  };

  // When a product is selected in the line form, auto-populate BT fields
  const handleLineProductSelect = (productId) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setLineForm((f) => ({ ...f, productId: "" }));
      return;
    }
    const vatRate = product.cotaTVA != null ? product.cotaTVA : "";
    const vatCategoryCode = vatRate === 19 ? "S" : (vatRate !== "" ? "" : "");
    const prices = product.prices && typeof product.prices === "object" ? product.prices : {};
    const firstPrice = Object.values(prices)[0] || 0;
    setLineForm((f) => ({
      ...f,
      productId,
      bt_153_item_name: product.descriere || "",
      bt_129_unit_code: product.um || "",
      bt_152_line_vat_rate: vatRate !== "" ? String(vatRate) : "",
      bt_151_line_vat_category_code: vatCategoryCode,
      bt_155_seller_item_id: product.codArticolFurnizor || "",
      bt_157_item_barcode: product.codBare || "",
      bt_146_item_net_price: f.bt_146_item_net_price || (firstPrice ? String(firstPrice) : ""),
    }));
  };

  // Recalculate net amount when qty or price changes
  const handleLineFormChange = (field, value) => {
    setLineForm((f) => {
      const updated = { ...f, [field]: value };
      if (field === "bt_129_invoiced_quantity" || field === "bt_146_item_net_price") {
        const qty = parseFloat(updated.bt_129_invoiced_quantity) || 0;
        const price = parseFloat(updated.bt_146_item_net_price) || 0;
        updated.bt_131_line_net_amount = String((qty * price).toFixed(2));
      }
      return updated;
    });
  };

  const startAddLine = () => {
    setEditingLine("new");
    setLineForm({
      productId: "",
      bt_153_item_name: "",
      bt_129_invoiced_quantity: "1",
      bt_129_unit_code: "",
      bt_146_item_net_price: "",
      bt_131_line_net_amount: "",
      bt_152_line_vat_rate: "",
      bt_151_line_vat_category_code: "",
      bt_155_seller_item_id: "",
      bt_157_item_barcode: "",
    });
  };

  const startEditLine = (line) => {
    setEditingLine(line);
    setLineForm({
      productId: "",
      bt_153_item_name: line.bt_153_item_name || "",
      bt_129_invoiced_quantity: line.bt_129_invoiced_quantity != null ? String(line.bt_129_invoiced_quantity) : "1",
      bt_129_unit_code: line.bt_129_unit_code || "",
      bt_146_item_net_price: line.bt_146_item_net_price != null ? String(line.bt_146_item_net_price) : "",
      bt_131_line_net_amount: line.bt_131_line_net_amount != null ? String(line.bt_131_line_net_amount) : "",
      bt_152_line_vat_rate: line.bt_152_line_vat_rate != null ? String(line.bt_152_line_vat_rate) : "",
      bt_151_line_vat_category_code: line.bt_151_line_vat_category_code || "",
      bt_155_seller_item_id: line.bt_155_seller_item_id || "",
      bt_157_item_barcode: line.bt_157_item_barcode || "",
    });
  };

  const cancelEditLine = () => {
    setEditingLine(null);
    setLineForm({});
  };

  const saveLine = async () => {
    if (!linesInvoice) return;
    const payload = {
      productId: lineForm.productId || undefined,
      bt_153_item_name: lineForm.bt_153_item_name || null,
      bt_129_invoiced_quantity: parseFloat(lineForm.bt_129_invoiced_quantity) || 0,
      bt_129_unit_code: lineForm.bt_129_unit_code || null,
      bt_146_item_net_price: parseFloat(lineForm.bt_146_item_net_price) || 0,
      bt_131_line_net_amount: parseFloat(lineForm.bt_131_line_net_amount) || 0,
      bt_152_line_vat_rate: lineForm.bt_152_line_vat_rate !== "" ? parseFloat(lineForm.bt_152_line_vat_rate) : null,
      bt_151_line_vat_category_code: lineForm.bt_151_line_vat_category_code || null,
      bt_155_seller_item_id: lineForm.bt_155_seller_item_id || null,
      bt_157_item_barcode: lineForm.bt_157_item_barcode || null,
    };

    try {
      let response;
      if (editingLine === "new") {
        response = await fetch(`${API_URL}/api/billing/local-invoices/${linesInvoice.id}/lines`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch(`${API_URL}/api/billing/local-invoices/${linesInvoice.id}/lines/${editingLine.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (response.ok) {
        showMessage("Linie salvată cu succes!");
        setEditingLine(null);
        setLineForm({});
        await openLines(linesInvoice);
      } else {
        const err = await response.json();
        showMessage(err.error || "Eroare la salvarea liniei", "error");
      }
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    }
  };

  const deleteLine = async (line) => {
    if (!linesInvoice) return;
    if (!window.confirm("Ștergeți linia?")) return;
    try {
      const response = await fetch(
        `${API_URL}/api/billing/local-invoices/${linesInvoice.id}/lines/${line.id}`,
        { method: "DELETE" }
      );
      if (response.ok) {
        showMessage("Linie ștearsă!");
        await openLines(linesInvoice);
      } else {
        const err = await response.json();
        showMessage(err.error || "Eroare la ștergere", "error");
      }
    } catch (err) {
      showMessage(`Eroare: ${err.message}`, "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Invoice Lines Modal */}
      {linesInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-start justify-center pt-10 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-800">
                Linii Factură – {linesInvoice.invoice_code || linesInvoice.id}
              </h3>
              <button onClick={closeLines} className="text-gray-500 hover:text-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Line edit / add form */}
              {editingLine !== null && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                  <h4 className="font-semibold text-gray-700">
                    {editingLine === "new" ? "Adăugare linie nouă" : "Editare linie"}
                  </h4>

                  {/* Product selector */}
                  {products.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Selectează produs (auto-populare câmpuri)
                      </label>
                      <select
                        value={lineForm.productId || ""}
                        onChange={(e) => handleLineProductSelect(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        <option value="">-- Selectați produs --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.codArticolFurnizor} – {p.descriere}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-153 Denumire produs
                      </label>
                      <input
                        type="text"
                        value={lineForm.bt_153_item_name || ""}
                        onChange={(e) => handleLineFormChange("bt_153_item_name", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-129 Cantitate
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        value={lineForm.bt_129_invoiced_quantity || ""}
                        onChange={(e) => handleLineFormChange("bt_129_invoiced_quantity", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-129 UM
                      </label>
                      <input
                        type="text"
                        value={lineForm.bt_129_unit_code || ""}
                        onChange={(e) => handleLineFormChange("bt_129_unit_code", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-146 Preț net unitar
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={lineForm.bt_146_item_net_price || ""}
                        onChange={(e) => handleLineFormChange("bt_146_item_net_price", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-131 Valoare netă linie
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={lineForm.bt_131_line_net_amount || ""}
                        onChange={(e) => handleLineFormChange("bt_131_line_net_amount", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-152 Cotă TVA (%)
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={lineForm.bt_152_line_vat_rate || ""}
                        onChange={(e) => handleLineFormChange("bt_152_line_vat_rate", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-151 Categorie TVA
                      </label>
                      <input
                        type="text"
                        value={lineForm.bt_151_line_vat_category_code || ""}
                        onChange={(e) => handleLineFormChange("bt_151_line_vat_category_code", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        placeholder="S"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-155 Cod furnizor
                      </label>
                      <input
                        type="text"
                        value={lineForm.bt_155_seller_item_id || ""}
                        onChange={(e) => handleLineFormChange("bt_155_seller_item_id", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        BT-157 Cod bare
                      </label>
                      <input
                        type="text"
                        value={lineForm.bt_157_item_barcode || ""}
                        onChange={(e) => handleLineFormChange("bt_157_item_barcode", e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveLine}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm transition"
                    >
                      <Save className="w-4 h-4" />
                      Salvează
                    </button>
                    <button
                      onClick={cancelEditLine}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm transition"
                    >
                      Anulează
                    </button>
                  </div>
                </div>
              )}

              {/* Lines table */}
              {linesLoading ? (
                <p className="text-sm text-gray-500 text-center py-4">Se încarcă...</p>
              ) : lines.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  Nu există linii. Liniile se generează automat la salvarea comenzii.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">#</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">BT-153 Denumire</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">BT-129 Cant.</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">UM</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-gray-600 border border-gray-200">BT-146 Preț net</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-gray-600 border border-gray-200">BT-131 Val. netă</th>
                        <th className="px-2 py-1.5 text-center font-semibold text-gray-600 border border-gray-200">BT-152 TVA%</th>
                        <th className="px-2 py-1.5 text-center font-semibold text-gray-600 border border-gray-200">BT-151</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">BT-155 Cod furn.</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">BT-157 Bare</th>
                        <th className="px-2 py-1.5 text-center font-semibold text-gray-600 border border-gray-200">Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 border border-gray-200">{line.bt_126_line_id}</td>
                          <td className="px-2 py-1.5 border border-gray-200">{line.bt_153_item_name || "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200">{line.bt_129_invoiced_quantity ?? "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200">{line.bt_129_unit_code || "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200 text-right">{line.bt_146_item_net_price != null ? Number(line.bt_146_item_net_price).toFixed(4) : "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200 text-right font-medium">{line.bt_131_line_net_amount != null ? Number(line.bt_131_line_net_amount).toFixed(2) : "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200 text-center">{line.bt_152_line_vat_rate != null ? `${line.bt_152_line_vat_rate}%` : "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200 text-center">{line.bt_151_line_vat_category_code || "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200">{line.bt_155_seller_item_id || "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200">{line.bt_157_item_barcode || "-"}</td>
                          <td className="px-2 py-1.5 border border-gray-200 text-center">
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => startEditLine(line)}
                                className="p-1 hover:bg-blue-100 rounded text-blue-600"
                                title="Editează"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteLine(line)}
                                className="p-1 hover:bg-red-100 rounded text-red-600"
                                title="Șterge"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button
                  onClick={startAddLine}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm transition"
                >
                  <Plus className="w-4 h-4" />
                  Adaugă linie
                </button>
                <button
                  onClick={closeLines}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm transition"
                >
                  Închide
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


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
                    Linii BT
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">
                    PDF
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">
                    UBL
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
                          onClick={() => openLines(inv)}
                          className="p-1.5 hover:bg-amber-100 rounded text-amber-600 transition"
                          title="Linii factură (câmpuri BT)"
                        >
                          <List className="w-4 h-4" />
                        </button>
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
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDownloadLocalUBL(inv)}
                          className="p-1.5 hover:bg-green-100 rounded text-green-600 transition"
                          title="Descarcă UBL XML"
                        >
                          <FileCode className="w-4 h-4" />
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
