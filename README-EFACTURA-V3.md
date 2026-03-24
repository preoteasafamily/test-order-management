# E-Factura SPV-V3 – Modul Nou (Clean Slate)

Modul complet nou pentru integrarea cu **SPV ANAF** (Spațiul Virtual Privat).
Construit de la zero cu o arhitectură clară, servicii separate și teste unitare.

**Autentificarea se face EXCLUSIV prin browser** – cheia privată a certificatului
digital NU trebuie extrasă sau configurată pe server.

---

## Cuprins

1. [Arhitectură](#arhitectura)
2. [Cum funcționează autentificarea ANAF](#autentificare)
3. [De ce tokenul din Postman returnează 401](#token-401)
4. [Configurare rapidă](#configurare-rapida)
5. [Flux OAuth2 complet](#flux-oauth2)
6. [Import token JWT din Postman](#token-import)
7. [Upload factură](#upload)
8. [Endpoint-uri API](#api)
9. [Variabile de mediu](#env)
10. [Rulare teste](#teste)
11. [Cauze erori frecvente și troubleshooting](#depanare)
12. [Auto-Refresh token JWT](#auto-refresh)
13. [Microserviciu PHP separat (opțional)](#microserviciu-php)

---

## 1. Arhitectură {#arhitectura}

```
server/
  routes/
    efactura-v3.js            ← Rute Express (strat subțire)
  services/
    anaf-oauth2/
      token-manager.js        ← Modul standalone JWT: buildAuthUrl, exchangeCode,
                                 refreshAccessToken, scheduleAutoRefresh, stocare criptată
    efactura-spv-v3/
      config.js               ← Gestionare setări DB, validare token
      anaf-client.js          ← Client HTTP cu retry exponențial (fără mTLS)
      xml-builder.js          ← Generator XML UBL 2.1 CIUS-RO
  tests/
    efactura-v3.test.js       ← 43 teste unitare (Node built-in assert)
    anaf-oauth2.test.js       ← 53 teste pentru token-manager

frontend/src/pages/
  EfacturaV3Screen.jsx        ← UI React cu 6 tab-uri

server/database.js            ← Tabele: spv_v3_settings, spv_v3_action_log
```

### Separarea responsabilităților

| Fișier | Responsabilitate |
|--------|-----------------|
| `services/anaf-oauth2/token-manager.js` | Nucleul OAuth2: buildAuthUrl, exchangeCode, refresh, auto-refresh, stocare criptată |
| `config.js` | Citire/scriere setări din DB, validare JWT, gestionare token |
| `anaf-client.js` | HTTP cu retry exponențial (3×), fără mTLS |
| `xml-builder.js` | Generare XML UBL 2.1 CIUS-RO din factura billing |
| `efactura-v3.js` | Rute Express, validare input, orchestrare servicii |

---

## 2. Cum funcționează autentificarea ANAF {#autentificare}

ANAF folosește **OAuth2 Authorization Code Grant** cu două particularități esențiale:

### 2.1 Autentificare exclusiv prin browser

Certificatul digital calificat SPV se utilizează **NUMAI în browser** la pasul de
autorizare (`GET /authorize`). Browserul gestionează prezentarea certificatului
nativ (dialog de selectare certificat + PIN). Cheia privată **nu poate și nu trebuie**
extrasă din token-ul USB hardware.

**De ce nu se poate exporta cheia privată?**
Token-urile USB de semnătură digitală (ex: SafeNet, eToken, Bit4ID) sunt proiectate să
**nu permită exportul cheii private** din motive de securitate. Cel mult se poate
exporta fișierul `.cer` (certificatul public), dar acesta nu este suficient pentru mTLS
server-side. Prin urmare, autentificarea server-to-server cu mTLS NU este posibilă fără
cheia privată.

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
2. Autentificați-vă cu certificatul digital calificat SPV **din browser**
3. Înregistrați aplicație nouă:
   - **Redirect URI**: `https://IP_EXTERN:5000/api/efactura-v3/oauth/callback`
   - **Scope**: `offline_access`
4. Notați `client_id` și `client_secret`

### Pasul 2: Configurare server

Creați sau editați `server/.env`:
```bash
# URL extern accesibil din internet (pentru redirect ANAF)
PUBLIC_CALLBACK_URL=https://IP_EXTERN:5000
FRONTEND_URL=https://IP_EXTERN:5000
```

> **NOTĂ:** Nu sunt necesare variabile pentru certificate mTLS.
> Autentificarea se face exclusiv prin browser.

### Pasul 3: Configurare în aplicație

Accesați UI → **e-Factura SPV-V3** → tab **Setări**:
- **CIF**: CIF-ul firmei emitente
- **Client ID**: din portalul ANAF
- **Client Secret**: din portalul ANAF
- **Public Callback URL**: `https://IP_EXTERN:5000`
- **Mediu**: `test` pentru testare, `prod` pentru producție

### Pasul 4: Obținere token JWT

Varianta A – prin browser (dacă callback-ul funcționează):
1. Click **Autentificare ANAF** → Deschide browser
2. Selectați certificatul, introduceți PIN-ul
3. Dacă redirect-ul reușește, tokenul e salvat automat

Varianta B – prin Postman (recomandat, întotdeauna funcționează):
1. Urmați instrucțiunile din secțiunea [Import token JWT din Postman](#token-import)
2. Importați tokenul via `POST /api/efactura-v3/oauth/token-import`

---

## 5. Flux OAuth2 complet {#flux-oauth2}

```
[Browser]
   │
   │ 1. GET /api/efactura-v3/oauth/authorize
   │    → { authUrl: "https://logincert.anaf.ro/...?token_content_type=jwt&..." }
   │
   │ 2. Deschide authUrl în browser
   │    → Selectare certificat digital + PIN (browserul gestionează TLS mutual)
   │
   │ 3. ANAF → redirect la /api/efactura-v3/oauth/callback?code=...&state=...
   │
[Server]
   │
   │ 4. Verifică state (anti-CSRF)
   │    POST logincert.anaf.ro/token (fără mTLS) → poate returna HTTP 500
   │    dacă ANAF impune mTLS la acest pas → utilizatorul folosește Postman
   │
   │ 5a. Dacă exchange reușit: redirect la FRONTEND_URL?oauth_success=1
   │ 5b. Dacă exchange eșuează: redirect la FRONTEND_URL?oauth_error=...
   │     → utilizatorul importă tokenul din Postman
   │
[Browser]
   │
   │ 6. Token JWT valid → upload facturi
```

**De ce poate eșua pasul 4?**

ANAF poate impune mTLS la `POST /token`. Fără certificat configurat pe server,
ANAF returnează HTTP 500. Aceasta este comportarea așteptată când cheia privată
nu poate fi extrasă din tokenul USB. **Soluția: import token din Postman (Varianta B).**

---

## 6. Import token JWT din Postman {#token-import}

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
4. Click **Get New Access Token** → selectați certificatul digital în browser
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

## 7. Upload factură {#upload}

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

## 8. Endpoint-uri API {#api}

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

## 9. Variabile de mediu {#env}

```bash
# server/.env

# URL-uri pentru redirect OAuth2 (OBLIGATORIU)
PUBLIC_CALLBACK_URL=https://IP_EXTERN_SAU_DOMENIU:5000
FRONTEND_URL=https://IP_EXTERN_SAU_DOMENIU:5000

# Server
PORT=5000
TRUST_PROXY=1  # dacă serverul e în spatele proxy/NAT
```

> **NOTĂ:** Variabilele `ANAF_CERT_PATH`, `ANAF_KEY_PATH`, `ANAF_CERT_PASSPHRASE`
> **NU sunt suportate și NU trebuie configurate**. Autentificarea cu certificat
> digital se face exclusiv prin browser. Cheia privată rămâne pe token-ul USB.

---

## 10. Rulare teste {#teste}

```bash
cd server
npm test
# sau separat:
node tests/efactura-v3.test.js
node tests/anaf-oauth2.test.js
```

Ieșire așteptată:
```
═══ xml-builder.js ═══════════════════════════════════════
  ✓ buildUBL – returns a string
  ... (43 teste efactura-v3)
Results: 43 passed, 0 failed
✅ All tests passed!

═══ token-manager exports ═══════════════════════════════════
  ✓ module exports ANAF_AUTH_URL
  ... (53 teste anaf-oauth2)
Results: 53 passed, 0 failed
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

- **anaf-client.js**: 3 teste
  - Exportă funcțiile `request` și `withRetry`
  - Nu exportă funcții mTLS (getMtlsAgent, isMtlsConfigured)

- **config helpers**: 10 teste
  - isJwt (valid/opac/gol/null/2 segmente/4 segmente)
  - isTokenExpired (fără dată/dată în trecut/dată în viitor)

- **token-manager.js**: 53 teste
  - Exports corecte (fără funcții mTLS)
  - isJwt, isExpired, expiresWithin
  - buildAuthUrl (token_content_type=jwt, state unic, validări)
  - exchangeCode / refreshAccessToken (validări parametri)
  - scheduleAutoRefresh (validări, stop funcție)
  - saveTokenToFile / loadTokenFromFile (roundtrip, permisiuni, cheie greșită)

---

## 11. Cauze erori frecvente și troubleshooting {#depanare}

### Eroarea `error=access_denied`

**URL exemplu:**
```
https://IP:5000/?oauth_error=access_denied&section=efactura-v3
```

**Cauze posibile:**
1. Utilizatorul a apăsat "Anulare" la dialogul de selectare certificat în browser
2. `redirect_uri` din cererea de autorizare nu coincide EXACT cu cel înregistrat la ANAF
   - Exemplu: `http://` vs `https://`, port lipsă sau diferit, `/` final în plus sau lipsă
3. Certificatul digital nu are rolul **e-Factura** activat în SPV
4. Aplicația OAuth2 nu este asociată cu CIF-ul dorit la ANAF
5. Sesiunea de browser a expirat sau există o problemă cu cookie-urile

**Acțiuni:**
- Verificați redirect_uri în Setări și la portalul ANAF (trebuie să fie identice caracter cu caracter)
- Verificați că certificatul are dreptul e-Factura la https://logincert.anaf.ro
- Reîncercați fluxul de autorizare dintr-o fereastră de browser curată (incognito)

---

### Eroarea `HTTP 500` la schimbul de cod (authorization_code_exchange)

**Simptom în loguri:**
```
[SPV-V3] authorization_code_exchange – HTTP 500, retry 1/3 in 1000ms
[SPV-V3] authorization_code_exchange – HTTP 500, retry 2/3 in 2000ms
```

**Cauza:**
ANAF impune Mutual TLS (mTLS) la `POST /token` (schimbul de cod → access_token).
Serverul backend nu trimite certificat client (cheia privată nu poate fi extrasă
din token-ul USB), deci ANAF returnează HTTP 500.

**Acesta este comportamentul așteptat** când autentificarea server-to-server nu e posibilă.

**Acțiuni:**
- **Soluție principală:** Obțineți tokenul JWT prin **Postman** (Postman gestionează
  selectarea certificatului în browser la pasul de autorizare):
  1. Configurați Postman conform secțiunii [Import token JWT din Postman](#token-import)
  2. Importați tokenul via `POST /api/efactura-v3/oauth/token-import`

- **Nu configurați** `ANAF_CERT_PATH`/`ANAF_KEY_PATH` – aceste variabile nu mai sunt suportate

---

### Eroarea `error=Internal server error` (redirect cu eroare)

**URL exemplu:**
```
https://IP:5000/?oauth_error=Internal%20server%20error&section=efactura-v3
```

**Cauza:**
Schimbul de cod a eșuat pe server (de obicei HTTP 500 de la ANAF, vezi mai sus),
iar serverul a redirecționat utilizatorul cu mesajul de eroare în URL.

**Acțiuni:**
- Verificați logurile serverului pentru detalii exacte
- Urmați aceeași soluție ca la eroarea HTTP 500: importați tokenul din Postman

---

### Eroarea `Cannot GET /`

**Simptom:**
```
Cannot GET /
```
apare pe fond alb la `https://IP:5000/`

**Cauze:**
1. `FRONTEND_URL` este setat la adresa serverului backend (port 5000), iar după
   redirect, Express nu servește niciun fișier la ruta `/`
2. `FRONTEND_URL` este gol, deci redirect-ul merge la `/` pe serverul backend

**Acțiuni:**
- Setați `FRONTEND_URL` la URL-ul **frontend-ului** (nu la serverul backend):
  - În producție (Express servește UI): lăsați gol sau setați la același host
  - În development (Vite pe port 5173): `FRONTEND_URL=https://IP:5173`
- Verificați că frontend-ul React este pornit și accesibil la URL-ul configurat

---

### 401 Unauthorized la upload factură

**Cauza 1 (cea mai frecventă):** Token non-JWT.
- Un token JWT are forma: `xxx.yyy.zzz` (3 segmente base64)
- Soluție: Importați token JWT cu `token_content_type=jwt` din Postman

**Cauza 2:** Token expirat.
- Soluție: `POST /api/efactura-v3/oauth/refresh` sau importați un token nou

**Cauza 3:** CIF incorect sau lipsă.
- Soluție: Verificați CIF-ul în setări

---

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
    "redirectUri": "https://IP:5000/api/efactura-v3/oauth/callback",
    "hasToken": true,
    "tokenIsJwt": true,
    "tokenExpired": false,
    "hasRefreshToken": true
  }
}
```

---

## Note tehnice

### De ce NU se folosește mTLS server-side

1. **Imposibilitate tehnică**: Token-urile USB hardware de semnătură digitală (SafeNet,
   eToken, Bit4ID etc.) **nu permit exportul cheii private**. Cel mult se poate exporta
   fișierul `.cer` (cheia publică), insuficient pentru mTLS.

2. **Securitate**: Extragerea cheii private dintr-un token hardware ar compromite
   securitatea certificatului digital calificat.

3. **Alternativă funcțională**: Browserul gestionează nativ prezentarea certificatului
   la pasul `GET /authorize`. Pentru `POST /token`, Postman poate media conexiunea
   prin browser, obținând un JWT valid care poate fi importat în aplicație.

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

---

## 12. Auto-Refresh token JWT {#auto-refresh}

Modulul pornește automat un scheduler de reînnoire a tokenului în background.
Verifică la fiecare **1 minut** dacă tokenul expiră în mai puțin de **10 minute**
și, dacă da, îl reînnoiește automat cu `refresh_token`.

### Cum funcționează

```
[Server startup]
       │
       │ efactura-v3.js importat → scheduleAutoRefresh() pornit
       │
[La fiecare 60s]
       │
       │ Citește tokenul din DB
       │ Dacă token expiră în < 10 min și există refresh_token:
       │   → POST /token cu refresh_token → token nou JWT
       │   → Salvat în DB
       │   → Logat în spv_v3_action_log (oauth_token_auto_refreshed)
       │
[La SIGTERM/SIGINT]
       │
       └─ Scheduler oprit
```

### Condiții pentru auto-refresh

1. Token JWT valid stocat în DB
2. `refresh_token` disponibil
3. `client_id` și `client_secret` configurate în Setări
4. Token expiră în mai puțin de 10 minute

### Dacă auto-refresh eșuează

- Eroarea este logată în `spv_v3_action_log` (acțiunea `oauth_auto_refresh_failed`)
- Eroarea apare și în logurile serverului: `[SPV-V3] Auto-refresh eșuat: ...`
- Tokenul vechi rămâne în DB până expiră
- Soluție: autentificați-vă din nou sau importați un token nou din Postman

---

## 13. Microserviciu PHP separat (opțional) {#microserviciu-php}

Dacă doriți să rulați componenta de autentificare ANAF ca microserviciu PHP
separat (inspirat din exemplul Lorand Szekely), mai jos sunt cerințele și structura.

> **NOTĂ**: Modulul Node.js curent este complet funcțional și nu necesită PHP.
> Această secțiune este pentru echipele care preferă PHP sau doresc un microserviciu dedicat.

### Cerințe server PHP

```
PHP >= 7.4
  - ext-curl       (pentru requesturi HTTPS)
  - ext-json       (pentru parsare răspunsuri)
  - ext-openssl    (pentru generare state randomizat)

Composer packages:
  - (opțional) guzzlehttp/guzzle ^7.0  – client HTTP mai elegant
  - (opțional) firebase/php-jwt        – decodare token JWT local
```

### Instalare dependențe PHP

```bash
composer require guzzlehttp/guzzle firebase/php-jwt
```

### Structura microserviciu PHP

```
anaf-oauth2-php/
  .env                    ← CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, FRONTEND_URL
  index.php               ← Entry point (routing)
  src/
    AnafOAuth2.php        ← Clasă principală OAuth2 (buildAuthUrl, exchangeCode, refresh)
    TokenStorage.php      ← Stocare token (DB sau fișier criptat)
    routes/
      authorize.php       ← GET /authorize → redirect la ANAF
      callback.php        ← GET /callback  → schimb cod → token
      refresh.php         ← POST /refresh  → reînnoire token
      token-import.php    ← POST /token-import → import din Postman
      status.php          ← GET /status    → verificare stare
```

### Flux PHP (AnafOAuth2.php)

```php
<?php
// Pasul 1: Generare URL autorizare (cu token_content_type=jwt OBLIGATORIU)
function buildAuthUrl(string $clientId, string $redirectUri): array {
    $state = bin2hex(random_bytes(32));  // anti-CSRF
    $_SESSION['oauth_state'] = $state;

    $params = http_build_query([
        'response_type'     => 'code',
        'client_id'         => $clientId,
        'redirect_uri'      => $redirectUri,
        'scope'             => 'offline_access',
        'state'             => $state,
        'token_content_type' => 'jwt',  // CRITIC
    ]);
    return [
        'authUrl' => 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize?' . $params,
        'state'   => $state,
    ];
}

// Pasul 2: Schimb cod → token (fără mTLS)
function exchangeCode(string $code, string $redirectUri, string $clientId, string $clientSecret): array {
    $ch = curl_init('https://logincert.anaf.ro/anaf-oauth2/v1/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-www-form-urlencoded',
            'Authorization: Basic ' . base64_encode("$clientId:$clientSecret"),
        ],
        CURLOPT_POSTFIELDS     => http_build_query([
            'grant_type'   => 'authorization_code',
            'code'         => $code,
            'redirect_uri' => $redirectUri,
        ]),
    ]);
    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code >= 500) {
        throw new Exception("ANAF HTTP $code – importați tokenul JWT din Postman.");
    }
    $data = json_decode($raw, true);
    if (empty($data['access_token'])) {
        throw new Exception('Răspuns invalid ANAF: lipsă access_token.');
    }
    return $data;
}

// Pasul 3: Refresh token
function refreshToken(string $refreshToken, string $clientId, string $clientSecret): array {
    // identic cu exchangeCode dar cu grant_type=refresh_token
}
```

### Endpoint-uri PHP recomandate

| Metodă | Rută | Descriere |
|--------|------|-----------|
| GET | `/authorize` | Redirect la ANAF (generează state anti-CSRF) |
| GET | `/callback` | Primește codul, face schimbul, salvează token |
| POST | `/refresh` | Reînnoire token cu refresh_token |
| POST | `/token-import` | Import token din Postman |
| GET | `/status` | Verificare stare token |

### Stocare token PHP (TokenStorage.php)

```php
<?php
class TokenStorage {
    private PDO $db;  // SQLite sau MySQL

    // Stocare în DB (preferată)
    public function saveToken(array $data): void {
        $stmt = $this->db->prepare(
            'UPDATE oauth_tokens SET access_token=?, refresh_token=?, expires_at=? WHERE id=1'
        );
        $expiresAt = date('Y-m-d H:i:s', time() + ($data['expires_in'] ?? 3600));
        $stmt->execute([$data['access_token'], $data['refresh_token'], $expiresAt]);
    }

    // Fallback: fișier criptat AES-256-GCM
    public function saveTokenToFile(array $data, string $path): void {
        $key     = $this->getOrCreateKey($path);
        $iv      = random_bytes(12);
        $payload = json_encode($data);
        $encrypted = openssl_encrypt($payload, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        file_put_contents($path, json_encode([
            'iv'   => bin2hex($iv),
            'tag'  => bin2hex($tag),
            'data' => bin2hex($encrypted),
        ]), LOCK_EX);
        chmod($path, 0600);
    }
}
```

### Rulare microserviciu PHP cu PHP built-in server

```bash
cd anaf-oauth2-php
cp .env.example .env
# Editați .env cu CLIENT_ID, CLIENT_SECRET, REDIRECT_URI

php -S 0.0.0.0:8080 index.php
# Accesibil la http://localhost:8080/
```

### Integrare cu Nginx (producție)

```nginx
server {
    listen 443 ssl;
    server_name anaf-oauth.myserver.ro;

    location / {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_param SCRIPT_FILENAME /var/www/anaf-oauth2-php/index.php;
        include fastcgi_params;
    }
}
```

> **IMPORTANT**: Nu configurați certificat client SSL (`ssl_certificate_key` pentru mTLS client)
> în Nginx. Autentificarea se face EXCLUSIV prin browser.
