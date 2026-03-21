# E-factura SPV-V2 – Modul Integrare ANAF

Modul complet separat de E-factura SPV original, implementat pentru integrare cu ANAF pe IP extern (port-forwarding / domeniu public).

---

## Cuprins

1. [Prezentare generală](#prezentare-generala)
2. [Pași externi obligatorii (înregistrare la ANAF)](#pasi-externi)
3. [Configurare IP extern / port-forwarding](#configurare-ip-extern)
4. [Configurare modul în aplicație](#configurare-aplicatie)
5. [Flux OAuth2 complet](#flux-oauth2)
6. [Endpoint-uri API](#endpoints-api)
7. [Variabile de mediu](#variabile-de-mediu)
8. [Depanare probleme frecvente](#depanare)

---

## Prezentare generală {#prezentare-generala}

Modulul **E-factura SPV-V2** este implementat la prefix `/api/efactura-v2` și oferă:

- Flux OAuth2 complet conform specificației ANAF
- Suport pentru IP extern și port-forwarding
- Gestiune token (persistare, refresh, expiry)
- Toate endpoint-urile principale eFactură ANAF
- Jurnal de acțiuni (audit log)
- Middleware de verificare token
- Diagnostic configurare

---

## Pași externi obligatorii (înregistrare la ANAF) {#pasi-externi}

Înainte de a utiliza modulul, trebuie parcurși urmatorii pași la ANAF:

### 1. Înregistrare aplicație OAuth2

1. Accesați portalul ANAF: https://logincert.anaf.ro/anaf-oauth2/v1/
2. Autentificați-vă cu certificatul digital SPV
3. Mergeți la **"Aplicații OAuth2"** → **"Înregistrare aplicație nouă"**
4. Completați:
   - **Nume aplicație**: (ex: `ERP-efactura-v2`)
   - **redirect_uri**: URL-ul **extern** accesibil de pe internet (vezi secțiunea IP extern)
     - Format: `https://IP_EXTERN:PORT/api/efactura-v2/oauth/callback`
     - Exemplu: `https://123.45.67.89:5000/api/efactura-v2/oauth/callback`
   - **Scopes**: `offline_access`
5. Notați `client_id` și `client_secret` generate

### 2. Activare rol e-Factura în SPV

1. Accesați https://www.anaf.ro/anaf/internet/SPV/
2. Autentificați-vă cu certificatul digital
3. Mergeți la **"Administrare drepturi"** → adăugați rolul **e-Factura** pentru CIF-ul firmei

### 3. Verificare mediu

- **Mediu test**: `https://api.anaf.ro/test/FCTEL/rest/` – pentru testare fără efecte reale
- **Mediu producție**: `https://api.anaf.ro/prod/FCTEL/rest/` – pentru facturi reale B2B

> ⚠️ **IMPORTANT**: Parametrii exacți (`client_id`, `client_secret`, IP-ul înregistrat)
> se obțin exclusiv din portalul ANAF după înregistrare. Fără acești parametri,
> modulul nu poate funcționa.

---

## Configurare IP extern / port-forwarding {#configurare-ip-extern}

### Problemă: Server local cu port-forwarding

Când aplicația rulează pe o rețea locală (ex: `192.168.50.x`) dar este accesibilă
din internet prin port-forwarding, apar două probleme:

1. **redirect_uri**: ANAF trebuie să poată accesa această adresă. IP-ul local (`192.168.x.x`)
   nu este accesibil din internet. Trebuie folosit IP-ul **extern** (public) al routerului.

2. **SSL/HTTPS**: ANAF impune HTTPS pentru `redirect_uri`. Dacă serverul rulează HTTP,
   trebuie implementat SSL termination.

### Soluție recomandată

#### Opțiunea 1: Direct cu certificat SSL pe serverul Node.js

```bash
# Generați certificat self-signed (pentru test)
mkdir -p certs
openssl req -x509 -newkey rsa:4096 \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/C=RO/ST=Bucuresti/O=Firma/CN=IP_EXTERN" \
  -addext "subjectAltName=IP:IP_EXTERN"
```

Serverul va porni automat pe HTTPS dacă `certs/key.pem` și `certs/cert.pem` există.

#### Opțiunea 2: Reverse proxy nginx cu SSL (recomandat pentru producție)

```nginx
server {
    listen 443 ssl;
    server_name mydomeniu.ro;  # sau IP extern

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Apoi în `.env`: `TRUST_PROXY=1`

#### Opțiunea 3: Let's Encrypt (gratuit, domeniu necesar)

```bash
certbot --nginx -d mydomeniu.ro
```

### Configurare redirect_uri

Înregistrați la ANAF și configurați în aplicație:

```
https://IP_EXTERN_SAU_DOMENIU:PORT/api/efactura-v2/oauth/callback
```

**Exemplu**: Dacă IP-ul extern al routerului este `85.120.50.10` și aveți port-forwarding pe 5000:
```
https://85.120.50.10:5000/api/efactura-v2/oauth/callback
```

---

## Configurare modul în aplicație {#configurare-aplicatie}

### 1. Setați variabilele de mediu în `server/.env`

```env
# URL extern pentru redirect OAuth2 (IP/domeniu public)
PUBLIC_URL=https://IP_EXTERN:5000

# Activare trust proxy (dacă sunteți în spatele nginx sau router NAT)
TRUST_PROXY=1
```

### 2. Configurați setările SPV-V2 din interfață

Accesați `PUT /api/efactura-v2/settings` cu:

```json
{
  "cif": "RO12345678",
  "clientId": "client_id_de_la_anaf",
  "clientSecret": "client_secret_de_la_anaf",
  "redirectUri": "https://IP_EXTERN:5000/api/efactura-v2/oauth/callback",
  "environment": "test"
}
```

> **Notă**: `redirectUri` trebuie să coincidă **exact** (caracter cu caracter) cu
> cel înregistrat în portalul ANAF. Orice diferență (slash final, protocol, port)
> va cauza eroarea `access_denied`.

---

## Flux OAuth2 complet {#flux-oauth2}

```
Utilizator → Browser
     │
     ▼
GET /api/efactura-v2/oauth/authorize
     │
     │  Returnează: { authUrl: "https://logincert.anaf.ro/...?code=...&state=..." }
     │
     ▼
Browser deschide authUrl → Utilizatorul se autentifică cu certificat la ANAF
     │
     ▼
ANAF redirectează → GET /api/efactura-v2/oauth/callback?code=XXX&state=YYY
     │
     │  Serverul verifică state (anti-CSRF)
     │  Schimbă code → access_token (POST la ANAF cu Content-Type: x-www-form-urlencoded)
     │  Salvează token + refresh_token în DB
     │
     ▼
Browser redirectat → Frontend (?oauth_success=1)
     │
     ▼
Acum se pot face apeluri autentificate la ANAF (upload, status, etc.)
```

### Schimb token (detalii tehnice)

```http
POST https://logincert.anaf.ro/anaf-oauth2/v1/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code
&code=<cod_unic_de_o_singura_folosinta>
&redirect_uri=<exact_aceeasi_ca_la_authorize>
&client_id=<client_id>
&client_secret=<client_secret>
```

> ⚠️ **Codul de autorizare este valid O SINGURĂ DATĂ** și expiră în ~60 secunde.
> Nu îl refaceți/refolosiți la erori de rețea.

---

## Endpoint-uri API {#endpoints-api}

### Setări

| Metodă | Cale | Descriere |
|--------|------|-----------|
| `GET`  | `/api/efactura-v2/settings` | Citire setări curente |
| `PUT`  | `/api/efactura-v2/settings` | Salvare setări |
| `GET`  | `/api/efactura-v2/status` | Stare rapidă modul |
| `GET`  | `/api/efactura-v2/action-log` | Jurnal acțiuni |

### OAuth2

| Metodă | Cale | Descriere |
|--------|------|-----------|
| `GET`  | `/api/efactura-v2/oauth/authorize` | Generare URL autorizare ANAF |
| `GET`  | `/api/efactura-v2/oauth/callback` | Callback public redirect ANAF |
| `POST` | `/api/efactura-v2/oauth/refresh` | Reînnoire token cu refresh_token |
| `GET`  | `/api/efactura-v2/oauth/diagnostic` | Diagnostic configurare OAuth2 |

### eFactură ANAF (necesită token valid)

| Metodă | Cale | Descriere |
|--------|------|-----------|
| `POST` | `/api/efactura-v2/upload/:invoiceId` | Încărcare factură în SPV |
| `GET`  | `/api/efactura-v2/check-status/:invoiceId` | Verificare stare mesaj SPV |
| `GET`  | `/api/efactura-v2/download/:invoiceId` | Descărcare răspuns ZIP ANAF |
| `GET`  | `/api/efactura-v2/xml/:invoiceId` | Previzualizare XML UBL generat |
| `GET`  | `/api/efactura-v2/messages` | Lista mesaje SPV (primite/emise) |
| `GET`  | `/api/efactura-v2/download-message/:id` | Descărcare mesaj specific |
| `GET`  | `/api/efactura-v2/local-messages` | Mesaje cacheate local |
| `POST` | `/api/efactura-v2/upload-batch` | Încărcare lot facturi |
| `POST` | `/api/efactura-v2/check-status-batch` | Verificare stare lot |

---

## Variabile de mediu {#variabile-de-mediu}

| Variabilă | Descriere | Exemplu |
|-----------|-----------|---------|
| `PUBLIC_URL` | URL extern accesibil de pe internet | `https://85.120.50.10:5000` |
| `FRONTEND_URL` | URL frontend (pentru redirect OAuth2) | `https://85.120.50.10:5173` |
| `TRUST_PROXY` | Activare trust proxy (NAT/port-forwarding) | `1` |
| `PORT` | Port server | `5000` |

---

## Depanare probleme frecvente {#depanare}

### `access_denied` la autorizare

Aceasta este cea mai frecventă problemă la integrarea ANAF OAuth2. ANAF **nu oferă descriere suplimentară** pentru `access_denied`, deci diagnosticarea necesită verificarea sistematică a tuturor cauzelor posibile.

**Checklist complet de diagnosticare:**

```
□ 1. redirect_uri înregistrată în portalul ANAF coincide 100% cu cea din aplicație?
       → Verificați caracter cu caracter: protocol, host, port, cale, trailing slash
       → Accesați: GET /api/efactura-v2/oauth/diagnostic → verificați câmpurile redirectUriIssues și redirectUriMismatchWithLastAuthorize

□ 2. Aplicația OAuth2 este activată/aprobată în portalul ANAF?
       → Pași: https://logincert.anaf.ro → Aplicații OAuth2 → verificați statusul aplicației
       → Dacă statusul e "în așteptare" sau "suspendată" → contactați ANAF pentru activare

□ 3. CIF-ul utilizat la autentificare are rolul e-Factura activat în SPV?
       → Pași: https://www.anaf.ro/anaf/internet/SPV/ → Administrare drepturi → rol e-Factura

□ 4. CIF-ul din setările aplicației coincide cu CIF-ul din certificatul digital?
       → Verificați câmpul CIF din setările SPV-V2

□ 5. Certificatul digital este valid (neexpirat) și emis de o autoritate recunoscută de ANAF?

□ 6. IP-ul serverului (din redirect_uri) este accesibil de pe internet?
       → Testați: curl -k https://IP_EXTERN:PORT/api/health
```

**Erori frecvente în redirect_uri (generează access_denied):**

| Problemă | Exemplu greșit | Exemplu corect |
|----------|---------------|----------------|
| Trailing slash diferit | `https://1.2.3.4:5000/api/efactura-v2/oauth/callback/` | `https://1.2.3.4:5000/api/efactura-v2/oauth/callback` |
| HTTP în loc de HTTPS | `http://1.2.3.4:5000/api/efactura-v2/oauth/callback` | `https://1.2.3.4:5000/api/efactura-v2/oauth/callback` |
| Port diferit | `https://1.2.3.4:5001/...` (în setări) vs port 5000 înregistrat la ANAF | Asigurați-vă că portul coincide exact |
| IP intern în loc de extern | `https://192.168.1.10:5000/...` | `https://85.120.50.10:5000/...` |
| Cale diferită | `/api/efactura-v2/callback` | `/api/efactura-v2/oauth/callback` |

**Pași de confirmare în portalul ANAF (obligatoriu la prima utilizare):**

1. Accesați https://logincert.anaf.ro cu certificatul digital
2. Mergeți la **Aplicații OAuth2** → selectați aplicația dvs.
3. Verificați că statusul este **"Activă"** (nu "în așteptare" sau "suspendată")
4. Verificați că **redirect_uri înregistrată** coincide **exact** cu cea din setările aplicației
5. Dacă aplicația nu este activă, contactați ANAF la helpdesk sau prin SPV pentru deblocare
6. După activare, reluați complet fluxul OAuth2 (nu reutilizați coduri vechi)

> ⚠️ **IMPORTANT**: ANAF poate cere confirmarea manuală a aplicației OAuth2 din partea unui
> administrator. Verificați inbox-ul SPV și email-ul asociat contului pentru notificări de la ANAF.

**Verificare diagnostică rapidă:**

```bash
# Verificați configurarea curentă și detectați probleme automat
curl -s http://localhost:5000/api/efactura-v2/oauth/diagnostic | jq .

# Câmpurile importante de verificat:
#   redirectUriIssues              – probleme detectate cu redirect_uri curentă
#   redirectUriMismatchWithLastAuthorize – diferențe față de ultima autorizare
#   redirectUriUsedAtLastAuthorize – exact ce redirect_uri a fost trimis la ANAF
#   hints                          – sugestii generate automat
```

**Citire log-uri server (după o tentativă eșuată):**

```bash
# Căutați în log-uri blocul de diagnosticare pentru access_denied:
# [SPV-V2] *** OAuth2 callback access_denied de la ANAF ***
# Acesta conține redirect_uri_used_at_authorize și redirect_uri_in_settings
# pentru comparare directă.
```

### `ERR_CERT_AUTHORITY_INVALID` în browser

Serverul rulează cu certificat self-signed. Pentru a rezolva:
- Importați certificatul ca trusted în OS/browser (pentru dev)
- Sau folosiți un certificat valid (Let's Encrypt) pentru producție

### Server accesibil local dar nu din exterior (port-forwarding)

1. Verificați că port-forwarding este configurat corect în router (portul 5000 → IP intern)
2. Verificați că firewall-ul serverului permite conexiuni pe portul 5000
3. Testați cu: `curl -k https://IP_EXTERN:5000/api/health`
4. Asigurați-vă că `redirect_uri` folosește IP-ul **extern** (al routerului), nu cel intern

### Token expirat

Apelați `POST /api/efactura-v2/oauth/refresh` pentru reînnoire automată cu refresh_token.

Dacă refresh_token lipsește sau a expirat și el, trebuie reluată autorizarea OAuth2 complet.

### `state` invalid (eroare CSRF)

Apare când se accesează callback-ul direct sau după refresh de pagină.
Reluați fluxul de la `GET /api/efactura-v2/oauth/authorize`.

### Eroare la pornire server: `better-sqlite3` native module

Dacă serverul nu pornește cu eroarea:
```
Error: .../better-sqlite3.node: cannot open shared object file
```

Reconstruiți modulul nativ pentru versiunea curentă de Node.js:
```bash
cd server
npm run rebuild
npm start
```

