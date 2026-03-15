# Samlax – Order Management

## Branding

The application is named **Samlax**. The name appears in:
- Browser tab title (`frontend/index.html`)
- App header (`frontend/src/components/Header.jsx`)
- Login screen (`frontend/src/App.jsx`)
- `frontend/package.json` name field

The favicon and UI logo is `frontend/public/samlax.svg` – a transparent "S" icon (no background fill).
**Invoices (PDF and UBL/XML) contain no branding or logo.**

## Billing Module – Factureaza.ro Integration

### Setup

1. Copy `.env.example` to `server/.env` and fill in your values:
   ```
   FACTUREAZA_API_KEY=your_api_key_here
   FACTUREAZA_ENDPOINT=https://sandbox.factureaza.ro/graphql
   ```
   - **FACTUREAZA_API_KEY** – your API key from factureaza.ro (used as HTTP Basic Auth username; password is ignored)
   - **FACTUREAZA_ENDPOINT** – GraphQL endpoint (sandbox or production)

2. The billing table `billing_invoices` is created automatically on server startup.

### Invoice Layout

#### PDF (backend `generateInvoicePdf` in `server/routes/billing.js`)

- **Header** – two-column horizontal layout, **no section titles, no branding**:
  - **Left column (Seller):** company data from billing settings (`bt_27_seller_name`, `bt_31_32_seller_vat_identifier`, `bt_30_seller_legal_registration`, address fields `bt_35`–`bt_39`, `bt_42_seller_phone`, `bt_43_seller_email`). Text is left-aligned.
  - **Right column (Buyer):** client data captured in the invoice snapshot (BT-44…BT-55: name, CIF, Reg. Com., address, city, county, country). Text is **right-aligned** to the page margin. If no buyer data exists the right column is omitted and the left column is displayed alone without any visual gap.
- **Products table** – columns: `Nr.` | `Cod` | `Descriere` | `UM` | `Cant.` | `Preț` | `Total`
  - **`Cod` column** contains the EAN barcode (`codBare`, BT-157 `bt_157_item_barcode`) from the product record, *not* the supplier code (`codArticolFurnizor`, BT-155).
- **Footer (two-column)** – rendered on the same row directly below the products table:
  - **Left column:** `Date privind expediția:` – delegat name, mijloc transport, C.I. (serie, număr, eliberat de). Omitted when no agent data is present.
  - **Right column:** `Total fără TVA`, `TVA`, `TOTAL` – right-aligned to the page margin.

#### PDF (frontend `generateInvoicePDF` in `frontend/src/pages/InvoicesScreen.jsx`)

- Same layout as the backend PDF: two-column header without section titles, `Cod` column uses EAN barcode, no branding or footer.
- **Footer (two-column)** – same structure as backend: `Date privind expediția` left, totals right, on the same row.

#### UBL/XML Export – CIUS-RO (SPV eFactura) (`frontend/src/pages/InvoicesScreen.jsx`, `InvoicesV2Screen.jsx`)

Generated XML conforms to **UBL 2.1** with the Romanian national profile **CIUS-RO** (`urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1`), suitable for direct upload to the SPV eFactura platform at ANAF.

**Mandatory CIUS-RO fields included:**

| Element | BT | Value / Source |
|---|---|---|
| `CustomizationID` | – | `urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1` |
| `ID` | BT-1 | `inv.invoice_code` or `inv.id` |
| `IssueDate` | BT-2 | `inv.document_date` |
| `DueDate` | BT-9 | `inv.due_date` (falls back to `IssueDate`) |
| `InvoiceTypeCode` | BT-3 | `380` (commercial invoice) |
| `DocumentCurrencyCode` | BT-5 | `RON` |
| Seller `PartyTaxScheme/CompanyID` | BT-31/32 | `company.bt_31_32_seller_vat_identifier` |
| Seller `PartyLegalEntity/RegistrationName` | BT-27 | `company.bt_27_seller_name` |
| Seller `PartyLegalEntity/CompanyLegalForm` | BT-30 | `company.bt_30_seller_legal_registration` (e.g. `J40/…`) |
| Buyer `PartyTaxScheme/CompanyID` | BT-48 | `client.cif` / `snapshot.clientCIF` |
| Buyer `PartyLegalEntity/CompanyID` | BT-47 | `client.nrRegCom` / `snapshot.clientNrRegCom` |
| `PaymentMeans/PaymentMeansCode` | BT-81 | `company.bt_81_payment_means_code` (default `31`) |
| `PaymentMeans/PayeeFinancialAccount/ID` | BT-84 | `company.bt_84_payee_iban` |
| `TaxTotal/TaxAmount` | BT-110 | sum of VAT per tax group |
| `TaxSubtotal/TaxableAmount` | BT-116 | sum of line totals per VAT rate |
| `TaxSubtotal/TaxAmount` | BT-117 | `TaxableAmount × rate / 100` |
| `TaxSubtotal/TaxCategory/ID` | BT-118 | `S` (standard) or `Z` (zero-rated) |
| `TaxSubtotal/TaxCategory/Percent` | BT-119 | VAT rate (19, 9, 5, 0, …) |
| `LegalMonetaryTotal/LineExtensionAmount` | BT-106 | sum of line net amounts |
| `LegalMonetaryTotal/TaxExclusiveAmount` | BT-109 | total ex-VAT (`inv.total`) |
| `LegalMonetaryTotal/TaxInclusiveAmount` | BT-112 | total incl. VAT (`inv.total_with_vat`) |
| `LegalMonetaryTotal/PayableAmount` | BT-115 | same as `TaxInclusiveAmount` |
| `InvoiceLine/ClassifiedTaxCategory/ID` | BT-151 | `S` or `Z` per line |
| `StandardItemIdentification` (`schemeID="0160"`) | BT-157 | EAN barcode (`item.barcode`) |
| `SellersItemIdentification` | BT-155 | supplier article code (`item.productCode`) |

**Validation notes:**
- XML validates against UBL 2.1 XSD and CIUS-RO Schematron rules.
- All monetary amounts use `currencyID="RON"`.
- `TaxTotal` is grouped per distinct VAT rate; each group produces one `TaxSubtotal`.
- `Delivery` block is emitted only when at least one delivery address field is populated.
- `PaymentMeans` block is emitted only when `bt_84_payee_iban` is configured.

#### XML Export (`frontend/src/pages/ExportScreen.jsx`, `ExportScreenGrouped.jsx`)

- `<CodBare>` → EAN barcode (`product.codBare`). This is the primary `Cod` identifier, consistent with the PDF table.
- `<CodArticolFurnizor>` → supplier article code (`product.codArticolFurnizor`), kept as a separate supplementary field.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/billing/orders/:orderId/validate` | Mark an order as validated (`validata=true`) |
| `POST` | `/api/billing/invoices/from-order` | Create invoice in factureaza.ro from a validated order |
| `GET`  | `/api/billing/invoices` | List invoices from factureaza.ro (`?page=1&per_page=20`) |
| `GET`  | `/api/billing/invoice-series` | List invoice series |
| `POST` | `/api/billing/invoice-series` | Create invoice series |
| `GET`  | `/api/billing/invoices/:id/pdf` | Fetch invoice PDF |
| `GET`  | `/api/billing/local-invoices` | List locally stored invoice records |

### Workflow

1. In **Matrice Comenzi**, click **Validează** for an order to mark it as ready for invoicing.
2. After validation, click **Factură** to generate the invoice in factureaza.ro.
3. Once generated, a **PDF** download button appears.
4. All generated invoices are listed in the **Facturi** screen (navigation menu).
