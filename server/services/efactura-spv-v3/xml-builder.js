'use strict';

/**
 * SPV v3 – UBL 2.1 CIUS-RO XML Builder
 * =======================================
 * Generates a UBL 2.1 XML invoice conforming to the Romanian national profile
 * CIUS-RO (CustomizationID: urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1).
 *
 * Input: a row from billing_invoices (with raw_snapshot JSON if available).
 * Output: XML string ready for upload to ANAF SPV.
 */

/**
 * Escape special XML characters.
 * @param {*} v
 * @returns {string}
 */
const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Parse raw_snapshot JSON from the invoice row.
 * @param {object} inv
 * @returns {object}
 */
const parseSnapshot = (inv) => {
  try {
    return inv.raw_snapshot ? JSON.parse(inv.raw_snapshot) : {};
  } catch {
    return {};
  }
};

/**
 * Group invoice lines by VAT rate and compute totals.
 * @param {Array} lines
 * @returns {{ vatGroups: object, totalNet: number, totalVat: number }}
 */
const computeTotals = (lines) => {
  const vatGroups = {};

  lines.forEach((item) => {
    const rate = item.vat != null ? Number(item.vat) : 19;
    const net  = Number(
      item.total != null
        ? item.total
        : (Number(item.unitCount || item.quantity || 0) *
           Number(item.price || 0)),
    );
    vatGroups[rate] = (vatGroups[rate] || 0) + net;
  });

  const totalNet = Object.values(vatGroups).reduce((s, v) => s + v, 0);
  const totalVat = Object.entries(vatGroups).reduce(
    (s, [r, n]) => s + (n * Number(r)) / 100,
    0,
  );

  return { vatGroups, totalNet, totalVat };
};

/**
 * Map a VAT rate percentage to the CIUS-RO tax category ID.
 * Standard rates (19, 9, 5 %) → 'S' (standard), zero rates → 'Z'.
 * @param {number} rate
 * @returns {'S'|'Z'}
 */
const vatCategory = (rate) => ([19, 9, 5].includes(Number(rate)) ? 'S' : 'Z');

/**
 * Build the UBL 2.1 XML string from a billing_invoices row.
 *
 * @param {object} inv – row from billing_invoices (may include BT fields and raw_snapshot)
 * @returns {string} – complete XML document
 */
const buildUBL = (inv) => {
  const snap = parseSnapshot(inv);

  // ── Buyer fields – prefer snapshot data, fall back to BT columns ──────────
  const buyer = {
    name:    snap.clientName       || inv.bt_44_buyer_name               || '',
    cif:     snap.clientCIF        || inv.bt_48_buyer_vat_identifier     || '',
    nrReg:   snap.clientNrRegCom   || inv.bt_47_buyer_legal_registration || '',
    address: snap.clientStrada     || inv.bt_50_buyer_address            || '',
    city:    snap.clientLocalitate || inv.bt_52_buyer_city               || '',
    region:  snap.clientJudet      || inv.bt_54_buyer_region             || '',
    country: snap.clientTara       || inv.bt_55_buyer_country            || 'RO',
  };

  const lines     = snap.lines || snap.documentPositions || [];
  const issueDate = esc(inv.document_date || inv.bt_2_issue_date || '');
  const dueDate   = esc(inv.due_date || inv.bt_9_due_date || inv.document_date || '');
  const invoiceId = esc(inv.invoice_code || inv.id || '');

  const { vatGroups, totalNet, totalVat } = computeTotals(lines);
  const grandTotal = totalNet + totalVat;

  // ── XML Document ───────────────────────────────────────────────────────────
  const parts = [];

  parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${invoiceId}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>`);

  if (snap.nrComanda) {
    parts.push(
      `  <cac:OrderReference>\n    <cbc:ID>${esc(snap.nrComanda)}</cbc:ID>\n  </cac:OrderReference>`,
    );
  }

  // Supplier
  parts.push(`  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(inv.bt_27_seller_name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(inv.bt_35_seller_address)}</cbc:StreetName>
        <cbc:CityName>${esc(inv.bt_37_seller_city)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(inv.bt_39_seller_region)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(inv.bt_40_seller_country || 'RO')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(inv.bt_31_32_seller_vat_identifier || inv.bt_29_seller_identifier || '')}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(inv.bt_27_seller_name)}</cbc:RegistrationName>
        <cbc:CompanyLegalForm>${esc(inv.bt_30_seller_legal_registration || '')}</cbc:CompanyLegalForm>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`);

  // Customer
  parts.push(`  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(buyer.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(buyer.address)}</cbc:StreetName>
        <cbc:CityName>${esc(buyer.city)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(buyer.region)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(buyer.country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(buyer.cif)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName>
        <cbc:CompanyID>${esc(buyer.nrReg)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`);

  // Payment means (optional – only when IBAN is set)
  if (inv.bt_84_payee_iban) {
    parts.push(`  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(inv.bt_81_payment_means_code || '31')}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(inv.bt_84_payee_iban)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`);
  }

  // TaxTotal
  const taxSubtotals = Object.entries(vatGroups)
    .map(([rate, net]) => {
      const vatAmt = (net * Number(rate)) / 100;
      const cat    = vatCategory(rate);
      return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">${net.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">${vatAmt.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    })
    .join('\n');

  parts.push(`  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">${totalVat.toFixed(2)}</cbc:TaxAmount>
${taxSubtotals}
  </cac:TaxTotal>`);

  // Monetary totals
  parts.push(`  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${grandTotal.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">${grandTotal.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`);

  // Invoice lines
  lines.forEach((item, idx) => {
    const rate    = item.vat != null ? Number(item.vat) : 19;
    const qty     = Number(item.unitCount || item.quantity || 0);
    const price   = Number(item.price || 0);
    const lineNet = Number(item.total != null ? item.total : qty * price);
    const cat     = vatCategory(rate);

    parts.push(`  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(item.name || item.descriere || '')}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="RON">${price.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`);
  });

  parts.push('</Invoice>');

  return parts.join('\n') + '\n';
};

/**
 * Remove xsi:schemaLocation attribute from XML (ANAF sometimes rejects it).
 * @param {string} xml
 * @returns {string}
 */
const stripSchemaLocation = (xml) =>
  xml.replace(/\s+xsi:schemaLocation="[^"]*"/gi, '');

module.exports = { buildUBL, stripSchemaLocation, computeTotals, vatCategory };
