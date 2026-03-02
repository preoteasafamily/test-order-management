# Samlax – Order Management

## Branding

The application is named **Samlax**. The name appears in:
- Browser tab title (`frontend/index.html`)
- App header (`frontend/src/components/Header.jsx`)
- Login screen (`frontend/src/App.jsx`)
- PDF invoice footer (`server/routes/billing.js`)
- `frontend/package.json` name field

The favicon is `frontend/public/samlax.svg` – a blue square with a white "S".

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

- **Header** – two-column horizontal layout, **no section titles**:
  - **Left column (Seller):** company data from billing settings (`bt_27_seller_name`, `bt_31_32_seller_vat_identifier`, `bt_30_seller_legal_registration`, address fields `bt_35`–`bt_39`, `bt_42_seller_phone`, `bt_43_seller_email`). Text is left-aligned.
  - **Right column (Buyer):** client data captured in the invoice snapshot (BT-44…BT-55: name, CIF, Reg. Com., address, city, county, country). Text is **right-aligned** to the page margin. If no buyer data exists the right column is omitted and the left column is displayed alone without any visual gap.
- **Products table** – columns: `Nr.` | `Cod` | `Descriere` | `UM` | `Cant.` | `Preț` | `Total`
  - **`Cod` column** contains the EAN barcode (`codBare`, BT-157 `bt_157_item_barcode`) from the product record, *not* the supplier code (`codArticolFurnizor`, BT-155).

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
