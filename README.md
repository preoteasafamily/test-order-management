# test-order-management

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
