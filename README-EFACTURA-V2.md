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
9. [Mutual TLS – Certificat digital ANAF](#mutual-tls)
10. [Token hardware USB – Soluții alternative](#usb-token)

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
[Mutual TLS: backend prezintă certificat digital calificat în conexiunea HTTPS]

grant_type=authorization_code
&code=<cod_unic_de_o_singura_folosinta>
&redirect_uri=<exact_aceeasi_ca_la_authorize>
&client_id=<client_id>
&client_secret=<client_secret>
```

> ⚠️ **Codul de autorizare este valid O SINGURĂ DATĂ** și expiră în ~60 secunde.
> Nu îl refaceți/refolosiți la erori de rețea.

> ⚠️ **Mutual TLS obligatoriu**: Backend-ul trebuie să prezinte certificatul digital calificat
> la conexiunea HTTPS cu `logincert.anaf.ro`. Configurați `ANAF_CERT_PATH` și `ANAF_KEY_PATH`
> în `server/.env`. Fără mTLS, ANAF returnează `HTTP 500 Internal server error`.

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
| `ANAF_CERT_PATH` | Cale absolută spre fișierul certificat PEM (mTLS) | `/etc/anaf-certs/cert.pem` |
| `ANAF_KEY_PATH` | Cale absolută spre fișierul cheie privată PEM (mTLS) | `/etc/anaf-certs/key.pem` |
| `ANAF_CERT_PASSPHRASE` | Parola cheii private (dacă e criptată) – opțional | `parola_secreta` |

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

### HTTP 500 la schimb token ANAF (`/token`)

**Aceasta este cea mai frecventă cauză de eșec după ce autorizarea (login cu certificat) a reușit.**

Serverul ANAF (`logincert.anaf.ro`) impune **Mutual TLS** – backend-ul trebuie să prezinte certificatul digital calificat la fiecare request POST `/token`. Fără acest certificat, ANAF returnează `500 Internal Server Error` indiferent de corectitudinea celorlalți parametri.

**Checklist de rezolvare:**

```
□ 1. Verificați log-ul serverului imediat după tentativa de token exchange:
       [SPV-V2] ⚠️  MUTUAL TLS NECONFIGURAT ...
     Dacă apare acest mesaj, mTLS nu este configurat → continuați cu pașii de mai jos.

□ 2. Verificați că variabilele ANAF_CERT_PATH și ANAF_KEY_PATH sunt setate în server/.env:
       ANAF_CERT_PATH=/cale/absoluta/certificat.pem
       ANAF_KEY_PATH=/cale/absoluta/cheie_privata.pem

□ 3. Verificați că fișierele .pem există și sunt citibile de procesul Node.js:
       ls -la /cale/catre/certificat.pem /cale/catre/cheie_privata.pem

□ 4. Verificați că log-ul serverului afișează mesajul de succes la pornire:
       [SPV-V2] ✅ Certificat digital mTLS încărcat cu succes pentru autentificarea la ANAF.

□ 5. Dacă log-ul afișează eroare la citirea fișierelor, verificați permisiunile:
       chmod 600 /cale/catre/cheie_privata.pem
       chmod 644 /cale/catre/certificat.pem
       chown <user-node> /cale/catre/*.pem
```

Vedeți secțiunea completă **[Mutual TLS](#mutual-tls)** pentru instrucțiuni detaliate.

### HTTP 400 „grant_type missing" deși parametrii există în payload

**Cauza**: Serverul ANAF nu parsează corect body-urile `application/x-www-form-urlencoded` trimise cu `Transfer-Encoding: chunked` (comportamentul implicit al Node.js `https.request` când `Content-Length` lipsește). Rezultatul este că ANAF nu „vede" niciun parametru în body și raportează `"Required parameter (grant_type) is missing"`.

**Fix aplicat** (v. `server/routes/efactura-v2.js`, funcția `fetchMtls`): header-ul `Content-Length` este calculat și adăugat automat la fiecare request POST, forțând transmisia fără chunked encoding.

Dacă mai apare această eroare după actualizare, verificați că:
- Nu există un proxy invers (nginx/apache) care să re-encodeze body-ul în modul chunked
- Certificatul mTLS este configurat (fără mTLS, ANAF poate refuza parsarea body-ului)

### Eroare la upload factură în SPV ANAF (token obținut din Postman)

Dacă ați importat cu succes tokenul din Postman, dar la upload primiți eroare, verificați:

| Cod HTTP ANAF | Cauza probabilă | Soluție |
|---|---|---|
| 401 Unauthorized | Token invalid, expirat sau format greșit | Reimportați tokenul proaspăt din Postman; nu includeți prefixul `Bearer ` |
| 403 Forbidden | CIF-ul din setări nu corespunde tokenului sau aplicația ANAF nu are drept de upload | Verificați câmpul CIF din setările SPV-V2 |
| 415 Unsupported Media Type | XML-ul nu este acceptat de ANAF în formatul trimis | Verificați că factura are toate câmpurile necesare |
| 422 Unprocessable Entity | Date XML invalide respinse de ANAF | Verificați conținutul facturii (dată, sume, CIF etc.) |
| 500 Server Error | Eroare internă ANAF (de obicei tranzitorie) | Așteptați și reîncercați |

**Cum să vedeți detaliile erorii:**
1. Eroarea afișată în UI include acum codul HTTP ANAF (`[ANAF HTTP 401]` etc.) și detalii din body-ul răspunsului.
2. Log-ul serverului afișează explicit: `[SPV-V2] ❌ Upload factură eșuat – răspuns ANAF: { httpStatus, body, ... }`.
3. Verificați consola serverului (`npm start` sau `pm2 logs`) pentru detalii complete.

**Tokenul din Postman – ce funcționează și ce nu:**
- ✅ **Funcționează**: Token obținut în Postman cu „Authorize using Browser" (browserul prezintă certificatul USB, Postman face POST /token cu certificatul configurat în Settings → Certificates), importat ca JSON complet sau doar `access_token` în aplicație.
- ✅ **Funcționează**: Token obținut cu `curl --cert cert.pem --key key.pem`, importat în aplicație.
- ✅ **Funcționează**: Prefixul `Bearer ` este eliminat automat dacă este inclus accidental la import.
- ❌ **Nu funcționează**: Token obținut prin backend fără mTLS configurat (ANAF returnează 500).
- ❌ **Nu funcționează**: Token expirat (implicit 1 oră de la emitere; verificați `expires_in` din răspunsul ANAF).

---

## Configurare Mutual TLS (certificat digital ANAF) {#mutual-tls}

### De ce este necesar Mutual TLS?

Serverul ANAF (`logincert.anaf.ro`) folosește **Mutual TLS (mTLS)** pentru autentificarea aplicațiilor la endpoint-ul `/token`. Aceasta înseamnă că:

- Browserul prezintă certificatul digital calificat al utilizatorului la pasul de login (gestionat automat de browser + token USB)
- **Backend-ul trebuie să prezinte același certificat** la apelul POST `/token` (schimb code → access_token)

Fără certificat la nivel de conexiune HTTPS a backend-ului, ANAF returnează `HTTP 500 Internal server error`.

### Obținerea fișierelor PEM din certificatul digital

#### Din fișier .p12 (PKCS#12):

```bash
# Exportați certificatul (public)
openssl pkcs12 -in certificat.p12 -clcerts -nokeys -out /etc/anaf-certs/cert.pem
# Introduceți parola .p12 când e cerută

# Exportați cheia privată (fără parolă pe fișier)
openssl pkcs12 -in certificat.p12 -nocerts -nodes -out /etc/anaf-certs/key.pem
# Introduceți parola .p12 când e cerută

# Sau exportați cheia privată CU parolă (mai sigur):
openssl pkcs12 -in certificat.p12 -nocerts -out /etc/anaf-certs/key.pem
# Setați ANAF_CERT_PASSPHRASE în .env cu parola folosită
```

#### Din token USB / smart card (dacă nu aveți .p12):

Contactați furnizorul certificatului digital (ex: certSIGN, DigiSign, Trans Sped) pentru export în format PEM sau PKCS#12.

### Configurare fișiere și permisiuni

```bash
# Creați directorul pentru certificate
mkdir -p /etc/anaf-certs
chmod 700 /etc/anaf-certs

# Copiați fișierele PEM
cp certificat.pem /etc/anaf-certs/cert.pem
cp cheie_privata.pem /etc/anaf-certs/key.pem

# Setați permisiunile corecte (citibile doar de utilizatorul Node.js)
chmod 600 /etc/anaf-certs/key.pem
chmod 644 /etc/anaf-certs/cert.pem
chown <utilizator-node> /etc/anaf-certs/cert.pem /etc/anaf-certs/key.pem
```

> ⚠️ **IMPORTANT**: Nu stocați fișierele .pem în directorul aplicației sau în repository!
> Adăugați `*.pem`, `*.p12`, `certs/` în `.gitignore`.

### Configurare variabile de mediu

Adăugați în `server/.env`:

```env
# Mutual TLS – Certificat digital calificat ANAF (obligatoriu pentru POST /token)
ANAF_CERT_PATH=/etc/anaf-certs/cert.pem
ANAF_KEY_PATH=/etc/anaf-certs/key.pem
# ANAF_CERT_PASSPHRASE=parola_daca_cheia_este_criptata
```

> **Notă**: `ANAF_CERT_PASSPHRASE` este opțional – completați-l doar dacă fișierul `key.pem`
> a fost generat cu parolă (opțiunea `-out` fără `-nodes` în openssl).
> Dacă cheia este necriptată (`-nodes` folosit la export), lăsați comentat sau gol.

### Verificare configurare

```bash
# Reporniți serverul și verificați log-ul de start:
npm start 2>&1 | grep -E "\[SPV-V2\].*mTLS|certificat"

# Mesaj de succes așteptat:
# [SPV-V2] ✅ Certificat digital mTLS încărcat cu succes pentru autentificarea la ANAF.

# Mesaj de eroare (variabile lipsă):
# [SPV-V2] ⚠️  MUTUAL TLS NECONFIGURAT – variabilele ANAF_CERT_PATH și ANAF_KEY_PATH lipsesc...

# Mesaj de eroare (fișiere inaccesibile):
# [SPV-V2] ❌ Eroare la încărcarea certificatelor mTLS pentru ANAF: ...
```

### Testare cu curl (verificare mTLS independent)

```bash
# Test schimb token cu certificat (înlocuiți valorile)
curl -v \
  --cert /etc/anaf-certs/cert.pem \
  --key /etc/anaf-certs/key.pem \
  -X POST https://logincert.anaf.ro/anaf-oauth2/v1/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \
  -d "grant_type=authorization_code&code=COD_PRIMIT&redirect_uri=REDIRECT_URI&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"

# Dacă curl returnează 200 → mTLS funcționează corect
# Dacă returnează 500 fără --cert → confirmat că mTLS este necesar
# Dacă returnează 500 și cu --cert → verificați validitatea/expirarea certificatului
```

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

---

## Token hardware USB – Soluții alternative {#usb-token}

### Limitare tehnică – de ce eșuează mTLS din backend cu token hardware USB

Serverul ANAF (`logincert.anaf.ro`) solicită **Mutual TLS (mTLS)** la fiecare apel `POST /token`.
Aceasta înseamnă că serverul Node.js trebuie să prezinte un **certificat digital calificat** la nivelul conexiunii HTTPS.

**Problema cu token-ul hardware USB:**

- Cheia privată a unui certificat pe token hardware (SafeNet, eToken, IDPrime etc.) **nu poate fi exportată** din dispozitiv – aceasta este o măsură de securitate fundamentală.
- Serverul Node.js backend rulează pe un VPS/server remote. Tokenul USB este conectat la calculatorul **utilizatorului** (client), nu la server.
- Node.js nu poate accesa direct PKCS#11 (interfața pentru token-uri hardware) fără integrare nativă complexă (openssl engine pkcs11, node-pkcs11).
- Prin urmare, **serverul NU poate prezenta automat certificatul de pe tokenul USB al utilizatorului** la POST /token.

**De ce funcționează în Postman cu „Authorize using Browser"?**

1. Postman deschide browserul pentru URL-ul de autorizare ANAF (`/authorize`).
2. Browserul face mTLS cu ANAF folosind certificatul din depozitul de certificate al OS (Windows Certificate Store / macOS Keychain) – **acesta este locul unde driverul tokenului USB înregistrează certificatul**.
3. Utilizatorul selectează certificatul și introduce PIN-ul.
4. ANAF redirectează cu codul de autorizare.
5. **Postman** (nu browserul!) face `POST /token` cu mTLS – Postman are certificate configurate explicit în Settings → Certificates (PEM sau PKCS#12).

Deci Postman funcționează datorită a **două** componente: browserul (pentru `/authorize`) + Postman nativ (pentru `/token` cu certificat configurat explicit).

---

### Soluții funcționale pentru utilizatorii cu token hardware USB

#### Opțiunea 1: Postman (recomandat) – flux complet cu import JSON

**Condiție**: Postman instalat pe același calculator unde este conectat tokenul USB.

**Pași:**

1. Deschideți Postman → **Settings (⚙)** → **Certificates** → **Add Certificate**:
   - Host: `logincert.anaf.ro`
   - Adăugați `cert.pem` și `key.pem` (sau fișier `.p12`/`.pfx` + passphrase)
   - Dacă nu aveți fișiere, exportați certificatul din token (dacă tokenul permite) sau obțineți de la autoritatea emitentă

2. Creați un nou request → **Authorization** → Type: **OAuth 2.0** → **Get New Access Token**:
   ```
   Grant Type:         Authorization Code
   Callback URL:       https://IP_EXTERN:PORT/api/efactura-v2/oauth/callback
   Auth URL:           https://logincert.anaf.ro/anaf-oauth2/v1/authorize
   Access Token URL:   https://logincert.anaf.ro/anaf-oauth2/v1/token
   Client ID:          [client_id din ANAF]
   Client Secret:      [client_secret din ANAF]
   Scope:              offline_access
   ```

3. **Bifați „Authorize using Browser"** (esențial pentru selectarea certificatului din token)

4. Apăsați **„Request Token"** → browserul se deschide → selectați certificatul → introduceți PIN-ul

5. Postman obține tokenul. Copiați răspunsul JSON complet din **„Token Details"**:
   ```json
   {
     "access_token": "eyJ...",
     "token_type": "Bearer",
     "refresh_token": "eyJ...",
     "expires_in": 3600
   }
   ```

6. În aplicație → **Configurare OAuth2 V2** → tab **„Token USB / Postman"** → lipiți JSON-ul → **„Importă token"**

**Referință**: [Generating an Authorization Token in Romania's ANAF Portal using Postman](https://community.sap.com/t5/technology-blog-posts-by-sap/generating-an-authorization-token-in-romania-s-anaf-portal-using-postman/ba-p/13577060)

---

#### Opțiunea 2: Import direct via API (curl / Postman spre aplicație)

Dacă ați obținut tokenul prin orice mijloace (Postman, curl, alt tool), îl puteți importa direct via API:

```bash
curl -X POST https://IP_EXTERN:PORT/api/efactura-v2/oauth/token-import \
  -H "Content-Type: application/json" \
  -d '{
    "access_token":  "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in":    3600,
    "token_type":    "Bearer"
  }'
```

Sau doar `access_token`:
```bash
curl -X POST https://IP_EXTERN:PORT/api/efactura-v2/oauth/token-import \
  -H "Content-Type: application/json" \
  -d '{"access_token": "eyJ..."}'
```

---

#### Opțiunea 3: Fișiere PEM pe server (soluție permanentă)

Dacă tokenul hardware USB permite exportul cheii private (unele token-uri permit cu PIN):

```bash
# Export din token PKCS#12 (P12) – introduceți parola token-ului când este cerută
openssl pkcs12 -in certificat_din_token.p12 -clcerts -nokeys -out /etc/anaf-certs/cert.pem
openssl pkcs12 -in certificat_din_token.p12 -nocerts -nodes  -out /etc/anaf-certs/key.pem

# Copiați fișierele securizat pe server:
scp cert.pem key.pem user@server:/etc/anaf-certs/

# Configurați în server/.env:
ANAF_CERT_PATH=/etc/anaf-certs/cert.pem
ANAF_KEY_PATH=/etc/anaf-certs/key.pem

# Reporniți serverul:
npm --prefix server start
```

> ⚠️ **Atenție la securitate**: Dacă exportul cheii private este posibil, depozitați fișierele cu permisiuni restrictive (`chmod 600`) și nu le includeți în repository.

---

#### Opțiunea 4: Token temporar (refresh automat)

Dacă tokenul ANAF include `refresh_token` (cerere cu scope `offline_access`), aplicația poate reînnoi automat `access_token` fără intervenție manuală timp de mai multe luni.

Fluxul recomandat:
1. Obțineți tokenul inițial via Postman (o singură dată)
2. Importați-l cu `refresh_token` inclus
3. Aplicația va folosi `POST /api/efactura-v2/oauth/refresh` automat pentru reînnoire

> **Notă**: `refresh_token` are de obicei o valabilitate de 6-12 luni la ANAF. Verificați documentația ANAF pentru termenii exacți.

---

### Verificare stare mTLS

```bash
curl https://IP_EXTERN:PORT/api/efactura-v2/oauth/mtls-status
```

Răspuns când mTLS **este** configurat:
```json
{"mtlsConfigured": true, "certPathSet": true, "keyPathSet": true, "hint": "mTLS configurat – schimbul de token se va efectua automat."}
```

Răspuns când mTLS **nu este** configurat:
```json
{"mtlsConfigured": false, "certPathSet": false, "keyPathSet": false, "hint": "mTLS neconfigurat. Dacă aveți certificatul ca fișier PEM/PFX..."}
```

