# E-Factura SPV-V3 – Modul Nou (Clean Slate)

Modul complet nou pentru integrarea cu **SPV ANAF** (Spațiul Virtual Privat).
Construit de la zero cu o arhitectură clară, servicii separate și teste unitare.

---

## Cuprins

1. [Arhitectură](#arhitectura)
2. [Cum funcționează autentificarea ANAF](#autentificare)
3. [De ce tokenul din Postman returnează 401](#token-401)
4. [Configurare rapidă](#configurare-rapida)
5. [Mutual TLS – certificat digital](#mtls)
6. [Flux OAuth2 complet](#flux-oauth2)
7. [Import token JWT din Postman](#token-import)
8. [Upload factură](#upload)
9. [Endpoint-uri API](#api)
10. [Variabile de mediu](#env)
11. [Rulare teste](#teste)
12. [Depanare](#depanare)

---

## 1. Arhitectură {#arhitectura}

```
server/
  routes/
    efactura-v3.js            ← Rute Express (strat subțire)
  services/
    efactura-spv-v3/
      config.js               ← Gestionare setări DB, validare token
      anaf-client.js          ← Client HTTP cu mTLS și retry exponențial
      xml-builder.js          ← Generator XML UBL 2.1 CIUS-RO
  tests/
    efactura-v3.test.js       ← 42 teste unitare (Node built-in assert)

frontend/src/pages/
  EfacturaV3Screen.jsx        ← UI React cu 6 tab-uri

server/database.js            ← Tabele: spv_v3_settings, spv_v3_action_log
```

### Separarea responsabilităților

| Fișier | Responsabilitate |
|--------|-----------------|
| `config.js` | Citire/scriere setări din DB, validare JWT, gestionare token |
| `anaf-client.js` | HTTP cu mTLS (https.Agent), retry exponențial (3×) |
| `xml-builder.js` | Generare XML UBL 2.1 CIUS-RO din factura billing |
| `efactura-v3.js` | Rute Express, validare input, orchestrare servicii |

---

## 2. Cum funcționează autentificarea ANAF {#autentificare}

ANAF folosește **OAuth2 Authorization Code Grant** cu două particularități esențiale:

### 2.1 Mutual TLS (mTLS)

La apelul `POST /token` (schimb cod → access_token și refresh_token),
serverul ANAF `logincert.anaf.ro` impune **Mutual TLS**: clientul trebuie să prezinte
certificatul digital calificat. Fără certificat, ANAF returnează `HTTP 500`.

### 2.2 Token JWT obligatoriu

ANAF poate emite două tipuri de token:
- **JWT** (JSON Web Token) – format `header.payload.signature` (3 segmente base64)
- **Opac** – șir hexadecimal fără puncte

**Numai tokenele JWT funcționează** pentru apelurile API.
Tokenele opace returnează `401 Unauthorized / invalid_token`.

**Parametrul cheie:** `token_content_type=jwt` în URL-ul de autorizare.

---

## 3. De ce tokenul din Postman returnează 401 {#token-401}

**Simptome:**
```json
{ "message": "Unauthorized", "status": "401" }
```

**Cauza:** Postman nu configurează `token_content_type=jwt` by default.
ANAF emite un token opac (hex) care nu funcționează pentru API.

**Verificare:** Un token JWT arată:
```
eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMe...
```
Un token opac (NU funcționează):
```
f7584c01843b44ef373abe83855c53b15357d3bd...
```

**Soluție:** Adăugați `token_content_type=jwt` în Postman → Advanced → Extra Parameters.

---

## 4. Configurare rapidă {#configurare-rapida}

### Pasul 1: Înregistrare aplicație la ANAF

1. Accesați: https://logincert.anaf.ro/anaf-oauth2/v1/
2. Autentificați-vă cu certificatul digital calificat SPV
3. Înregistrați aplicație nouă:
   - **Redirect URI**: `https://IP_EXTERN:5000/api/efactura-v3/oauth/callback`
   - **Scope**: `offline_access`
4. Notați `client_id` și `client_secret`

### Pasul 2: Configurare server

Creați sau editați `server/.env`:
```bash
# Certificat digital pentru mTLS (obligatoriu pentru token exchange)
ANAF_CERT_PATH=/cale/absoluta/certificat.pem
ANAF_KEY_PATH=/cale/absoluta/cheie_privata.pem
ANAF_CERT_PASSPHRASE=parola_optionala  # dacă cheia e criptată

# URL extern accesibil din internet (pentru redirect ANAF)
PUBLIC_CALLBACK_URL=https://IP_EXTERN:5000
FRONTEND_URL=https://IP_EXTERN:5000
```

### Pasul 3: Configurare în aplicație

Accesați UI → **e-Factura SPV-V3** → tab **Setări**:
- **CIF**: CIF-ul firmei emitente
- **Client ID**: din portalul ANAF
- **Client Secret**: din portalul ANAF
- **Public Callback URL**: `https://IP_EXTERN:5000`
- **Mediu**: `test` pentru testare, `prod` pentru producție

---

## 5. Mutual TLS – certificat digital {#mtls}

### Exportare certificat în format PEM

```bash
# Din token USB (SafeNet, eToken, etc.)
openssl pkcs12 -in certificat.p12 -nokeys -out cert.pem -clcerts
openssl pkcs12 -in certificat.p12 -nocerts -out key.pem -nodes

# Cu parolă criptată:
openssl pkcs12 -in certificat.p12 -nocerts -out key.pem
# (va cere parola)
```

### Verificare

```bash
node -e "
const fs = require('fs');
const https = require('https');
const agent = new https.Agent({
  cert: fs.readFileSync('/cale/cert.pem'),
  key: fs.readFileSync('/cale/key.pem'),
});
console.log('✓ mTLS agent creat cu succes');
"
```

### Verificare în diagnosticare

```bash
curl https://SERVER:5000/api/efactura-v3/oauth/diagnostic | python3 -m json.tool
```

Căutați `"mtlsConfigured": true` în răspuns.

---

## 6. Flux OAuth2 complet {#flux-oauth2}

```
[Browser]
   │
   │ 1. GET /api/efactura-v3/oauth/authorize
   │    → { authUrl: "https://logincert.anaf.ro/...?token_content_type=jwt&..." }
   │
   │ 2. Deschide authUrl în browser
   │    → Autentificare cu certificat digital la ANAF
   │
   │ 3. ANAF → redirect la /api/efactura-v3/oauth/callback?code=...&state=...
   │
[Server]
   │
   │ 4. Verifică state (anti-CSRF)
   │    POST logincert.anaf.ro/token (cu mTLS) → JWT
   │    Salvează token în DB (spv_v3_settings)
   │    Logează acțiunea (spv_v3_action_log)
   │
   │ 5. Redirect la FRONTEND_URL?oauth_success=1&section=efactura-v3
   │
[Browser]
   │
   │ 6. UI detectează oauth_success → afișează mesaj de succes
   │    Token JWT e gata pentru upload facturi
```

---

## 7. Import token JWT din Postman {#token-import}

### Configurare Postman

1. **Authorization** → **Type: OAuth 2.0**
2. Completați:
   - **Auth URL**: `https://logincert.anaf.ro/anaf-oauth2/v1/authorize`
   - **Token URL**: `https://logincert.anaf.ro/anaf-oauth2/v1/token`
   - **Client ID** și **Client Secret**: din portalul ANAF
   - **Scope**: `offline_access`
   - **Callback URL**: redirect_uri înregistrat la ANAF
3. **CRITIC**: Click **Advanced** → Extra Parameters:
   ```
   token_content_type = jwt
   ```
4. Click **Get New Access Token** → autentificați cu certificat digital
5. Copiați **Access Token** (trebuie să aibă 3 segmente separate prin `.`)

### Import în aplicație

```bash
curl -X POST https://SERVER:5000/api/efactura-v3/oauth/token-import \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "eyJhbGciOiJSUz...TOKEN_JWT...",
    "refresh_token": "REFRESH_TOKEN",
    "expires_in": 3600
  }'
```

---

## 8. Upload factură {#upload}

### Cerințe

- Token JWT valid (neexpirat)
- CIF configurat în setări
- Factura există în `billing_invoices`

### Exemplu

```bash
curl -X POST https://SERVER:5000/api/efactura-v3/upload/INVOICE_ID
```

### Răspuns succes

```json
{
  "ok": true,
  "uploadId": "12345678",
  "status": "uploaded",
  "parsed": {
    "uploadId": "12345678",
    "executionStatus": "0",
    "errors": []
  }
}
```

### Răspuns eroare 401

```json
{
  "error": "ANAF a respins tokenul (401 Unauthorized). Tokenul nu este JWT sau a expirat. Importați un token JWT proaspăt via POST /api/efactura-v3/oauth/token-import.",
  "anafHttpStatus": 401
}
```

---

## 9. Endpoint-uri API {#api}

Prefix: `/api/efactura-v3`

### Setări

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/settings` | Citire setări (secret mascat) |
| PUT | `/settings` | Salvare setări |

### OAuth2

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/oauth/authorize` | Generare URL autorizare ANAF (cu token_content_type=jwt) |
| GET | `/oauth/callback` | Callback OAuth2 (redirect de la ANAF) |
| POST | `/oauth/refresh` | Reînnoire token cu refresh_token |
| POST | `/oauth/token-import` | Import token JWT extern |
| DELETE | `/oauth/token` | Ștergere token (deconectare) |
| GET | `/oauth/diagnostic` | Diagnosticare completă |

### Status & Log

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/status` | Stare rapidă |
| GET | `/action-log` | Jurnal acțiuni (ultimele 50) |
| GET | `/invoices` | Lista facturi cu status SPV |

### Operațiuni SPV (necesită token JWT valid)

| Metodă | Rută | Descriere |
|--------|------|-----------|
| POST | `/upload/:invoiceId` | Încărcare factură XML |
| GET | `/check-status/:invoiceId` | Verificare stare mesaj ANAF |
| GET | `/download/:invoiceId` | Descărcare răspuns ZIP |
| GET | `/xml/:invoiceId` | Previzualizare XML UBL generat |

### Mesaje

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/messages` | Preluare mesaje SPV din ANAF (ultimele 30 zile) |
| GET | `/download-message/:id` | Descărcare mesaj specific |
| GET | `/local-messages` | Mesaje cacheate local |

### Lot

| Metodă | Rută | Descriere |
|--------|------|-----------|
| POST | `/upload-batch` | Încărcare lot facturi `{ invoiceIds: [] }` |
| POST | `/check-status-batch` | Verificare stare lot `{ items: [{invoiceId, uploadId}] }` |

---

## 10. Variabile de mediu {#env}

```bash
# server/.env

# Certificat digital mTLS (OBLIGATORIU pentru token exchange)
ANAF_CERT_PATH=/cale/absoluta/cert.pem
ANAF_KEY_PATH=/cale/absoluta/key.pem
ANAF_CERT_PASSPHRASE=parola_optionala

# URL-uri pentru redirect OAuth2
PUBLIC_CALLBACK_URL=https://IP_EXTERN_SAU_DOMENIU:5000
FRONTEND_URL=https://IP_EXTERN_SAU_DOMENIU:5000

# Server
PORT=5000
TRUST_PROXY=1  # dacă serverul e în spatele proxy/NAT
```

---

## 11. Rulare teste {#teste}

```bash
cd server
npm test
# sau
node tests/efactura-v3.test.js
```

Ieșire așteptată:
```
═══ xml-builder.js ═══════════════════════════════════════
  ✓ buildUBL – returns a string
  ✓ buildUBL – starts with XML declaration
  ... (42 teste în total)

Results: 42 passed, 0 failed
✅ All tests passed!
```

### Ce se testează

- **xml-builder.js**: 30 teste
  - Structura XML (namespace, CustomizationID, InvoiceTypeCode)
  - Calculul TVA (grupare pe cote, totale)
  - Escape caractere speciale XML
  - Prioritate date snapshot vs câmpuri BT
  - Facturi cu mai multe linii și cote mixte
  - stripSchemaLocation
  - vatCategory (S/Z)
  - computeTotals

- **anaf-client.js**: 2 teste
  - isMtlsConfigured (fără env vars → false)
  - isMtlsConfigured (fișiere inexistente → false)

- **config helpers**: 10 teste
  - isJwt (valid/opac/gol/null/2 segmente/4 segmente)
  - isTokenExpired (fără dată/dată în trecut/dată în viitor)

---

## 12. Depanare {#depanare}

### 401 Unauthorized la upload

**Cauza 1 (cea mai frecventă):** Token non-JWT.
- Un token JWT are forma: `xxx.yyy.zzz` (3 segmente base64)
- Soluție: Importați token JWT cu `token_content_type=jwt` în Postman

**Cauza 2:** Token expirat.
- Soluție: `POST /api/efactura-v3/oauth/refresh` sau autentificați-vă din nou

**Cauza 3:** CIF incorect sau lipsă.
- Soluție: Verificați CIF-ul în setări

### 500 la token exchange

**Cauza:** mTLS neconfigurat sau certificat invalid.
- Soluție: Configurați `ANAF_CERT_PATH` și `ANAF_KEY_PATH` în `server/.env`

### access_denied la autorizare

**Cauze posibile:**
- `redirect_uri` nu coincide EXACT cu cel înregistrat la ANAF
- Certificatul digital nu are rolul e-Factura activat în SPV
- Aplicația OAuth2 nu e asociată cu CIF-ul dorit

### Diagnostic complet

```bash
curl -s https://SERVER:5000/api/efactura-v3/oauth/diagnostic | python3 -m json.tool
```

Răspuns ideal:
```json
{
  "ready": true,
  "issues": [],
  "config": {
    "environment": "test",
    "hasCif": true,
    "hasClientId": true,
    "hasClientSecret": true,
    "mtlsConfigured": true,
    "hasToken": true,
    "tokenIsJwt": true,
    "tokenExpired": false
  }
}
```

---

## Note tehnice

### Content-Type upload

Modulul folosește `Content-Type: text/plain` pentru upload XML,
conform standardului din exemplele PHP oficiale ANAF (test-spv2).

### Retry logic

- MAX_RETRY = 3 tentative
- Retry NUMAI pe erori 5xx (erori ANAF tranzitorii)
- Backoff exponențial: 1s → 2s → 4s
- Erorile 4xx (client error, 401 etc.) NU se reîncercă

### Validare token JWT

Modulul respinge strict tokenele non-JWT:
- Import via API: returnează 400 cu instrucțiuni clare
- Middleware requireToken: returnează 401 cu `action` și `hint`

### Jurnal acțiuni

Toate operațiunile sunt logate în `spv_v3_action_log`:
- acțiune, detalii JSON, success/failure, mesaj eroare, timestamp

### Tabele baze de date

```sql
-- Setări (un singur rând, id = 1)
spv_v3_settings (id, cif, environment, client_id, client_secret,
                  redirect_uri, public_callback_url, oauth_token,
                  refresh_token, token_expires_at, oauth_state,
                  oauth_redirect_uri_used, last_action, last_action_at,
                  updated_at)

-- Jurnal (append-only)
spv_v3_action_log (id, action, details, success, error_message, created_at)
```

Mesajele SPV sunt stocate în `spv_messages` (tabel comun cu V2).
