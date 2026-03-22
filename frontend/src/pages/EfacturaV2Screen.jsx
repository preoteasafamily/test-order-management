/**
 * EfacturaV2Screen.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Ecranul principal pentru modulul E-Factura SPV-V2.
 *
 * Acest modul este o versiune separată de E-Factura SPV (V1), concepută
 * special pentru integrarea cu ANAF prin IP extern / port-forwarding.
 *
 * Diferențe față de V1:
 *  - Folosește prefix-ul API `/api/efactura-v2/` (endpoint-uri dedicate V2)
 *  - Setările OAuth2 sunt stocate separat în `spv_v2_settings`
 *  - Suportă câmpul `publicCallbackUrl` pentru redirect URI public (IP extern)
 *  - Endpoint-ul check-status folosește GET (nu POST ca în V1)
 *  - Token-ul și configurările nu sunt partajate cu modulul V1
 *
 * Documentație: README-EFACTURA-V2.md din rădăcina proiectului.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Upload,
  RefreshCw,
  Download,
  Settings,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  FileCode,
  ChevronDown,
  ChevronUp,
  Send,
  Inbox,
  Eye,
  X,
  Info,
  Key,
  ExternalLink,
  ShieldCheck,
  BookOpen,
  Copy,
  Globe,
  Shield,
  Clipboard,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────
/** Configurație vizuală pentru fiecare stare posibilă a unei facturi în SPV. */
const STATUS_CONFIG = {
  none:       { label: "Neîncărcat",    color: "bg-gray-100 text-gray-600",    icon: Clock },
  uploading:  { label: "Se încarcă…",   color: "bg-blue-100 text-blue-700",    icon: RefreshCw },
  uploaded:   { label: "Transmisă",     color: "bg-cyan-100 text-cyan-700",    icon: Send },
  processing: { label: "În prelucrare", color: "bg-yellow-100 text-yellow-700",icon: Clock },
  validated:  { label: "Validată ✓",    color: "bg-green-100 text-green-700",  icon: CheckCircle },
  rejected:   { label: "Respinsă ✗",   color: "bg-red-100 text-red-700",      icon: XCircle },
  error:      { label: "Eroare",        color: "bg-orange-100 text-orange-700",icon: AlertTriangle },
};

/** Insignă colorată pentru starea SPV a unei facturi. */
const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.none;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
};

// ─── Response detail modal ────────────────────────────────────────────────────
/** Modal cu detalii complete despre răspunsul ANAF pentru o factură. */
const ResponseModal = ({ invoice, onClose }) => {
  if (!invoice) return null;
  let parsed = null;
  if (invoice.spv_response) {
    try { parsed = JSON.parse(invoice.spv_response); } catch { parsed = invoice.spv_response; }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-500" />
            Răspuns ANAF SPV-V2 – {invoice.invoice_code || invoice.id}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto flex-1 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Stare:</span> <StatusBadge status={invoice.spv_status} /></div>
            <div><span className="text-gray-500">ID încărcare:</span> <code className="bg-gray-100 px-1 rounded">{invoice.spv_upload_id || "—"}</code></div>
            <div><span className="text-gray-500">ID descarcare:</span> <code className="bg-gray-100 px-1 rounded">{invoice.spv_download_id || "—"}</code></div>
            <div><span className="text-gray-500">Încărcat la:</span> {invoice.spv_uploaded_at ? new Date(invoice.spv_uploaded_at).toLocaleString("ro-RO") : "—"}</div>
          </div>
          {parsed && (
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">Răspuns complet ANAF:</p>
              <pre className="bg-gray-50 border rounded p-3 text-xs overflow-auto whitespace-pre-wrap">
                {typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}
              </pre>
            </div>
          )}
          {!parsed && <p className="text-gray-400 text-sm">Nu există răspuns înregistrat.</p>}
        </div>
      </div>
    </div>
  );
};

// ─── Settings panel ───────────────────────────────────────────────────────────
/**
 * Panou de configurare OAuth2 pentru modulul SPV-V2.
 *
 * Stochează setările separat față de V1 (tabel `spv_v2_settings`).
 * Suportă câmpul suplimentar `publicCallbackUrl` pentru IP extern.
 */
const SettingsPanelV2 = ({ API_URL, onClose, onSaved, defaultTab = "oauth" }) => {
  const [settingsTab, setSettingsTab] = useState(defaultTab);
  const [form, setForm] = useState({
    cif: "", token: "", tokenExpiresAt: "", environment: "test",
    clientId: "", clientSecret: "", redirectUri: "", publicCallbackUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [mtlsConfigured, setMtlsConfigured] = useState(null);

  // State pentru importul tokenului JSON (tab USB Token)
  const [tokenJson, setTokenJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  /**
   * Redirect URI recomandat pentru V2 – folosește IP-ul/domeniul public al
   * serverului (origin-ul curent), nu cel local.
   * Trebuie înregistrat exact la ANAF (fără slash final).
   */
  const recommendedRedirectUri = `${window.location.origin}/api/efactura-v2/oauth/callback`;

  useEffect(() => {
    fetch(`${API_URL}/api/efactura-v2/settings`)
      .then(r => r.json())
      .then(d => {
        setForm({
          cif:              d.cif            || "",
          token:            d.token          || "",
          tokenExpiresAt:   d.tokenExpiresAt || "",
          environment:      d.environment    || "test",
          clientId:         d.clientId       || "",
          clientSecret:     "",              // Nu returnăm secretul; afișăm doar dacă există
          redirectUri:      d.redirectUri    || "",
          publicCallbackUrl: d.publicCallbackUrl || "",
        });
        setHasRefreshToken(!!d.hasRefreshToken);
        setHasClientSecret(!!d.hasClientSecret);
      })
      .catch(() => {});
    // Verificare stare mTLS (certificat digital pentru backend)
    fetch(`${API_URL}/api/efactura-v2/oauth/mtls-status`)
      .then(r => r.json())
      .then(d => setMtlsConfigured(d.mtlsConfigured))
      .catch(() => setMtlsConfigured(false));
  }, [API_URL]);

  /** Salvează setările SPV-V2 pe server. */
  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload = { ...form };
      // Nu trimite client_secret gol (evită suprascrierea accidentală)
      if (!payload.clientSecret) delete payload.clientSecret;
      const r = await fetch(`${API_URL}/api/efactura-v2/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) { setMsg({ type: "success", text: "Setări V2 salvate cu succes." }); onSaved?.(); }
      else { const e = await r.json(); setMsg({ type: "error", text: e.error || "Eroare la salvare." }); }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    finally { setSaving(false); }
  };

  /** Inițiază fluxul OAuth2 ANAF pentru V2 (salvează setările, deschide fereastra ANAF). */
  const startAuthorization = async () => {
    setAuthorizing(true);
    setMsg(null);
    try {
      const payload = { ...form };
      if (!payload.clientSecret) delete payload.clientSecret;
      await fetch(`${API_URL}/api/efactura-v2/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const r = await fetch(`${API_URL}/api/efactura-v2/oauth/authorize`);
      const data = await r.json();
      if (!r.ok) { setMsg({ type: "error", text: data.error || "Eroare la generare URL autorizare." }); return; }
      window.open(data.authUrl, "_blank", "width=900,height=700,noopener");
      setMsg({ type: "success", text: "Fereastra de autorizare ANAF s-a deschis. Autentificați-vă cu certificatul digital, apoi reveniți aici." });
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    finally { setAuthorizing(false); }
  };

  /** Reîmprospătează access token-ul V2 folosind refresh token-ul salvat. */
  const refreshToken = async () => {
    setRefreshing(true);
    setMsg(null);
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/oauth/refresh`, { method: "POST" });
      const data = await r.json();
      if (r.ok) {
        setMsg({ type: "success", text: `Token V2 reîmprospătat. Expiră la: ${data.expiresAt ? new Date(data.expiresAt).toLocaleString("ro-RO") : "necunoscut"}.` });
        onSaved?.();
        const s = await fetch(`${API_URL}/api/efactura-v2/settings`).then(x => x.json());
        setForm(f => ({ ...f, token: s.token || "", tokenExpiresAt: s.tokenExpiresAt || "" }));
        setHasRefreshToken(!!s.hasRefreshToken);
      } else {
        setMsg({ type: "error", text: data.error || "Eroare la reîmprospătare token." });
      }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    finally { setRefreshing(false); }
  };

  /** Rulează diagnosticarea configurației OAuth2 V2. */
  const runDiagnostic = async () => {
    setDiagLoading(true);
    setDiagnostic(null);
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/oauth/diagnostic`);
      setDiagnostic(await r.json());
    } catch (e) {
      setDiagnostic({ error: e.message });
    } finally {
      setDiagLoading(false);
    }
  };

  /**
   * Importă un token obținut extern (Postman, curl, etc.) via endpoint-ul /token-import.
   * Acceptă fie JSON complet {"access_token":"...","refresh_token":"...","expires_in":3600},
   * fie doar stringul access_token.
   */
  const importTokenJson = async () => {
    setImporting(true);
    setImportMsg(null);
    try {
      if (!tokenJson.trim()) {
        setImportMsg({ type: "error", text: "Introduceți tokenul sau JSON-ul complet de la ANAF." });
        return;
      }

      let payload;
      const trimmed = tokenJson.trim();

      // Încercăm să parsăm ca JSON (răspuns complet de la ANAF)
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (!parsed.access_token) {
            setImportMsg({ type: "error", text: "JSON invalid: lipsă câmp access_token." });
            return;
          }
          payload = {
            access_token:  parsed.access_token,
            refresh_token: parsed.refresh_token || "",
            expires_in:    parsed.expires_in    || 0,
            token_type:    parsed.token_type    || "Bearer",
          };
        } catch {
          setImportMsg({ type: "error", text: "JSON invalid. Verificați că ați copiat corect răspunsul complet de la ANAF." });
          return;
        }
      } else {
        // Tratăm ca access_token simplu (string)
        payload = { access_token: trimmed };
      }

      const r = await fetch(`${API_URL}/api/efactura-v2/oauth/token-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();

      if (r.ok) {
        setImportMsg({
          type: "success",
          text: `✅ Token importat cu succes!${data.expiresAt ? ` Expiră la: ${new Date(data.expiresAt).toLocaleString("ro-RO")}` : ""}${data.hasRefreshToken ? " (include refresh_token)" : ""}`,
        });
        setTokenJson("");
        onSaved?.();
        // Reîncarcă setările pentru a actualiza token-ul afișat
        const s = await fetch(`${API_URL}/api/efactura-v2/settings`).then(x => x.json());
        setForm(f => ({ ...f, token: s.token || "", tokenExpiresAt: s.tokenExpiresAt || "" }));
        setHasRefreshToken(!!s.hasRefreshToken);
      } else {
        setImportMsg({ type: "error", text: data.error || "Eroare la importul tokenului." });
      }
    } catch (e) {
      setImportMsg({ type: "error", text: e.message });
    } finally {
      setImporting(false);
    }
  };

  const tokenExpired    = form.tokenExpiresAt && new Date(form.tokenExpiresAt) < new Date();
  const tokenExpiresSoon = form.tokenExpiresAt && !tokenExpired &&
    new Date(form.tokenExpiresAt) < new Date(Date.now() + 10 * 60 * 1000);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-500" />
            Configurare SPV e-Factura V2 (IP Extern)
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs interioare */}
        <div className="flex border-b flex-shrink-0 px-4 overflow-x-auto">
          {[
            { id: "oauth",    label: "OAuth2 ANAF",          icon: ShieldCheck },
            { id: "usb",      label: "Token USB / Postman",  icon: Key },
            { id: "manual",   label: "Token manual",         icon: Clipboard },
            { id: "general",  label: "General",              icon: Settings },
            { id: "guide",    label: "Ghid V2",              icon: BookOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSettingsTab(id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                settingsTab === id
                  ? "border-blue-500 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              <Icon className="w-4 h-4" />{label}
              {id === "usb" && mtlsConfigured === false && (
                <span className="ml-1 w-2 h-2 rounded-full bg-amber-400 inline-block" title="mTLS neconfigurat – recomandăm fluxul USB Token" />
              )}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* ── OAuth2 Tab ─────────────────────────────────────────────────────── */}
          {settingsTab === "oauth" && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                <strong>🔐 E-Factura SPV-V2 – OAuth2 pentru IP Extern</strong> – Acest modul este configurat independent față de V1 și suportă IP extern / port-forwarding. Redirect URI-ul trebuie să fie accesibil din internet.
              </div>

              {/* Avertisment mTLS neconfigurat */}
              {mtlsConfigured === false && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-800">⚠ Certificat digital (mTLS) neconfigurat pe server</p>
                      <p className="text-amber-700 text-xs mt-1">
                        Serverul ANAF impune prezentarea unui certificat digital calificat la schimbul de token (<code className="bg-amber-100 px-0.5 rounded">POST /token</code>).
                        Fără certificat, ANAF returnează <strong>HTTP 500</strong> – autorizarea automată va eșua.
                      </p>
                      <p className="text-amber-700 text-xs mt-1">
                        <strong>Dacă aveți certificatul ca fișier PEM/PFX</strong>: configurați <code className="bg-amber-100 px-0.5 rounded">ANAF_CERT_PATH</code> și <code className="bg-amber-100 px-0.5 rounded">ANAF_KEY_PATH</code> în <code className="bg-amber-100 px-0.5 rounded">server/.env</code>.
                      </p>
                      <p className="text-amber-700 text-xs mt-1">
                        <strong>Dacă certificatul este pe token hardware USB</strong>:{" "}
                        <button onClick={() => setSettingsTab("usb")} className="underline font-medium text-amber-800 hover:text-amber-900">
                          folosiți fluxul Postman/curl →  tab „Token USB / Postman"
                        </button>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Redirect URI recomandat */}
              <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 text-sm">
                <p className="font-semibold text-blue-900 mb-1">⚠ Redirect URI obligatoriu în portalul ANAF</p>
                <p className="text-blue-800 text-xs mb-2">
                  Copiați exact această adresă la înregistrarea aplicației pe{" "}
                  <a href="https://logincert.anaf.ro" target="_blank" rel="noopener noreferrer" className="underline">logincert.anaf.ro</a>.
                  Dacă serverul rulează în spatele unui NAT/router, asigurați-vă că se folosește IP-ul extern (câmpul „URL Public" de mai jos).
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-blue-300 rounded px-2 py-1.5 text-xs font-mono break-all text-gray-800">
                    {recommendedRedirectUri}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(recommendedRedirectUri).then(() => {
                        setCopiedUri(true);
                        setTimeout(() => setCopiedUri(false), 2000);
                      });
                    }}
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border border-blue-300 bg-white rounded text-xs text-blue-700 hover:bg-blue-50">
                    {copiedUri ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedUri ? "Copiat!" : "Copiază"}
                  </button>
                </div>
              </div>

              {/* Token status */}
              {form.token && (
                <div className={`rounded-lg p-3 text-sm border ${
                  tokenExpired     ? "bg-red-50 border-red-200 text-red-800" :
                  tokenExpiresSoon ? "bg-yellow-50 border-yellow-200 text-yellow-800" :
                                     "bg-green-50 border-green-200 text-green-800"
                }`}>
                  <div className="flex items-center gap-2 font-medium">
                    {tokenExpired     ? <XCircle className="w-4 h-4" />      :
                     tokenExpiresSoon ? <AlertTriangle className="w-4 h-4" /> :
                                        <CheckCircle className="w-4 h-4" />}
                    {tokenExpired   ? "Token expirat – reîmprospătați sau reautorizați" :
                     tokenExpiresSoon ? "Token expiră în curând" :
                                        "Token V2 activ"}
                  </div>
                  {form.tokenExpiresAt && (
                    <p className="mt-1 text-xs opacity-80">
                      Expiră: {new Date(form.tokenExpiresAt).toLocaleString("ro-RO")}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client ID *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  placeholder="Client ID primit de la ANAF după înregistrare"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Secret *
                  {hasClientSecret && !form.clientSecret && (
                    <span className="ml-2 text-xs font-normal text-green-600">(salvat – lăsați gol pentru a păstra cel existent)</span>
                  )}
                </label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  value={form.clientSecret}
                  onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                  placeholder={hasClientSecret ? "••••••• (păstrați gol pentru a nu modifica)" : "Client Secret primit de la ANAF"}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URI *</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    value={form.redirectUri}
                    onChange={e => setForm(f => ({ ...f, redirectUri: e.target.value }))}
                    placeholder={recommendedRedirectUri}
                  />
                  {!form.redirectUri && (
                    <button
                      onClick={() => setForm(f => ({ ...f, redirectUri: recommendedRedirectUri }))}
                      className="flex-shrink-0 px-2 py-1.5 border rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                      Completează auto
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Trebuie să corespundă exact (caracter cu caracter) cu redirect_uri înregistrată în portalul ANAF.
                </p>
              </div>

              {/* URL Public pentru IP extern */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-blue-500" />
                  URL Public callback (IP extern) – opțional
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  value={form.publicCallbackUrl}
                  onChange={e => setForm(f => ({ ...f, publicCallbackUrl: e.target.value }))}
                  placeholder="ex: https://109.103.210.200:5000/api/efactura-v2/oauth/callback"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Completați dacă serverul este în spatele unui NAT/router cu port-forwarding. Aceasta este adresa accesibilă din internet pe care ANAF o poate contacta.
                </p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={startAuthorization}
                  disabled={authorizing || !form.clientId || !form.redirectUri}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {authorizing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  Autorizare ANAF (V2)
                </button>
                {hasRefreshToken && (
                  <button
                    onClick={refreshToken}
                    disabled={refreshing}
                    className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50">
                    {refreshing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Reîmprospătare token
                  </button>
                )}
                <button
                  onClick={runDiagnostic}
                  disabled={diagLoading}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                  {diagLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                  Diagnosticare configurație
                </button>
              </div>

              {/* Rezultat diagnostic */}
              {diagnostic && !diagnostic.error && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-2">
                  <p className="font-semibold text-gray-700 text-sm">🔍 Rezultat diagnosticare OAuth2 V2</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {[
                      { label: "Client ID configurat",      ok: diagnostic.hasClientId },
                      { label: "Client Secret configurat",  ok: diagnostic.hasClientSecret },
                      { label: "Redirect URI configurat",   ok: diagnostic.hasRedirectUri },
                      { label: "CIF furnizor configurat",   ok: diagnostic.hasCif },
                      { label: "Token activ",               ok: diagnostic.hasToken && diagnostic.tokenExpired === false },
                      { label: "Refresh token prezent",     ok: diagnostic.hasRefreshToken },
                    ].map(({ label, ok }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        {ok
                          ? <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                          : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        <span className={ok ? "text-gray-700" : "text-red-700 font-medium"}>{label}</span>
                      </div>
                    ))}
                  </div>
                  {diagnostic.redirectUri && (
                    <div className="pt-1">
                      <span className="text-gray-500">Redirect URI salvat: </span>
                      <code className="bg-white border rounded px-1 break-all">{diagnostic.redirectUri}</code>
                    </div>
                  )}
                  {diagnostic.redirectUriIssues && diagnostic.redirectUriIssues.length > 0 && (
                    <div className="bg-orange-50 border border-orange-200 rounded p-2 space-y-0.5">
                      <p className="font-semibold text-orange-800">⚠ Atenție – probleme detectate la Redirect URI:</p>
                      {diagnostic.redirectUriIssues.map((issue, i) => (
                        <p key={i} className="text-orange-700">• {issue}</p>
                      ))}
                    </div>
                  )}
                  {diagnostic.tokenExpired === true && (
                    <p className="text-red-700 font-medium">⚠ Token expirat – utilizați „Reîmprospătare token" sau reautorizați.</p>
                  )}
                  <p className="text-gray-400 pt-1">Verificat la: {diagnostic.checkedAt ? new Date(diagnostic.checkedAt).toLocaleString("ro-RO") : "—"}</p>
                </div>
              )}
              {diagnostic && diagnostic.error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  Eroare diagnosticare: {diagnostic.error}
                </div>
              )}
            </>
          )}

          {/* ── USB Token / Postman Tab ───────────────────────────────────────── */}
          {settingsTab === "usb" && (
            <div className="space-y-4 text-sm text-gray-700">
              {/* Explicație limită tehnică */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Shield className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-800 text-sm">⛔ Limitare tehnică – mTLS din backend cu token hardware USB</p>
                    <p className="text-red-700 text-xs mt-1">
                      Serverul ANAF (<code className="bg-red-100 px-0.5 rounded">logincert.anaf.ro</code>) solicită prezentarea certificatului digital calificat
                      la <strong>fiecare apel POST /token</strong> (Mutual TLS). Serverul Node.js backend nu poate accesa automat un certificat
                      aflat pe un token hardware USB conectat la calculatorul utilizatorului – cheia privată nu părăsește niciodată dispozitivul hardware.
                    </p>
                    <p className="text-red-700 text-xs mt-2">
                      <strong>De ce funcționează în Postman?</strong> Postman are acces nativ la certificate configurate în setările proprii sau
                      în depozitul de certificate al sistemului de operare (Windows Certificate Store / macOS Keychain). Modul „Authorize using Browser"
                      deschide browserul pentru autentificarea ANAF (selectarea certificatului), iar Postman efectuează schimbul de token
                      cu propriul certificat configurat. Aceasta este interacțiunea manuală care nu poate fi automatizată complet de pe server.
                    </p>
                  </div>
                </div>
              </div>

              {/* Soluții alternative */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="font-semibold text-green-800 text-sm mb-2">✅ Soluții funcționale pentru token hardware USB</p>
                <div className="space-y-3 text-xs text-green-800">
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-green-700 min-w-[20px]">1.</span>
                    <div>
                      <strong>Postman (recomandat)</strong> – Folosiți Postman cu setarea „Authorize using browser" + certificat configurat
                      în Postman → copiați răspunsul JSON cu tokenul → importați mai jos.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-green-700 min-w-[20px]">2.</span>
                    <div>
                      <strong>curl cu fișier PEM/PFX</strong> – Dacă puteți exporta temporar certificatul din token pe calculator,
                      folosiți comanda curl de mai jos pentru schimbul de token.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-green-700 min-w-[20px]">3.</span>
                    <div>
                      <strong>Fișiere PEM pe server</strong> – Soluție permanentă: exportați certificatul + cheia privată din token
                      (dacă tokenul permite), copiați fișierele pe server și configurați <code className="bg-green-100 px-0.5 rounded">ANAF_CERT_PATH</code>/<code className="bg-green-100 px-0.5 rounded">ANAF_KEY_PATH</code> în <code className="bg-green-100 px-0.5 rounded">server/.env</code>.
                    </div>
                  </div>
                </div>
              </div>

              {/* Ghid Postman pas cu pas */}
              <div className="border border-gray-200 rounded-lg">
                <div className="bg-gray-50 px-3 py-2 border-b rounded-t-lg">
                  <p className="font-semibold text-gray-700 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" /> Ghid Postman – pas cu pas
                  </p>
                </div>
                <ol className="p-3 space-y-3 text-xs list-decimal pl-7 text-gray-700">
                  <li>
                    <strong>Configurați certificatul în Postman</strong>: Settings (⚙) → Certificates → Add Certificate.
                    Host: <code className="bg-gray-100 px-0.5 rounded">logincert.anaf.ro</code>.
                    Adăugați fișierele <code className="bg-gray-100 px-0.5 rounded">cert.pem</code> și <code className="bg-gray-100 px-0.5 rounded">key.pem</code>{" "}
                    (sau <code className="bg-gray-100 px-0.5 rounded">.p12/.pfx</code> cu parola).
                  </li>
                  <li>
                    <strong>Creați un request OAuth2</strong>: New Request → Authorization tab → Type: <em>OAuth 2.0</em> → Get New Access Token.
                    Completați:
                    <ul className="mt-1 ml-3 list-disc space-y-0.5">
                      <li>Grant Type: Authorization Code</li>
                      <li>Callback URL: <code className="bg-gray-100 px-0.5 rounded">{window.location.origin}/api/efactura-v2/oauth/callback</code></li>
                      <li>Auth URL: <code className="bg-gray-100 px-0.5 rounded">https://logincert.anaf.ro/anaf-oauth2/v1/authorize</code></li>
                      <li>Access Token URL: <code className="bg-gray-100 px-0.5 rounded">https://logincert.anaf.ro/anaf-oauth2/v1/token</code></li>
                      <li>Client ID și Client Secret (din ANAF)</li>
                      <li>Scope: <code className="bg-gray-100 px-0.5 rounded">offline_access</code></li>
                    </ul>
                  </li>
                  <li>
                    <strong>Bifați „Authorize using Browser"</strong> (obligatoriu – browserul va prezenta certificatul de pe tokenul USB).
                  </li>
                  <li>
                    <strong>Apăsați „Request Token"</strong> → browserul se deschide → selectați certificatul → introduceți PIN-ul.
                  </li>
                  <li>
                    <strong>Copiați răspunsul JSON</strong> din secțiunea „Token Details" sau din consola Postman.
                    Răspunsul arată astfel:
                    <pre className="mt-1 bg-gray-100 rounded p-2 overflow-x-auto text-gray-800">{`{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}`}</pre>
                  </li>
                  <li>
                    <strong>Lipiți JSON-ul în câmpul de mai jos</strong> și apăsați „Importă token".
                  </li>
                </ol>
              </div>

              {/* Secțiunea import JSON */}
              <div className="border border-blue-200 rounded-lg p-3 bg-blue-50">
                <p className="font-semibold text-blue-800 text-sm mb-2 flex items-center gap-1.5">
                  <Clipboard className="w-4 h-4" /> Importă token din Postman / curl
                </p>
                <p className="text-xs text-blue-700 mb-2">
                  Lipiți răspunsul JSON complet de la ANAF (cu <code className="bg-blue-100 px-0.5 rounded">access_token</code>,{" "}
                  <code className="bg-blue-100 px-0.5 rounded">refresh_token</code>, <code className="bg-blue-100 px-0.5 rounded">expires_in</code>)
                  sau doar stringul <code className="bg-blue-100 px-0.5 rounded">access_token</code>.{" "}
                  <span className="text-blue-600">Puteți include sau omite prefixul <code className="bg-blue-100 px-0.5 rounded">Bearer </code> – backendul îl elimină automat dacă este prezent.</span>
                </p>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-xs focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-white"
                  rows={5}
                  value={tokenJson}
                  onChange={e => setTokenJson(e.target.value)}
                  placeholder={'{"access_token":"eyJ...","token_type":"Bearer","refresh_token":"eyJ...","expires_in":3600}'}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={importTokenJson}
                    disabled={importing || !tokenJson.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Importă token
                  </button>
                  <button
                    onClick={() => setTokenJson("")}
                    disabled={!tokenJson}
                    className="px-3 py-2 border text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40">
                    Șterge
                  </button>
                </div>
                {importMsg && (
                  <div className={`mt-2 rounded-lg p-2 text-xs ${importMsg.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                    {importMsg.text}
                  </div>
                )}
              </div>

              {/* Comandă curl de referință */}
              <div className="border border-gray-200 rounded-lg">
                <div className="bg-gray-50 px-3 py-2 border-b rounded-t-lg flex items-center justify-between">
                  <p className="font-semibold text-gray-700 text-xs flex items-center gap-1.5">
                    <FileCode className="w-4 h-4" /> Comandă curl de referință (dacă aveți cert.pem/key.pem local)
                  </p>
                  <button
                    onClick={() => {
                      const cmd = `curl -v \\
  --cert /calea/spre/cert.pem \\
  --key /calea/spre/key.pem \\
  -X POST https://logincert.anaf.ro/anaf-oauth2/v1/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \\
  -d "grant_type=authorization_code&code=CODUL_PRIMIT&redirect_uri=REDIRECT_URI&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"`;
                      navigator.clipboard.writeText(cmd).then(() => {
                        setCopiedCmd(true);
                        setTimeout(() => setCopiedCmd(false), 2000);
                      });
                    }}
                    className="flex items-center gap-1 px-2 py-1 border border-gray-300 bg-white rounded text-xs text-gray-600 hover:bg-gray-50">
                    {copiedCmd ? <CheckCircle className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                    {copiedCmd ? "Copiat!" : "Copiază"}
                  </button>
                </div>
                <pre className="p-3 text-xs font-mono text-gray-700 overflow-x-auto bg-gray-50 rounded-b-lg whitespace-pre-wrap">{`curl -v \\
  --cert /calea/spre/cert.pem \\
  --key /calea/spre/key.pem \\
  -X POST https://logincert.anaf.ro/anaf-oauth2/v1/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \\
  -d "grant_type=authorization_code&code=CODUL_PRIMIT&redirect_uri=REDIRECT_URI&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"`}
                </pre>
                <p className="px-3 pb-2 text-xs text-gray-500">
                  Înlocuiți <code className="bg-gray-100 px-0.5 rounded">CLIENT_ID</code>, <code className="bg-gray-100 px-0.5 rounded">CLIENT_SECRET</code>,{" "}
                  <code className="bg-gray-100 px-0.5 rounded">CODUL_PRIMIT</code> și <code className="bg-gray-100 px-0.5 rounded">REDIRECT_URI</code> cu valorile voastre.
                  Codul de autorizare expiră în ~60 secunde după redirect.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                <p className="font-medium text-gray-700 mb-1">📖 Referință SAP Community – Ghid Postman complet:</p>
                <a
                  href="https://community.sap.com/t5/technology-blog-posts-by-sap/generating-an-authorization-token-in-romania-s-anaf-portal-using-postman/ba-p/13577060"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:underline break-all">
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                  Generating an Authorization Token in Romania ANAF Portal using Postman
                </a>
              </div>
            </div>
          )}

          {/* ── Manual token Tab ──────────────────────────────────────────────── */}
          {settingsTab === "manual" && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>⚠ Token manual V2</strong> – Introduceți direct un token Bearer obținut manual.
                Dacă aveți un token hardware USB, folosiți tab-ul{" "}
                <button onClick={() => setSettingsTab("usb")} className="underline font-semibold">„Token USB / Postman"</button>{" "}
                pentru instrucțiuni complete.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Token OAuth2 ANAF (V2)</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-xs focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  rows={5}
                  value={form.token}
                  onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                  placeholder="Paste token Bearer obținut din portalul ANAF..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Token expiră la (opțional)</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  value={form.tokenExpiresAt ? form.tokenExpiresAt.slice(0, 16) : ""}
                  onChange={e => setForm(f => ({ ...f, tokenExpiresAt: e.target.value }))}
                />
              </div>
            </>
          )}

          {/* ── General Tab ───────────────────────────────────────────────────── */}
          {settingsTab === "general" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mediu</label>
                <select
                  value={form.environment}
                  onChange={e => setForm(f => ({ ...f, environment: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400">
                  <option value="test">TEST (Sandbox ANAF)</option>
                  <option value="prod">PRODUCȚIE (atenție!)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CIF Furnizor *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  value={form.cif}
                  onChange={e => setForm(f => ({ ...f, cif: e.target.value }))}
                  placeholder="ex: RO12345678"
                />
              </div>
            </>
          )}

          {/* ── Guide Tab ─────────────────────────────────────────────────────── */}
          {settingsTab === "guide" && (
            <div className="space-y-4 text-sm text-gray-700">
              <h4 className="font-semibold text-gray-800 text-base">Ghid V2 – Integrare ANAF cu IP Extern / Port-Forwarding</h4>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 text-xs">
                <strong>Modulul E-Factura SPV-V2</strong> este conceput pentru servere care rulează în spatele unui NAT sau router cu port-forwarding, unde IP-ul intern diferă de cel extern (public). Configurările și token-urile sunt complet separate față de modulul V1.
              </div>

              <ol className="space-y-5 list-decimal pl-5">
                <li>
                  <strong>Configurare IP extern / port-forwarding</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Identificați IP-ul extern (public) al routerului dumneavoastră.</li>
                    <li>Configurați port-forwarding în router: portul extern (ex: 5000) → IP intern al serverului.</li>
                    <li>Generați un certificat SSL cu SAN pentru IP-ul extern (ex: <code className="bg-gray-100 px-0.5 rounded">openssl req -x509 ... -addext "subjectAltName=IP:IP_EXTERN"</code>).</li>
                    <li>Setați <code className="bg-gray-100 px-0.5 rounded">PUBLIC_URL=https://IP_EXTERN:PORT</code> în fișierul <code className="bg-gray-100 px-0.5 rounded">server/.env</code>.</li>
                  </ul>
                </li>

                <li>
                  <strong>Înregistrare aplicație OAuth2 la ANAF</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Accesați <a href="https://logincert.anaf.ro" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">https://logincert.anaf.ro<ExternalLink className="w-3 h-3" /></a> și autentificați-vă cu certificatul digital.</li>
                    <li>Creați o aplicație nouă OAuth2 (separat față de orice aplicație V1 existentă).</li>
                    <li>La câmpul <strong>Redirect URI</strong> introduceți adresa cu IP-ul <strong>extern</strong>: <code className="bg-gray-100 px-0.5 rounded">https://IP_EXTERN:PORT/api/efactura-v2/oauth/callback</code></li>
                    <li>Bifați scope-ul <strong>offline_access</strong> și salvați <strong>Client ID</strong> și <strong>Client Secret</strong>.</li>
                  </ul>
                </li>

                <li>
                  <strong>Configurare în aplicație</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Deschideți tab-ul <strong>OAuth2 ANAF</strong> și completați Client ID, Client Secret și Redirect URI.</li>
                    <li>Completați câmpul <strong>URL Public callback</strong> cu adresa externă completă (dacă diferă de cea detectată automat).</li>
                    <li>Setați CIF-ul și mediul în tab-ul <strong>General</strong>.</li>
                    <li>Salvați și apăsați <strong>„Autorizare ANAF (V2)"</strong>.</li>
                  </ul>
                </li>

                <li>
                  <strong>Verificare și troubleshooting</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Folosiți butonul <strong>„Diagnosticare configurație"</strong> pentru a verifica starea completă.</li>
                    <li>Dacă apare <code className="bg-gray-100 px-0.5 rounded">ERR_SSL_KEY_USAGE_INCOMPATIBLE</code>, regenerați certificatul cu extensiile corecte: <code className="bg-gray-100 px-0.5 rounded">keyUsage = digitalSignature, keyEncipherment</code> și <code className="bg-gray-100 px-0.5 rounded">extendedKeyUsage = serverAuth</code>.</li>
                    <li>Dacă apare <code className="bg-gray-100 px-0.5 rounded">access_denied</code>, verificați că redirect_uri din aplicație coincide exact cu cel înregistrat la ANAF.</li>
                    <li>Documentație completă: <code className="bg-gray-100 px-0.5 rounded">README-EFACTURA-V2.md</code> din proiect.</li>
                  </ul>
                </li>
              </ol>

              <div className="flex gap-2 flex-wrap">
                <a
                  href="https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Documentație oficială OAuth2 ANAF (PDF)
                </a>
                <a
                  href="https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Documentație API e-Factura ANAF
                </a>
              </div>
            </div>
          )}

          {msg && (
            <div className={`rounded-lg p-3 text-sm ${msg.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
              {msg.text}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Închide</button>
          {settingsTab !== "guide" && settingsTab !== "usb" && (
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              Salvează
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Messages tab (V2) ────────────────────────────────────────────────────────
/**
 * Tab pentru preluarea și afișarea mesajelor SPV prin modulul V2.
 * Folosește endpoint-urile `/api/efactura-v2/messages` și `/api/efactura-v2/local-messages`.
 */
const MessagesTabV2 = ({ API_URL, showMessage }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [zile, setZile] = useState(60);
  const [tip, setTip] = useState("T");
  const [fetchedAt, setFetchedAt] = useState(null);

  /** Încarcă mesajele cacheate local (fără apel la ANAF). */
  const loadLocal = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/local-messages`);
      if (r.ok) setMessages(await r.json());
    } catch {}
  }, [API_URL]);

  useEffect(() => { loadLocal(); }, [loadLocal]);

  /** Preia mesajele direct de la ANAF prin API-ul V2. */
  const fetchFromANAF = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/messages?zile=${zile}&tip=${tip}`);
      const data = await r.json();
      if (!r.ok) { showMessage(data.error || "Eroare la preluare mesaje V2.", "error"); return; }
      setMessages(data.messages || []);
      setFetchedAt(new Date());
      showMessage(`${data.total || 0} mesaje preluate din SPV (V2).`, "success");
    } catch (e) { showMessage(e.message, "error"); }
    finally { setLoading(false); }
  };

  /** Descarcă un mesaj specific din SPV (V2). */
  const downloadMessage = async (idDescarcare) => {
    try {
      const url = `${API_URL}/api/efactura-v2/download-message/${encodeURIComponent(idDescarcare)}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `mesaj_anaf_v2_${idDescarcare}.zip`;
      a.click();
    } catch (e) { showMessage(e.message, "error"); }
  };

  return (
    <div className="space-y-4">
      {/* Bara de filtrare */}
      <div className="flex flex-wrap gap-3 items-end bg-white rounded-xl p-4 shadow-sm border">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tip mesaj</label>
          <select value={tip} onChange={e => setTip(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
            <option value="T">Toate</option>
            <option value="P">Emise (trimise)</option>
            <option value="C">Primite (de la parteneri)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Interval (zile)</label>
          <select value={zile} onChange={e => setZile(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
            <option value={7}>7 zile</option>
            <option value={30}>30 zile</option>
            <option value={60}>60 zile</option>
          </select>
        </div>
        <button onClick={fetchFromANAF} disabled={loading}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
          Preia mesaje din SPV (V2)
        </button>
        {fetchedAt && <span className="text-xs text-gray-400">Actualizat: {fetchedAt.toLocaleTimeString("ro-RO")}</span>}
      </div>

      {/* Tabel mesaje */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {messages.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Niciun mesaj. Apăsați „Preia mesaje din SPV (V2)" pentru a prelua.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600">ID Mesaj</th>
                  <th className="text-left px-4 py-3 text-gray-600">Tip</th>
                  <th className="text-left px-4 py-3 text-gray-600">Data creare</th>
                  <th className="text-left px-4 py-3 text-gray-600">CIF</th>
                  <th className="text-left px-4 py-3 text-gray-600">Detalii</th>
                  <th className="text-left px-4 py-3 text-gray-600">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {messages.map((m, i) => (
                  <tr key={m.id || m.anaf_message_id || i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{m.id || m.anaf_message_id || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.tip === "FACTURA PRIMITA" ? "bg-blue-100 text-blue-700" :
                        m.tip === "FACTURA TRIMISA" ? "bg-green-100 text-green-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>{m.tip || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{m.data_creare || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{m.cif || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={m.detalii}>{m.detalii || "—"}</td>
                    <td className="px-4 py-3">
                      {(m.id_descarcare || m.idDescarcare) && (
                        <button
                          onClick={() => downloadMessage(m.id_descarcare || m.idDescarcare)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline">
                          <Download className="w-3 h-3" /> Descarcă ZIP
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main EfacturaV2Screen ────────────────────────────────────────────────────
/**
 * Ecranul principal al modulului E-Factura SPV-V2.
 *
 * Structura ecranului:
 *  - Header cu titlu, badge V2/IP Extern și buton de configurare
 *  - Tab-uri: „Transmitere facturi" și „Mesaje SPV"
 *  - Carduri sumar stare facturi
 *  - Tabel facturi cu acțiuni individuale și în lot
 *  - Modal răspuns ANAF detaliat
 *
 * @param {string} API_URL – URL-ul de bază al API-ului (din .env VITE_API_URL)
 * @param {function} showMessage – callback pentru notificări globale (tip, mesaj)
 */
const EfacturaV2Screen = ({ API_URL, showMessage }) => {
  const [activeTab, setActiveTab] = useState("upload");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState("oauth");
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState({});
  const [checkingStatus, setCheckingStatus] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchCheckingStatus, setBatchCheckingStatus] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedRows, setExpandedRows] = useState(new Set());

  // Detectează parametrii OAuth2 callback în URL (oauth_success / oauth_error / mtls_required)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess  = params.get("oauth_success");
    const oauthError    = params.get("oauth_error");
    const mtlsRequired  = params.get("mtls_required");
    if (oauthSuccess) {
      showMessage("✅ Autorizare ANAF V2 reușită! Token OAuth2 salvat cu succes.", "success");
      setShowSettings(true);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauthError) {
      if (mtlsRequired === "1") {
        // ANAF a returnat HTTP 500 din cauza lipsei mTLS (certificat digital neprezentat).
        // Deschidem panoul de configurare direct pe tab-ul USB Token cu instrucțiuni.
        // A nu se folosi ghilimele Unicode în stringuri JS/JSX!
        showMessage(
          "❌ ANAF a returnat HTTP 500 – certificatul digital nu a putut fi prezentat automat de server. " +
          "Dacă aveți un token hardware USB, folosiți fluxul Postman din tab-ul \"Token USB / Postman\".",
          "error"
        );
        setSettingsDefaultTab("usb");
      } else {
        showMessage(`❌ Eroare autorizare ANAF V2: ${oauthError}`, "error");
      }
      setShowSettings(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interval de date – implicit: luna curentă
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);

  /**
   * Încarcă facturile din API (endpoint V1 shared, aceeași tabelă billing_invoices).
   * Modulul V2 operează pe aceleași facturi, dar folosește propriul token OAuth2.
   */
  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const r = await fetch(`${API_URL}/api/efactura/invoices?${params}`);
      if (r.ok) setInvoices(await r.json());
      else showMessage("Eroare la încărcarea facturilor.", "error");
    } catch (e) { showMessage(e.message, "error"); }
    finally { setLoading(false); }
  }, [API_URL, dateFrom, dateTo, showMessage]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  // Facturi filtrate după stare
  const filteredInvoices = invoices.filter(inv => {
    if (filterStatus === "all") return true;
    return (inv.spv_status || "none") === filterStatus;
  });

  // Helpers selecție
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selectedIds.size === filteredInvoices.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredInvoices.map(i => i.id)));
  };

  /**
   * Transmite o singură factură la ANAF prin API-ul V2.
   * Folosește tokenul OAuth2 din spv_v2_settings.
   */
  const uploadInvoice = async (inv) => {
    setUploading(u => ({ ...u, [inv.id]: true }));
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/upload/${inv.id}`, { method: "POST" });
      const data = await r.json();
      if (r.ok && !data.error) showMessage(`Factura ${inv.invoice_code || inv.id} transmisă (V2) – ID: ${data.uploadId}.`, "success");
      else {
        const statusInfo = data.anafHttpStatus ? ` [ANAF HTTP ${data.anafHttpStatus}]` : "";
        const anafDetail = data.anafResponse
          ? (typeof data.anafResponse === "string"
              ? data.anafResponse.substring(0, 200)
              : JSON.stringify(data.anafResponse).substring(0, 200))
          : "";
        showMessage(`Eroare transmitere V2${statusInfo}: ${data.error || "Eroare necunoscută"}${anafDetail ? ` – ${anafDetail}` : ""}`, "error");
      }
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setUploading(u => ({ ...u, [inv.id]: false })); }
  };

  /**
   * Verifică starea unei facturi la ANAF prin API-ul V2 (GET, nu POST ca în V1).
   */
  const checkStatus = async (inv) => {
    setCheckingStatus(u => ({ ...u, [inv.id]: true }));
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/check-status/${inv.id}`);
      const data = await r.json();
      if (r.ok) showMessage(`Stare ANAF (V2): ${data.anafStatus || data.localStatus}`, "success");
      else showMessage(data.error || "Eroare verificare stare V2.", "error");
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setCheckingStatus(u => ({ ...u, [inv.id]: false })); }
  };

  /** Transmite în lot facturile selectate prin API-ul V2. */
  const batchUpload = async () => {
    if (!selectedIds.size) { showMessage("Selectați cel puțin o factură pentru transmitere.", "warning"); return; }
    setBatchUploading(true);
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/upload-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: Array.from(selectedIds) }),
      });
      const data = await r.json();
      showMessage(`Transmise (V2): ${data.success}/${data.total} facturi.`, data.success === data.total ? "success" : "warning");
      setSelectedIds(new Set());
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setBatchUploading(false); }
  };

  /** Verifică starea în lot pentru facturile transmise prin API-ul V2. */
  const batchCheckStatus = async () => {
    const idsToCheck = invoices
      .filter(i => i.spv_upload_id && ["uploaded", "processing"].includes(i.spv_status))
      .map(i => i.id);
    if (!idsToCheck.length) { showMessage("Nicio factură transmisă fără status final.", "warning"); return; }
    setBatchCheckingStatus(true);
    try {
      const r = await fetch(`${API_URL}/api/efactura-v2/check-status-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: idsToCheck }),
      });
      const data = await r.json();
      showMessage(`Status V2 verificat pentru ${data.results?.length || 0} facturi.`, "success");
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setBatchCheckingStatus(false); }
  };

  /** Descarcă XML-ul UBL generat pentru o factură (pentru previzualizare/debug). */
  const downloadXml = (inv) => {
    const url = `${API_URL}/api/efactura-v2/xml/${inv.id}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `factura-v2-${inv.invoice_code || inv.id}.xml`;
    a.click();
  };

  /** Descarcă răspunsul ANAF (ZIP) pentru o factură prin API-ul V2. */
  const downloadResponse = (inv) => {
    const url = `${API_URL}/api/efactura-v2/download/${inv.id}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `raspuns_anaf_v2_${inv.invoice_code || inv.id}.zip`;
    a.click();
  };

  // Număr facturi per stare (pentru cardurile sumar)
  const counts = invoices.reduce((acc, inv) => {
    const s = inv.spv_status || "none";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-600" />
            e-Factura SPV-V2
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-normal">IP Extern</span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Transmitere și monitorizare facturi în SPV ANAF – Modul V2 cu suport IP extern / port-forwarding
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-gray-700">
          <Settings className="w-4 h-4" /> Configurare OAuth2 V2
        </button>
      </div>

      {/* Tab-uri principale */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("upload")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "upload" ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
          <Upload className="w-4 h-4" /> Transmitere facturi
        </button>
        <button
          onClick={() => setActiveTab("messages")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "messages" ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
          <Inbox className="w-4 h-4" /> Mesaje SPV
        </button>
      </div>

      {activeTab === "upload" && (
        <div className="space-y-4">
          {/* Carduri sumar stare */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  key={key}
                  onClick={() => setFilterStatus(filterStatus === key ? "all" : key)}
                  className={`rounded-xl p-3 border text-left transition-all hover:shadow-md ${filterStatus === key ? "ring-2 ring-blue-500 shadow-md" : ""} ${cfg.color}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{cfg.label}</span>
                  </div>
                  <div className="text-lg font-bold">{counts[key] || 0}</div>
                </button>
              );
            })}
            <button
              onClick={() => setFilterStatus("all")}
              className={`rounded-xl p-3 border text-left transition-all hover:shadow-md bg-gray-100 text-gray-700 ${filterStatus === "all" ? "ring-2 ring-blue-500 shadow-md" : ""}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">Total</span>
              </div>
              <div className="text-lg font-bold">{invoices.length}</div>
            </button>
          </div>

          {/* Bara de filtrare și acțiuni în lot */}
          <div className="bg-white rounded-xl shadow-sm border p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">De la data</label>
              <input type="date" value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Până la data</label>
              <input type="date" value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
            </div>
            <button onClick={loadInvoices} disabled={loading}
              className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Actualizează
            </button>
            <div className="flex gap-2 ml-auto flex-wrap">
              {selectedIds.size > 0 && (
                <button onClick={batchUpload} disabled={batchUploading}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {batchUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Transmite selectate ({selectedIds.size}) – V2
                </button>
              )}
              <button onClick={batchCheckStatus} disabled={batchCheckingStatus}
                className="flex items-center gap-2 border border-blue-300 text-blue-700 px-4 py-2 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50">
                {batchCheckingStatus ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Verifică status ANAF (V2)
              </button>
            </div>
          </div>

          {/* Tabel facturi */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {filteredInvoices.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>{loading ? "Se încarcă facturile…" : "Nicio factură găsită pentru intervalul selectat."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left">
                        <input type="checkbox"
                          checked={selectedIds.size === filteredInvoices.length && filteredInvoices.length > 0}
                          onChange={toggleAll}
                          className="rounded border-gray-300" />
                      </th>
                      <th className="text-left px-4 py-3 text-gray-600">Nr. factură</th>
                      <th className="text-left px-4 py-3 text-gray-600">Client</th>
                      <th className="text-left px-4 py-3 text-gray-600">Dată</th>
                      <th className="text-left px-4 py-3 text-gray-600">Total</th>
                      <th className="text-left px-4 py-3 text-gray-600">Stare SPV</th>
                      <th className="text-left px-4 py-3 text-gray-600">Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredInvoices.map(inv => (
                      <React.Fragment key={inv.id}>
                        <tr className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <input type="checkbox"
                              checked={selectedIds.has(inv.id)}
                              onChange={() => toggleSelect(inv.id)}
                              className="rounded border-gray-300" />
                          </td>
                          <td className="px-4 py-3 font-medium">{inv.invoice_code || `#${inv.id}`}</td>
                          <td className="px-4 py-3 text-gray-700">{inv.client_name || "—"}</td>
                          <td className="px-4 py-3 text-gray-600">{inv.document_date || "—"}</td>
                          <td className="px-4 py-3 font-medium">
                            {inv.total_amount != null
                              ? `${Number(inv.total_amount).toLocaleString("ro-RO", { minimumFractionDigits: 2 })} RON`
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={inv.spv_status} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              {/* Transmite V2 */}
                              <button
                                onClick={() => uploadInvoice(inv)}
                                disabled={uploading[inv.id]}
                                title="Transmite în SPV (V2)"
                                className="p-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50">
                                {uploading[inv.id]
                                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  : <Upload className="w-3.5 h-3.5" />}
                              </button>

                              {/* Verifică status V2 */}
                              {inv.spv_upload_id && (
                                <button
                                  onClick={() => checkStatus(inv)}
                                  disabled={checkingStatus[inv.id]}
                                  title="Verifică status ANAF (V2)"
                                  className="p-1.5 rounded-lg bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50">
                                  {checkingStatus[inv.id]
                                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    : <CheckCircle className="w-3.5 h-3.5" />}
                                </button>
                              )}

                              {/* Descarcă XML */}
                              <button
                                onClick={() => downloadXml(inv)}
                                title="Descarcă XML UBL (V2)"
                                className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
                                <FileCode className="w-3.5 h-3.5" />
                              </button>

                              {/* Descarcă răspuns ANAF */}
                              {inv.spv_download_id && (
                                <button
                                  onClick={() => downloadResponse(inv)}
                                  title="Descarcă răspuns ANAF (ZIP) – V2"
                                  className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200">
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Detalii răspuns */}
                              <button
                                onClick={() => setDetailModal(inv)}
                                title="Detalii răspuns SPV (V2)"
                                className="p-1.5 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200">
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {/* Expandează rând */}
                              <button
                                onClick={() => setExpandedRows(prev => {
                                  const next = new Set(prev);
                                  next.has(inv.id) ? next.delete(inv.id) : next.add(inv.id);
                                  return next;
                                })}
                                title="Expandează detalii"
                                className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
                                {expandedRows.has(inv.id)
                                  ? <ChevronUp className="w-3.5 h-3.5" />
                                  : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Rând expandat cu detalii extra */}
                        {expandedRows.has(inv.id) && (
                          <tr className="bg-blue-50">
                            <td colSpan={7} className="px-6 py-3 text-xs text-gray-600 space-y-1">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
                                <div><span className="text-gray-400">ID factură:</span> {inv.id}</div>
                                <div><span className="text-gray-400">ID upload SPV:</span> <code className="bg-white rounded px-0.5">{inv.spv_upload_id || "—"}</code></div>
                                <div><span className="text-gray-400">ID descarcare:</span> <code className="bg-white rounded px-0.5">{inv.spv_download_id || "—"}</code></div>
                                <div><span className="text-gray-400">Încărcat la:</span> {inv.spv_uploaded_at ? new Date(inv.spv_uploaded_at).toLocaleString("ro-RO") : "—"}</div>
                              </div>
                              {inv.spv_response && (
                                <div className="mt-1">
                                  <span className="text-gray-400">Răspuns ANAF (preview): </span>
                                  <code className="bg-white rounded px-1 break-all">
                                    {inv.spv_response.length > 200
                                      ? inv.spv_response.slice(0, 200) + "…"
                                      : inv.spv_response}
                                  </code>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Mesaje SPV */}
      {activeTab === "messages" && (
        <MessagesTabV2 API_URL={API_URL} showMessage={showMessage} />
      )}

      {/* Modal configurare */}
      {showSettings && (
        <SettingsPanelV2
          API_URL={API_URL}
          defaultTab={settingsDefaultTab}
          onClose={() => { setShowSettings(false); setSettingsDefaultTab("oauth"); }}
          onSaved={() => { setShowSettings(false); setSettingsDefaultTab("oauth"); }}
        />
      )}

      {/* Modal detalii răspuns ANAF */}
      {detailModal && (
        <ResponseModal invoice={detailModal} onClose={() => setDetailModal(null)} />
      )}
    </div>
  );
};

export default EfacturaV2Screen;
