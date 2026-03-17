import React, { useState, useEffect, useMemo } from "react";
import { FileText, FileCode, Download, RefreshCw, X, List, Save, Plus, Trash2, Edit2, CheckSquare, Square, Printer } from "lucide-react";
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

// Draw one invoice onto the current page of an existing jsPDF document.
// The caller is responsible for calling doc.addPage() before this when needed.
const drawInvoiceOnDoc = (doc, inv, company, client, agent, order) => {
  const snap =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? JSON.parse(inv.raw_snapshot)
      : {};

  // Resolve agent fields: prefer snapshot (captured at invoice time), then live agent object
  const agentName         = snap.agentName         || agent?.name             || null;
  const agentCiSerie      = snap.agentCiSerie      || agent?.ci_serie         || null;
  const agentCiNumar      = snap.agentCiNumar      || agent?.ci_numar         || null;
  const agentEliberatDe   = snap.agentEliberatDe   || agent?.ci_eliberat_de   || null;
  const agentMijlocTransp = snap.agentMijlocTransp || agent?.mijloc_transport || null;

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

  // Show order number if present
  const nrComandaSnap = snap.nrComanda || order?.nrComanda || null;
  if (nrComandaSnap) {
    doc.setFontSize(9).setFont("helvetica", "normal");
    doc.text(`Nr. comanda: ${nrComandaSnap}`, pageWidth / 2, y, { align: "center" });
    y += 13;
  }

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
      styles: { fontSize: 8, textColor: 0 },
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
    y = doc.lastAutoTable.finalY + 14;
  }

  // Two-column section: "Date privind expediția" (left) alongside totals (right)
  const sectionY = y;
  const expX = 40;

  // LEFT column – expedition / agent data
  let expY = sectionY;
  const hasAgentData = agentName || agentCiSerie || agentCiNumar || agentEliberatDe || agentMijlocTransp;
  if (hasAgentData) {
    doc.setFontSize(9).setFont("helvetica", "bold");
    doc.text("Date privind expeditia:", expX, expY);
    expY += 12;
    doc.setFont("helvetica", "normal");
    // Compact row 1: Delegat + Mijloc transport on the same line
    const row1Parts = [];
    if (agentName) row1Parts.push(`Delegat: ${agentName}`);
    if (agentMijlocTransp) row1Parts.push(`Mijloc transport: ${agentMijlocTransp}`);
    if (row1Parts.length > 0) { doc.text(row1Parts.join("   "), expX, expY); expY += 12; }
    // Compact row 2: C.I.: serie nr eliberat de emitent – all on one line
    const ciParts = [agentCiSerie, agentCiNumar].filter(Boolean).join(" ");
    const ciLine = [ciParts ? `C.I.: ${ciParts}` : null, agentEliberatDe ? `eliberat de ${agentEliberatDe}` : null].filter(Boolean).join(" ");
    if (ciLine) { doc.text(ciLine, expX, expY); expY += 12; }
  }

  // RIGHT column – totals
  let totY = sectionY;
  doc.setFontSize(9).setFont("helvetica", "normal");
  doc.text(
    `Total fara TVA: ${Number(inv.total || 0).toFixed(2)} RON`,
    pageWidth - 40,
    totY,
    { align: "right" }
  );
  totY += 12;
  doc.text(
    `TVA: ${Number(inv.total_vat || 0).toFixed(2)} RON`,
    pageWidth - 40,
    totY,
    { align: "right" }
  );
  totY += 12;
  doc.setFont("helvetica", "bold");
  doc.text(
    `TOTAL: ${Number(inv.total_with_vat || 0).toFixed(2)} RON`,
    pageWidth - 40,
    totY,
    { align: "right" }
  );
  totY += 12; // eslint-disable-line no-unused-vars
};

// Generate PDF: two-column header synchronized row by row, no titles/separators
const generatePDF = (inv, company, client, agent, order) => {
  const doc = new jsPDF({ format: "a4", unit: "pt" });
  drawInvoiceOnDoc(doc, inv, company, client, agent, order);
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
  const dName    = snap.clientDeliveryName    || client?.delivery_name    || "";
  const dGLN     = snap.clientDeliveryGLN     || client?.delivery_gln     || "";
  const dAddress = snap.clientDeliveryAddress || client?.delivery_address || "";
  const dCity    = snap.clientDeliveryCity    || client?.delivery_city    || "";
  const dRegion  = snap.clientDeliveryRegion  || client?.delivery_region  || "";
  const dCountry = snap.clientDeliveryCountry || client?.delivery_country || "RO";

  const lines = snap.lines || snap.documentPositions || [];

  const issueDate = esc(inv.document_date || "");
  const dueDate   = esc(inv.due_date || inv.document_date || "");

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${esc(inv.invoice_code || inv.id)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>\n`;

  // Order reference (BT-13) – purchase order number from buyer
  const nrComandaUBL = snap.nrComanda || null;
  if (nrComandaUBL) {
    xml += `  <cac:OrderReference>
    <cbc:ID>${esc(nrComandaUBL)}</cbc:ID>
  </cac:OrderReference>\n`;
  }

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
        <cbc:CompanyLegalForm>${esc(company.bt_30_seller_legal_registration)}</cbc:CompanyLegalForm>
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

  // Delivery – shown only when at least one delivery field is populated
  const hasDelivery = dAddress || dCity || dName || dGLN;
  if (hasDelivery) {
    xml += `  <cac:Delivery>
    <cac:DeliveryLocation>\n`;
    if (dGLN) xml += `      <cbc:ID schemeID="GLN">${esc(dGLN)}</cbc:ID>\n`;
    if (dName) xml += `      <cbc:Name>${esc(dName)}</cbc:Name>\n`;
    xml += `      <cac:Address>
        <cbc:StreetName>${esc(dAddress)}</cbc:StreetName>
        <cbc:CityName>${esc(dCity)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(dRegion)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(dCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:Address>
    </cac:DeliveryLocation>
  </cac:Delivery>\n`;
  }

  // PaymentMeans – IBAN / bank transfer (BT-81 code 31 = credit transfer)
  if (company && company.bt_84_payee_iban) {
    const pmCode = company.bt_81_payment_means_code || "31";
    xml += `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(pmCode)}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(company.bt_84_payee_iban)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>\n`;
  }

  // TaxTotal – one TaxSubtotal per distinct VAT rate (CIUS-RO mandatory)
  const vatGroups = {};
  lines.forEach((item) => {
    const rate = item.vat != null ? Number(item.vat) : 19;
    const lineTotal = Number(item.total || (Number(item.unitCount || item.quantity || 0) * Number(item.price || 0)));
    if (!vatGroups[rate]) vatGroups[rate] = 0;
    vatGroups[rate] += lineTotal;
  });
  const totalTaxAmount = Object.entries(vatGroups).reduce((sum, [rate, taxable]) => {
    return sum + Math.round(taxable * Number(rate) / 100 * 100) / 100;
  }, 0);
  xml += `  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">${(inv.total_vat != null ? Number(inv.total_vat) : totalTaxAmount).toFixed(2)}</cbc:TaxAmount>\n`;
  Object.entries(vatGroups).forEach(([rate, taxableAmt]) => {
    const rateNum = Number(rate);
    const taxAmt = Math.round(taxableAmt * rateNum / 100 * 100) / 100;
    const catCode = rateNum > 0 ? "S" : "Z";
    xml += `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">${taxableAmt.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">${taxAmt.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${catCode}</cbc:ID>
        <cbc:Percent>${rateNum.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>\n`;
  });
  xml += `  </cac:TaxTotal>\n`;

  // LegalMonetaryTotal (CIUS-RO mandatory)
  const lineExtTotal = Object.values(vatGroups).reduce((s, v) => s + v, 0);
  const taxExcl = inv.total != null ? Number(inv.total) : lineExtTotal;
  const taxIncl = inv.total_with_vat != null ? Number(inv.total_with_vat) : taxExcl + (inv.total_vat != null ? Number(inv.total_vat) : totalTaxAmount);
  xml += `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${taxExcl.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${taxExcl.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${taxIncl.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">${taxIncl.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>\n`;

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
    const vatCatCode = Number(vatRate) > 0 ? "S" : "Z";

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
        <cbc:ID>${vatCatCode}</cbc:ID>
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

const InvoicesV2Screen = ({ API_URL, orders, clients, agents, products = [], showMessage }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState(null);
  const [settings, setSettings] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);

  // Batch selection & PDF state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchProgress, setBatchProgress] = useState(null); // { current, total } | null
  const [dateFilter, setDateFilter] = useState("");

  // Invoice lines state
  const [linesInvoice, setLinesInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [lineForm, setLineForm] = useState({});

  // Pre-compute unique dates with invoice counts for the date selector (memoized for performance)
  const availableDates = useMemo(() => {
    const counts = {};
    invoices.forEach((inv) => {
      if (inv.document_date) {
        counts[inv.document_date] = (counts[inv.document_date] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, count]) => ({ date, count }));
  }, [invoices]);

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
    const client = order && clients
      ? clients.find((c) => c.id === order.clientId) || null
      : null;
    const agent = client && agents
      ? agents.find((a) => a.id === client.agentId) || null
      : null;
    return { client, agent, order };
  };

  const handlePDF = (inv) => {
    try {
      const { client, agent, order } = getClientForInvoice(inv);
      generatePDF(inv, company, client, agent, order).save(
        `factura-${stripDiacritics(inv.invoice_code || inv.id)}.pdf`
      );
    } catch (err) {
      showMessage(`Eroare PDF: ${err.message}`, "error");
    }
  };

  const handleUBL = (inv) => {
    try {
      const { client } = getClientForInvoice(inv);
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

  // ---- Batch selection helpers ----

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visible = dateFilter
      ? invoices.filter((inv) => inv.document_date === dateFilter)
      : invoices;
    if (visible.every((inv) => selectedIds.has(inv.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visible.forEach((inv) => next.delete(inv.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visible.forEach((inv) => next.add(inv.id));
        return next;
      });
    }
  };

  const selectByDate = (date) => {
    setDateFilter(date);
    const forDate = invoices.filter((inv) => inv.document_date === date);
    setSelectedIds(new Set(forDate.map((inv) => inv.id)));
  };

  // Batch PDF: generate a single multi-page PDF for all selected invoices.
  // Processing is done in chunks to keep the UI responsive (important for 200-300 invoices).
  const handleBatchPDF = async () => {
    const selected = invoices.filter((inv) => selectedIds.has(inv.id));
    if (selected.length === 0) {
      showMessage("Selectați cel puțin o factură", "error");
      return;
    }

    setBatchProgress({ current: 0, total: selected.length });

    const doc = new jsPDF({ format: "a4", unit: "pt" });
    const CHUNK_SIZE = 10;

    const processChunk = (startIdx) =>
      new Promise((resolve) => {
        setTimeout(() => {
          const end = Math.min(startIdx + CHUNK_SIZE, selected.length);
          for (let i = startIdx; i < end; i++) {
            if (i > 0) doc.addPage();
            const inv = selected[i];
            const { client, agent, order } = getClientForInvoice(inv);
            drawInvoiceOnDoc(doc, inv, company, client, agent, order);
          }
          setBatchProgress({ current: end, total: selected.length });
          resolve(end);
        }, 0);
      });

    try {
      let idx = 0;
      while (idx < selected.length) {
        idx = await processChunk(idx);
      }

      const dates = [...new Set(selected.map((i) => i.document_date).filter(Boolean))];
      const filename =
        dates.length === 1
          ? `facturi_${dates[0].replace(/-/g, "_")}.pdf`
          : "facturi_selectate.pdf";

      doc.save(filename);
      showMessage(`PDF generat cu succes (${selected.length} facturi)`);
    } catch (err) {
      showMessage(`Eroare la generarea PDF batch: ${err.message}`, "error");
    } finally {
      setBatchProgress(null);
    }
  };

  const toggleDetail = (inv) => {
    setSelectedInv((prev) => (prev?.id === inv.id ? null : inv));
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
      bt_153_item_name: lineForm.bt_153_item_name || null,
      bt_129_invoiced_quantity: lineForm.bt_129_invoiced_quantity ? parseFloat(lineForm.bt_129_invoiced_quantity) : null,
      bt_129_unit_code: lineForm.bt_129_unit_code || null,
      bt_146_item_net_price: lineForm.bt_146_item_net_price ? parseFloat(lineForm.bt_146_item_net_price) : null,
      bt_131_line_net_amount: lineForm.bt_131_line_net_amount ? parseFloat(lineForm.bt_131_line_net_amount) : null,
      bt_152_line_vat_rate: lineForm.bt_152_line_vat_rate ? parseFloat(lineForm.bt_152_line_vat_rate) : null,
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
    <div className="space-y-4 p-4">
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

      {/* Batch selection toolbar */}
      {invoices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">Selectare rapidă:</span>
          <select
            value={dateFilter}
            onChange={(e) => {
              const d = e.target.value;
              setDateFilter(d);
              if (d) {
                const forDate = invoices.filter((inv) => inv.document_date === d);
                setSelectedIds(new Set(forDate.map((inv) => inv.id)));
              }
            }}
            className="text-sm border border-blue-300 rounded px-2 py-1 bg-white"
          >
            <option value="">— Alege ziua —</option>
            {availableDates.map(({ date, count }) => (
              <option key={date} value={date}>
                {date} ({count} facturi)
              </option>
            ))}
          </select>
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1 px-3 py-1 text-sm border border-blue-300 bg-white rounded hover:bg-blue-100"
          >
            {(() => {
              const visible = dateFilter
                ? invoices.filter((inv) => inv.document_date === dateFilter)
                : invoices;
              return visible.length > 0 && visible.every((inv) => selectedIds.has(inv.id))
                ? <><CheckSquare className="w-4 h-4 text-blue-600" /> Deselectează toate</>
                : <><Square className="w-4 h-4 text-blue-600" /> Selectează toate</>;
            })()}
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={handleBatchPDF}
              disabled={batchProgress !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-60 transition"
            >
              <Printer className="w-4 h-4" />
              {batchProgress
                ? `Generez ${batchProgress.current}/${batchProgress.total}…`
                : `PDF Batch (${selectedIds.size} facturi)`}
            </button>
          )}
          {selectedIds.size > 0 && !batchProgress && (
            <button
              onClick={() => { setSelectedIds(new Set()); setDateFilter(""); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Anulează selecția
            </button>
          )}
        </div>
      )}

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
                <th className="border border-gray-300 px-2 py-2 text-center w-8">
                  <button
                    onClick={toggleSelectAll}
                    title="Selectează/Deselectează toate"
                    className="p-0.5 hover:bg-gray-200 rounded"
                  >
                    {(() => {
                      const visible = dateFilter
                        ? invoices.filter((inv) => inv.document_date === dateFilter)
                        : invoices;
                      return visible.length > 0 && visible.every((inv) => selectedIds.has(inv.id))
                        ? <CheckSquare className="w-4 h-4 text-blue-600" />
                        : <Square className="w-4 h-4 text-gray-500" />;
                    })()}
                  </button>
                </th>
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
                  Editare
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
                const { client } = getClientForInvoice(inv);
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
                    <tr className={`hover:bg-gray-50 ${selectedIds.has(inv.id) ? "bg-blue-50" : ""}`}>
                      <td className="border border-gray-300 px-2 py-2 text-center">
                        <button
                          onClick={() => toggleSelect(inv.id)}
                          className="p-0.5 hover:bg-blue-100 rounded"
                          title="Selectează pentru PDF batch"
                        >
                          {selectedIds.has(inv.id)
                            ? <CheckSquare className="w-4 h-4 text-blue-600" />
                            : <Square className="w-4 h-4 text-gray-400" />}
                        </button>
                      </td>
                      <td className="border border-gray-300 px-3 py-2 font-mono">
                        {inv.invoice_code || "-"}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {inv.document_date || "-"}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {snap.clientName ||
                          client?.nume ||
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
                          onClick={() => openLines(inv)}
                          className="p-1 hover:bg-amber-50 rounded"
                          title="Editare linii factură"
                        >
                          <List className="w-4 h-4 text-amber-600" />
                        </button>
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
                          colSpan={9}
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
