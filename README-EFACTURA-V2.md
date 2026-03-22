# E-Factura SPV-V2 – Modul Nou (Clean Slate)

Modul complet nou pentru integrarea cu **SPV ANAF** (Spațiul Virtual Privat),
construit de la zero cu lecțiile dobândite din test-spv1, test-spv2, test-spv3
și documentația oficială ANAF.

---

## Cuprins

1. [Cum funcționează autentificarea ANAF](#autentificare)
2. [De ce tokenul din Postman returnează 401](#token-401)
3. [Configurare rapidă](#configurare-rapida)
4. [Mutual TLS – certificat digital](#mtls)
5. [Flux OAuth2 complet](#flux-oauth2)
6. [Import token JWT din Postman](#token-import)
7. [Upload factură](#upload)
8. [Endpoint-uri API](#api)
9. [Variabile de mediu](#env)
10. [Depanare](#depanare)

---

## 1. Cum funcționează autentificarea ANAF {#autentificare}

ANAF folosește **OAuth2 Authorization Code Grant** cu două particularități esențiale:

### 1.1 Mutual TLS (mTLS)

La apelul `POST /token` (schimb cod → access_token și refresh_token),
serverul ANAF `logincert.anaf.ro` impune **Mutual TLS**: clientul trebuie să prezinte
certificatul digital calificat. Fără certificat, ANAF returnează `HTTP 500 Internal Server Error`.

### 1.2 Token JWT obligatoriu

ANAF poate emite două tipuri de token:
- **JWT** (JSON Web Token) – format `header.payload.signature` (3 segmente base64 separate prin `.`)
- **Opac** – șir hexadecimal de 64+ caractere fără puncte (ex: `f7584c01843b...`)

**Numai tokenele JWT funcționează** pentru apelurile API (upload, mesaje SPV).
Tokenele opace returnează `401 Unauthorized / invalid_token` la orice apel API.

**Parametrul cheie:** `token_content_type=jwt` în URL-ul de autorizare.

---

## 2. De ce tokenul din Postman returnează 401 {#token-401}

Dacă obțineți un token din Postman și primiți `401 invalid_token` la upload,
motivul este că tokenul obținut este **opac** (hex), nu JWT.

**Simptome:**
```
httpStatus: 401
www-authenticate: Bearer realm="...", error="invalid_token"
body: {"message":"Unauthorized","status":"401"}
```

**Cauza:** În Postman, dacă nu configurați explicit `token_content_type=jwt`,
ANAF emite un token opac. Acesta funcționează pentru sesiunile browser interactive,
dar **nu pentru apeluri API directe**.

**Verificare rapidă:** Un token JWT arată astfel:
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```
Un token opac arată astfel (NU funcționează pentru API):
```
f7584c01843b44ef373abe83855c53b15357d3bd571a0d3f538e173c9ed3c02e
```

**Soluție:** Vedeți secțiunea [Import token JWT din Postman](#token-import).

---

## 3. Configurare rapidă {#configurare-rapida}

### Pasul 1: Înregistrare aplicație la ANAF

1. Accesați: https://logincert.anaf.ro/anaf-oauth2/v1/
2. Autentificați-vă cu **certificatul digital calificat SPV**
3. Înregistrați aplicație nouă:
   - **Redirect URI**: `https://IP_EXTERN:5000/api/efactura-v2/oauth/callback`
   - **Scope**: `offline_access`
4. Notați `client_id` și `client_secret`

### Pasul 2: Configurare server

Creați `server/.env` (dacă nu există):
```bash
# Credențiale OAuth2 ANAF
ANAF_CLIENT_ID=client_id_din_portal_anaf
ANAF_CLIENT_SECRET=client_secret_din_portal_anaf

# Certificat digital pentru mTLS (obligatoriu pentru token exchange)
ANAF_CERT_PATH=/cale/absoluta/certificat.pem
ANAF_KEY_PATH=/cale/absoluta/cheie_privata.pem
ANAF_CERT_PASSPHRASE=parola_optionala

# URL extern accesibil din internet (pentru redirect ANAF)
PUBLIC_CALLBACK_URL=https://IP_EXTERN:5000
FRONTEND_URL=https://IP_EXTERN:5000
```

### Pasul 3: Configurare în aplicație

Accesați UI-ul aplicației → Setări e-Factura SPV-V2 și completați:
- **CIF**: CIF-ul firmei emitente
- **Client ID**: din portalul ANAF
- **Client Secret**: din portalul ANAF
- **Public Callback URL**: URL-ul extern accesibil (ex: `https://123.45.67.89:5000`)
- **Mediu**: `test` pentru testare, `prod` pentru producție

---

## 4. Mutual TLS – certificat digital {#mtls}

### De ce este necesar

ANAF (logincert.anaf.ro) impune că la `POST /token` clientul să prezinte
certificatul digital calificat SPV. Fără acesta, ANAF returnează HTTP 500.

### Exportare certificat în format PEM

```bash
# Din token USB (e.g. SafeNet, eToken)
openssl pkcs12 -in certificat.p12 -nokeys -out cert.pem -clcerts
openssl pkcs12 -in certificat.p12 -nocerts -out key.pem -nodes

# Sau cu parolă criptată:
openssl pkcs12 -in certificat.p12 -nocerts -out key.pem
```

### Configurare în .env

```bash
ANAF_CERT_PATH=/home/user/anaf/cert.pem
ANAF_KEY_PATH=/home/user/anaf/key.pem
ANAF_CERT_PASSPHRASE=parola_cheii  # opțional dacă cheia nu e criptată
```

### Verificare

```bash
# Verificați că fișierele sunt accesibile
node -e "
const fs = require('fs');
const https = require('https');
const agent = new https.Agent({
  cert: fs.readFileSync('/cale/cert.pem'),
  key: fs.readFileSync('/cale/key.pem'),
});
console.log('mTLS agent creat cu succes');
"
```

---

## 5. Flux OAuth2 complet {#flux-oauth2}

```
[Browser utilizator]
       │
       │ 1. Apelează GET /api/efactura-v2/oauth/authorize
       │    Primește { authUrl: "https://logincert.anaf.ro/anaf-oauth2/v1/authorize?..." }
       │
       │ 2. Deschide authUrl în browser
       │    Utilizatorul se autentifică cu certificat digital la ANAF
       │
       │ 3. ANAF redirectează la redirect_uri cu ?code=...&state=...
       │
[Server Node.js]
       │
       │ 4. GET /api/efactura-v2/oauth/callback?code=...&state=...
       │    Verifică state (anti-CSRF)
       │    POST logincert.anaf.ro/anaf-oauth2/v1/token (cu mTLS) → JWT
       │    Salvează token în DB
       │
       │ 5. Redirect la frontend cu ?oauth_success=1
       │
[Utilizator]
       │
       │ 6. POST /api/efactura-v2/upload/:invoiceId
       │    Uploadează factura XML cu Bearer JWT token
```

---

## 6. Import token JWT din Postman {#token-import}

Dacă nu puteți configura mTLS (certificat hardware USB, etc.), puteți obține
tokenul JWT din Postman și importa manual.

### Configurare Postman (OBLIGATORIU token_content_type=jwt)

1. Deschideți Postman
2. Mergeți la **Authorization** → **Type: OAuth 2.0**
3. Completați:
   - **Auth URL**: `https://logincert.anaf.ro/anaf-oauth2/v1/authorize`
   - **Access Token URL**: `https://logincert.anaf.ro/anaf-oauth2/v1/token`
   - **Client ID**: din portalul ANAF
   - **Client Secret**: din portalul ANAF
   - **Scope**: `offline_access`
   - **Callback URL**: redirect_uri înregistrat la ANAF
4. **CRITIC**: Click **Advanced** → adăugați parametru:
   ```
   Name: token_content_type
   Value: jwt
   ```
5. Click **Get New Access Token**
6. Autentificați cu certificat digital
7. Copiați **Access Token** (trebuie să aibă 3 segmente separate prin `.`)

### Import în aplicație

```bash
# Via API
curl -X POST https://SERVER:5000/api/efactura-v2/oauth/token-import \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "eyJhbGciOiJSUz...TOKEN_JWT...",
    "refresh_token": "REFRESH_TOKEN_OPTIONAL",
    "expires_in": 3600
  }'
```

**Sau din UI-ul aplicației** → Setări e-Factura SPV-V2 → Import Token.

> ⚠️ **Atenție**: Dacă tokenul NU este JWT (nu are puncte), modulul îl respinge
> cu eroare clară și instrucțiuni de rezolvare.

---

## 7. Upload factură {#upload}

### Cerințe

- Token JWT valid (nu expirat)
- CIF configurat în setări
- Factura existentă în `billing_invoices`

### Content-Type

Modulul folosește `Content-Type: text/plain` pentru upload, conform referinței
din test-spv2 (`uploadUBIAnaf`). ANAF acceptă și `application/xml` dar `text/plain`
este standardul utilizat în exemplele PHP oficiale.

### Exemplu request

```bash
curl -X POST https://SERVER:5000/api/efactura-v2/upload/INVOICE_ID \
  -H "Content-Type: application/json"
```

### Răspuns succes

```json
{
  "uploadId": "12345678",
  "status": "uploaded",
  "anafResponse": {
    "index_incarcare": "12345678",
    "ExecutionStatus": "0",
    "dateResponse": "20240315T120000"
  }
}
```

### Răspuns eroare 401 (token opac)

```json
{
  "error": "ANAF a respins tokenul (401 Unauthorized / invalid_token). Cel mai frecvent motiv: tokenul NU este JWT. Soluție: importați un token JWT...",
  "anafHttpStatus": 401
}
```

---

## 8. Endpoint-uri API {#api}

Toate rutele sunt la prefix `/api/efactura-v2`.

### Setări

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/settings` | Citire setări (fără secret) |
| PUT | `/settings` | Salvare setări |

### OAuth2

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/oauth/authorize` | Generare URL autorizare ANAF |
| GET | `/oauth/callback` | Callback OAuth2 (redirect ANAF) |
| POST | `/oauth/refresh` | Reînnoire token cu refresh_token |
| POST | `/oauth/token-import` | Import token JWT extern (Postman) |
| GET | `/oauth/diagnostic` | Diagnosticare configurare |

### Status & Log

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/status` | Stare modul (token valid, CIF, mTLS) |
| GET | `/action-log` | Jurnal acțiuni (ultimele 50) |

### Operațiuni SPV (necesită token JWT valid)

| Metodă | Rută | Descriere |
|--------|------|-----------|
| POST | `/upload/:invoiceId` | Încărcare factură XML |
| GET | `/check-status/:invoiceId` | Verificare stare mesaj ANAF |
| GET | `/download/:invoiceId` | Descărcare răspuns ZIP |
| GET | `/xml/:invoiceId` | Previzualizare XML UBL generat |
| GET | `/messages` | Lista mesajelor SPV (ultimele N zile) |
| GET | `/download-message/:id` | Descărcare mesaj specific |
| GET | `/local-messages` | Mesaje cacheate local |
| POST | `/upload-batch` | Încărcare lot facturi |
| POST | `/check-status-batch` | Verificare stare lot |

---

## 9. Variabile de mediu {#env}

```bash
# server/.env

# Certificat digital mTLS (ANAF logincert.anaf.ro)
ANAF_CERT_PATH=/cale/absoluta/cert.pem
ANAF_KEY_PATH=/cale/absoluta/key.pem
ANAF_CERT_PASSPHRASE=parola_optionala

# URL-uri pentru redirect OAuth2
PUBLIC_CALLBACK_URL=https://IP_EXTERN_SAU_DOMENIU:PORT
FRONTEND_URL=https://IP_EXTERN_SAU_DOMENIU:PORT

# Alte setări server
PORT=5000
TRUST_PROXY=1  # dacă serverul e în spatele proxy/NAT
```

---

## 10. Depanare {#depanare}

### 401 Unauthorized la upload

**Cauza 1 (cea mai frecventă):** Token non-JWT (opac).
- Verificare: tokenul JWT are 3 segmente separate prin `.`
- Soluție: Importați token JWT cu `token_content_type=jwt` în Postman

**Cauza 2:** Token expirat.
- Soluție: `POST /api/efactura-v2/oauth/refresh` sau importați token nou

**Cauza 3:** CIF incorect.
- Verificare: CIF-ul trebuie să coincidă cu cel din certificatul digital

### 500 la token exchange

**Cauza:** mTLS neconfigurat. ANAF returnează HTTP 500 fără certificat.
- Soluție: Configurați `ANAF_CERT_PATH` și `ANAF_KEY_PATH`

### access_denied la autorizare

**Cauze posibile:**
- `redirect_uri` nu coincide EXACT cu cel înregistrat la ANAF
- Certificatul digital nu are rolul e-Factura activat în SPV
- Aplicația OAuth2 nu e asociată cu CIF-ul dorit

**Verificare:** Apelați `GET /api/efactura-v2/oauth/diagnostic`

### XML respins de ANAF

- Verificați că XML-ul este valid UBL 2.1 CIUS-RO: `GET /api/efactura-v2/xml/:invoiceId`
- Asigurați-vă că datele vânzătorului (CIF, adresă) sunt complete în setări

### Diagnostic complet

```bash
curl https://SERVER:5000/api/efactura-v2/oauth/diagnostic | python3 -m json.tool
```

Răspuns exemplu:
```json
{
  "ready": true,
  "issues": [],
  "config": {
    "environment": "test",
    "hasCif": true,
    "hasClientId": true,
    "hasClientSecret": true,
    "redirectUri": "https://...",
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

Modulul folosește `Content-Type: text/plain` pentru upload (conform `uploadUBIAnaf()`
din test-spv2). ANAF procesează corect XML-ul indiferent de valoarea Content-Type
dar `text/plain` este standardul din exemplele PHP oficiale.

### Token exchange cu mTLS

Toate apelurile la `logincert.anaf.ro/anaf-oauth2/v1/token` folosesc
`https.Agent` configurat cu certificatul mTLS. Fără agent mTLS, serverul ANAF
returnează HTTP 500 și nu emite token.

### Retry logic

Upload-ul și token exchange-ul au retry cu backoff exponențial (1s, 2s, 4s)
pentru erori 5xx ANAF (tranzitorii). Erorile 4xx (client error) nu se reîncercă.

### Validare token JWT

Modulul respinge **strict** tokenele non-JWT la import. Dacă tokenul nu are
3 segmente base64 separate prin `.`, importul eșuează cu eroare clară și instrucțiuni
de rezolvare. Aceasta previne situația în care tokenele opace sunt stocate și
provoacă 401 la fiecare upload.
