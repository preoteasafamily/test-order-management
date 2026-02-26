# test-order-management

## Billing Module

### Setup

1. Copy `.env.example` to `server/.env` and fill in your values:
   ```
   FACTUREAZA_API_KEY=your_api_key_here
   FACTUREAZA_ENDPOINT=https://sandbox.factureaza.ro/graphql
   ```
   - **FACTUREAZA_API_KEY** – your API key from factureaza.ro (used as HTTP Basic Auth username; password is ignored)
   - **FACTUREAZA_ENDPOINT** – GraphQL endpoint (sandbox or production)

2. The billing tables (`billing_invoices`, `app_settings`) are created automatically on server startup.

3. Invoice series and starting number are configured in **Configurare → Serie Documente** (same company settings panel).

### API Endpoints

#### Local Invoice Management (on-premise PDF generation)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/billing/local-invoices` | List locally stored invoice records |
| `GET`  | `/api/billing/local-invoices/:id/pdf` | Generate and download PDF for a single invoice (on demand) |
| `POST` | `/api/billing/local-invoices/pdf/batch` | Generate and download a ZIP of PDFs for multiple selected invoices |

**Batch PDF request body:**
```json
{ "invoiceIds": ["billing-xxx", "billing-yyy"] }
```

**Batch PDF response:** `application/zip` with filename:
- `facturi_YYYY_MM_DD.zip` – when all selected invoices share the same document date
- `facturi_multiple_dates.zip` – when dates differ

**PDF filenames inside ZIP:**
```
SERIE-000123_ClientName_2026-02-26.pdf
```

#### Order Validation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/billing/orders/:orderId/validate` | Mark an order as validated (`validata=true`) |

#### Company Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/config/company` | Get company settings (includes `invoiceSeries`, `invoiceNumber`) |
| `PUT`  | `/api/config/company` | Save company settings |

#### Factureaza.ro Integration (external)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/billing/invoices/from-order` | Create invoice in factureaza.ro from a validated order |
| `GET`  | `/api/billing/invoices` | List invoices from factureaza.ro (`?page=1&per_page=20`) |
| `GET`  | `/api/billing/invoice-series` | List invoice series from factureaza.ro |
| `POST` | `/api/billing/invoice-series` | Create invoice series in factureaza.ro |
| `GET`  | `/api/billing/invoices/:id/pdf` | Fetch invoice PDF from factureaza.ro |

### Workflow

1. **Order saves automatically create/update invoice records** – every time an order is created or updated, a `billing_invoices` record is upserted with the invoice code (e.g. `FAC-000001`) and a snapshot of the order. No PDF is generated at this point.

2. **Invoice numbering** – the next invoice number is read from company settings (`invoiceSeries` + `invoiceNumber`). It is incremented automatically each time a new invoice record is created.

3. **Downloading PDFs** – open the **Facturi** screen, select one or more invoices using the checkboxes, then click **Descarcă PDF (ZIP)** to download a ZIP containing A4 PDFs with Romanian labels.

4. **Single invoice PDF** – click the download icon on any invoice row to download a single PDF on demand.

### PDF format

- Size: A4
- Language: Romanian
- Currency: RON
- Per-line VAT rates
- Totals: total fără TVA, total TVA, total de plată (cu TVA)
