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
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  none:       { label: "Neîncărcat",    color: "bg-gray-100 text-gray-600",    icon: Clock },
  uploading:  { label: "Se încarcă…",   color: "bg-blue-100 text-blue-700",    icon: RefreshCw },
  uploaded:   { label: "Transmisă",     color: "bg-cyan-100 text-cyan-700",    icon: Send },
  processing: { label: "În prelucrare", color: "bg-yellow-100 text-yellow-700",icon: Clock },
  validated:  { label: "Validată ✓",    color: "bg-green-100 text-green-700",  icon: CheckCircle },
  rejected:   { label: "Respinsă ✗",   color: "bg-red-100 text-red-700",      icon: XCircle },
  error:      { label: "Eroare",        color: "bg-orange-100 text-orange-700",icon: AlertTriangle },
};

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
            Răspuns ANAF SPV – {invoice.invoice_code || invoice.id}
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
const SettingsPanel = ({ API_URL, onClose, onSaved }) => {
  const [settingsTab, setSettingsTab] = useState("oauth");
  const [form, setForm] = useState({
    cif: "", token: "", tokenExpiresAt: "", environment: "test",
    clientId: "", clientSecret: "", redirectUri: "",
  });
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [msg, setMsg] = useState(null);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  // Use the frontend origin (window.location.origin) so that the redirect URI goes through
  // the Vite proxy and the OAuth callback is forwarded to the backend correctly.
  // This ensures the URL shown to register in ANAF matches the actual frontend server
  // (e.g. https://192.168.100.136:5173) rather than the backend API port (5000).
  const recommendedRedirectUri = `${window.location.origin}/api/efactura/oauth/callback`;

  useEffect(() => {
    fetch(`${API_URL}/api/efactura/settings`)
      .then(r => r.json())
      .then(d => {
        setForm({
          cif:          d.cif           || "",
          token:        d.token         || "",
          tokenExpiresAt: d.tokenExpiresAt || "",
          environment:  d.environment   || "test",
          clientId:     d.clientId      || "",
          clientSecret: d.clientSecret  || "",
          redirectUri:  d.redirectUri   || "",
        });
        setHasRefreshToken(!!d.hasRefreshToken);
      })
      .catch(() => {});
  }, [API_URL]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`${API_URL}/api/efactura/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (r.ok) { setMsg({ type: "success", text: "Setări salvate cu succes." }); onSaved?.(); }
      else { const e = await r.json(); setMsg({ type: "error", text: e.error || "Eroare la salvare." }); }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    finally { setSaving(false); }
  };

  const startAuthorization = async () => {
    setAuthorizing(true);
    setMsg(null);
    // Save credentials first so server has them for the callback
    try {
      await fetch(`${API_URL}/api/efactura/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const r = await fetch(`${API_URL}/api/efactura/oauth/authorize`);
      const data = await r.json();
      if (!r.ok) { setMsg({ type: "error", text: data.error || "Eroare la generare URL autorizare." }); return; }
      window.open(data.authUrl, "_blank", "width=900,height=700,noopener");
      setMsg({ type: "success", text: "Fereastra de autorizare ANAF s-a deschis. Autentificați-vă cu certificatul digital, apoi reveniți aici și închideți fereastra." });
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    finally { setAuthorizing(false); }
  };

  const testCredentials = async () => {
    setTesting(true);
    setTestResult(null);
    setMsg(null);
    // Save credentials first so the server uses the latest values from the form
    try {
      await fetch(`${API_URL}/api/efactura/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const r = await fetch(`${API_URL}/api/efactura/oauth/test-credentials`);
      const data = await r.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ summary: `Eroare: ${e.message}` });
    } finally {
      setTesting(false);
    }
  };

  const refreshToken = async () => {
    setRefreshing(true);
    setMsg(null);
    try {
      const r = await fetch(`${API_URL}/api/efactura/oauth/refresh`, { method: "POST" });
      const data = await r.json();
      if (r.ok) {
        setMsg({ type: "success", text: `Token reîmprospătat cu succes. Expiră la: ${data.expiresAt ? new Date(data.expiresAt).toLocaleString("ro-RO") : "necunoscut"}.` });
        onSaved?.();
        // Reload settings
        const s = await fetch(`${API_URL}/api/efactura/settings`).then(x => x.json());
        setForm(f => ({ ...f, token: s.token || "", tokenExpiresAt: s.tokenExpiresAt || "" }));
        setHasRefreshToken(!!s.hasRefreshToken);
      } else {
        setMsg({ type: "error", text: data.error || "Eroare la reîmprospătare token." });
      }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    finally { setRefreshing(false); }
  };

  const tokenExpired = form.tokenExpiresAt && new Date(form.tokenExpiresAt) < new Date();
  const tokenExpiresSoon = form.tokenExpiresAt && !tokenExpired &&
    new Date(form.tokenExpiresAt) < new Date(Date.now() + 10 * 60 * 1000);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-500" />
            Configurare SPV e-Factura
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>

        {/* Inner tabs */}
        <div className="flex border-b flex-shrink-0 px-4">
          {[
            { id: "oauth", label: "OAuth2 ANAF", icon: ShieldCheck },
            { id: "manual", label: "Token manual", icon: Key },
            { id: "general", label: "General", icon: Settings },
            { id: "guide", label: "Ghid configurare", icon: BookOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setSettingsTab(id); setTestResult(null); setMsg(null); }}
              className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                settingsTab === id
                  ? "border-amber-500 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* ── OAuth2 Tab ─────────────────────────────────────────────────────── */}
          {settingsTab === "oauth" && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                <strong>🔐 Autorizare OAuth2 automată</strong> – Introduceți credențialele aplicației înregistrate în portalul ANAF, apoi apăsați „Autorizare ANAF" pentru a obține token-ul automat prin fluxul OAuth2 oficial.
              </div>

              {/* Redirect URI display box – must match ANAF portal exactly */}
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm">
                <p className="font-semibold text-amber-900 mb-1">⚠ Redirect URI obligatoriu în portalul ANAF</p>
                <p className="text-amber-800 text-xs mb-2">
                  Copiați exact această adresă și introduceți-o ca <strong>Redirect URI</strong> (Callback URL) la înregistrarea aplicației pe <a href="https://logincert.anaf.ro" target="_blank" rel="noopener noreferrer" className="underline">logincert.anaf.ro</a>. Orice diferență (spații, slash final, protocol greșit) produce eroarea <code className="bg-amber-100 px-1 rounded">access_denied</code>.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-amber-300 rounded px-2 py-1.5 text-xs font-mono break-all text-gray-800">
                    {recommendedRedirectUri}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(recommendedRedirectUri).then(() => {
                        setCopiedUri(true);
                        setTimeout(() => setCopiedUri(false), 2000);
                      });
                    }}
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border border-amber-300 bg-white rounded text-xs text-amber-700 hover:bg-amber-50">
                    {copiedUri ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedUri ? "Copiat!" : "Copiază"}
                  </button>
                </div>
              </div>

              {/* Token status */}
              {form.token && (
                <div className={`rounded-lg p-3 text-sm border ${
                  tokenExpired       ? "bg-red-50 border-red-200 text-red-800" :
                  tokenExpiresSoon   ? "bg-yellow-50 border-yellow-200 text-yellow-800" :
                                       "bg-green-50 border-green-200 text-green-800"
                }`}>
                  <div className="flex items-center gap-2 font-medium">
                    {tokenExpired     ? <XCircle className="w-4 h-4" />     :
                     tokenExpiresSoon ? <AlertTriangle className="w-4 h-4" /> :
                                        <CheckCircle className="w-4 h-4" />}
                    {tokenExpired   ? "Token expirat – reîmprospătați sau reautorizați" :
                     tokenExpiresSoon ? "Token expiră în curând" :
                                        "Token activ"}
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
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  placeholder="Client ID primit de la ANAF după înregistrare"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret *</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                  value={form.clientSecret}
                  onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                  placeholder="Client Secret primit de la ANAF"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URI *</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
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

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={startAuthorization}
                  disabled={authorizing || !form.clientId || !form.redirectUri}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {authorizing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  Autorizare ANAF
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
                  onClick={testCredentials}
                  disabled={testing || !form.clientId || !form.clientSecret || !form.redirectUri}
                  className="flex items-center gap-2 px-4 py-2 border border-purple-300 text-purple-700 rounded-lg text-sm hover:bg-purple-50 disabled:opacity-50">
                  {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Testează credențiale
                </button>
              </div>

              {/* ── Credential test result panel ─────────────────────────────── */}
              {testResult && (
                <div className="border rounded-lg overflow-hidden text-sm">
                  <div className={`px-4 py-2.5 font-semibold flex items-center gap-2 ${
                    testResult.credentials?.ok
                      ? "bg-green-50 border-b border-green-200 text-green-800"
                      : "bg-red-50 border-b border-red-200 text-red-800"
                  }`}>
                    {testResult.credentials?.ok
                      ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                      : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                    {testResult.summary || "Rezultat diagnostic credențiale ANAF"}
                  </div>
                  <ul className="divide-y">
                    {[
                      { key: "format",      label: "Format credențiale" },
                      { key: "reachable",   label: "Server ANAF accesibil" },
                      { key: "redirectUri", label: "Redirect URI (format HTTPS)" },
                      { key: "credentials", label: "Client ID / Client Secret valide" },
                    ].map(({ key, label }) => {
                      const item = testResult[key];
                      if (!item) return null;
                      return (
                        <li key={key} className="flex items-start gap-3 px-4 py-2.5 bg-white">
                          {item.ok
                            ? <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                            : <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />}
                          <div>
                            <p className="font-medium text-gray-700">{label}</p>
                            {item.message && <p className="text-xs text-gray-500 mt-0.5">{item.message}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* ── Manual token Tab ──────────────────────────────────────────────── */}
          {settingsTab === "manual" && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>⚠ Token manual</strong> – Introduceți direct un token Bearer obținut manual din portalul ANAF sau din alte unelte. Recomandăm fluxul OAuth2 automat din tab-ul anterior.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Token OAuth2 ANAF</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-xs focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
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
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
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
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400">
                  <option value="test">TEST (Sandbox ANAF)</option>
                  <option value="prod">PRODUCȚIE (atenție!)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CIF Furnizor *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
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
              <h4 className="font-semibold text-gray-800 text-base">Ghid pas cu pas – Integrare OAuth2 ANAF e-Factura</h4>

              <ol className="space-y-5 list-decimal pl-5">
                <li>
                  <strong>Înregistrare aplicație în portalul ANAF</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Accesați <a href="https://logincert.anaf.ro" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">https://logincert.anaf.ro<ExternalLink className="w-3 h-3" /></a> și autentificați-vă cu certificatul digital calificat (token USB sau smart card).</li>
                    <li>Mergeți la secțiunea <strong>„Aplicații înregistrate"</strong> și creați o aplicație nouă.</li>
                    <li>La câmpul <strong>Redirect URI</strong> (Callback URL), introduceți <strong>exact</strong> adresa afișată în tab-ul „OAuth2 ANAF" (buton <em>Copiază</em>). Orice diferență (slash final, protocol, port) produce eroarea <code className="bg-gray-100 px-0.5 rounded">access_denied</code>.</li>
                    <li>Bifați scope-ul <strong>offline_access</strong> (necesar pentru refresh token).</li>
                    <li>Salvați și notați <strong>Client ID</strong> și <strong>Client Secret</strong> generate.</li>
                  </ul>
                </li>

                <li>
                  <strong>Configurare credențiale în aplicație</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Deschideți tab-ul <strong>„OAuth2 ANAF"</strong> din această fereastră.</li>
                    <li>Introduceți <strong>Client ID</strong> și <strong>Client Secret</strong> obținute la pasul anterior.</li>
                    <li>Setați <strong>Redirect URI</strong> identic (caracter cu caracter) cu cel introdus în portalul ANAF. Folosiți butonul <em>„Completează auto"</em> pentru a prelua automat adresa corectă.</li>
                    <li>Mergeți la tab-ul <strong>„General"</strong> și setați CIF-ul furnizorului și mediul (TEST sau PRODUCȚIE).</li>
                    <li>Apăsați <strong>„Salvează"</strong>.</li>
                  </ul>
                </li>

                <li>
                  <strong>Autorizare și obținere token</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Apăsați butonul <strong>„Autorizare ANAF"</strong> din tab-ul OAuth2.</li>
                    <li>Se va deschide o fereastră nouă cu pagina de autentificare ANAF.</li>
                    <li>Autentificați-vă cu <strong>certificatul digital calificat</strong> asociat CIF-ului înregistrat.</li>
                    <li>Confirmați acordul pentru aplicație când vi se solicită.</li>
                    <li>Aplicația va prelua automat token-ul și refresh token-ul; fereastra se poate închide după redirecționare.</li>
                  </ul>
                </li>

                <li>
                  <strong>Reîmprospătare automată token</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Token-ul de acces expiră de obicei în câteva ore.</li>
                    <li>Apăsați <strong>„Reîmprospătare token"</strong> (apare după prima autorizare) pentru a obține un token nou fără a vă mai autentifica.</li>
                    <li>Refresh token-ul are o valabilitate mai mare; dacă și acesta expiră, reluați autorizarea de la pasul 3.</li>
                  </ul>
                </li>

                <li>
                  <strong>Transmitere facturi în SPV</strong>
                  <ul className="mt-1 space-y-1 list-disc pl-4 text-gray-600">
                    <li>Reveniți la ecranul principal e-Factura SPV.</li>
                    <li>Selectați facturile de transmis și apăsați <strong>„Transmite selectate"</strong>.</li>
                    <li>Verificați starea cu <strong>„Verifică status ANAF"</strong>.</li>
                    <li>Descărcați răspunsul ANAF (ZIP) dacă este necesar.</li>
                  </ul>
                </li>
              </ol>

              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-xs space-y-1">
                <p className="font-semibold">❌ Depanare eroare „access_denied"</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Redirect URI nepotrivit</strong> – Verificați că adresa din câmpul „Redirect URI" al aplicației coincide <em>exact</em> (inclusiv protocol, port și cale) cu cea înregistrată pe portalul ANAF. Folosiți butonul „Copiază" din tab-ul OAuth2.</li>
                  <li><strong>Aplicație neaprobată / CIF greșit</strong> – Asigurați-vă că v-ați autentificat pe portalul ANAF cu certificatul digital aferent CIF-ului înregistrat în câmpul „General".</li>
                  <li><strong>Scope lipsă</strong> – Verificați că ați bifat <strong>offline_access</strong> la înregistrarea aplicației.</li>
                  <li><strong>Client ID / Client Secret greșit</strong> – Copiat cu spații sau trunchiat; reintroduceți credențialele direct din portalul ANAF.</li>
                </ul>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-xs">
                <strong>Notă importantă:</strong> Mediul de TEST ANAF folosește aceeași infrastructură OAuth2 ca și producția, dar facturile trimise nu sunt considerate documente fiscale oficiale. Testați cu facturi fictive înainte de a activa mediul de producție.
              </div>

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
          {settingsTab !== "guide" && (
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              Salvează
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Messages import tab ──────────────────────────────────────────────────────
const MessagesTab = ({ API_URL, showMessage }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [zile, setZile] = useState(60);
  const [tip, setTip] = useState("T");
  const [fetchedAt, setFetchedAt] = useState(null);

  const loadLocal = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/efactura/local-messages`);
      if (r.ok) setMessages(await r.json());
    } catch {}
  }, [API_URL]);

  useEffect(() => { loadLocal(); }, [loadLocal]);

  const fetchFromANAF = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/efactura/messages?zile=${zile}&tip=${tip}`);
      const data = await r.json();
      if (!r.ok) { showMessage(data.error || "Eroare la preluare mesaje.", "error"); return; }
      setMessages(data.messages || []);
      setFetchedAt(new Date());
      showMessage(`${data.total || 0} mesaje preluate din SPV.`, "success");
    } catch (e) { showMessage(e.message, "error"); }
    finally { setLoading(false); }
  };

  const downloadMessage = async (idDescarcare) => {
    try {
      const url = `${API_URL}/api/efactura/download-message/${encodeURIComponent(idDescarcare)}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `mesaj_anaf_${idDescarcare}.zip`;
      a.click();
    } catch (e) { showMessage(e.message, "error"); }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end bg-white rounded-xl p-4 shadow-sm border">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tip mesaj</label>
          <select value={tip} onChange={e => setTip(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400">
            <option value="T">Toate</option>
            <option value="P">Emise (trimise)</option>
            <option value="C">Primite (de la parteneri)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Interval (zile)</label>
          <select value={zile} onChange={e => setZile(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400">
            <option value={7}>7 zile</option>
            <option value={30}>30 zile</option>
            <option value={60}>60 zile</option>
          </select>
        </div>
        <button onClick={fetchFromANAF} disabled={loading}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
          Preia mesaje din SPV
        </button>
        {fetchedAt && <span className="text-xs text-gray-400">Actualizat: {fetchedAt.toLocaleTimeString("ro-RO")}</span>}
      </div>

      {/* Messages table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {messages.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Niciun mesaj. Apăsați „Preia mesaje din SPV" pentru a prelua.</p>
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

// ─── Main EfacturaScreen ──────────────────────────────────────────────────────
const EfacturaScreen = ({ API_URL, showMessage }) => {
  const [activeTab, setActiveTab] = useState("upload");
  const [showSettings, setShowSettings] = useState(false);
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

  // Detect OAuth2 callback results in URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthError   = params.get("oauth_error");
    if (oauthSuccess) {
      showMessage("✅ Autorizare ANAF reușită! Token OAuth2 salvat cu succes.", "success");
      setShowSettings(true);
      // Remove oauth query params and hash from URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauthError) {
      showMessage(`❌ Eroare autorizare ANAF: ${oauthError}`, "error");
      setShowSettings(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Date range – default: current month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);

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

  // ── Filtered invoices
  const filteredInvoices = invoices.filter(inv => {
    if (filterStatus === "all") return true;
    return (inv.spv_status || "none") === filterStatus;
  });

  // ── Selection helpers
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

  // ── Upload single invoice
  const uploadInvoice = async (inv) => {
    setUploading(u => ({ ...u, [inv.id]: true }));
    try {
      const r = await fetch(`${API_URL}/api/efactura/upload/${inv.id}`, { method: "POST" });
      const data = await r.json();
      if (data.success) showMessage(`Factura ${inv.invoice_code || inv.id} transmisă cu succes (ID: ${data.uploadId}).`, "success");
      else showMessage(`Eroare transmitere: ${data.error || JSON.stringify(data.anafResponse)}`, "error");
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setUploading(u => ({ ...u, [inv.id]: false })); }
  };

  // ── Check status single
  const checkStatus = async (inv) => {
    setCheckingStatus(u => ({ ...u, [inv.id]: true }));
    try {
      const r = await fetch(`${API_URL}/api/efactura/check-status/${inv.id}`, { method: "POST" });
      const data = await r.json();
      if (r.ok) showMessage(`Stare ANAF: ${data.anafStatus || data.localStatus}`, "success");
      else showMessage(data.error || "Eroare verificare stare.", "error");
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setCheckingStatus(u => ({ ...u, [inv.id]: false })); }
  };

  // ── Batch upload
  const batchUpload = async () => {
    if (!selectedIds.size) { showMessage("Selectați cel puțin o factură pentru transmitere.", "warning"); return; }
    setBatchUploading(true);
    try {
      const r = await fetch(`${API_URL}/api/efactura/upload-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: Array.from(selectedIds) }),
      });
      const data = await r.json();
      showMessage(`Transmise: ${data.success}/${data.total} facturi.`, data.success === data.total ? "success" : "warning");
      setSelectedIds(new Set());
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setBatchUploading(false); }
  };

  // ── Batch check status
  const batchCheckStatus = async () => {
    const idsToCheck = invoices.filter(i => i.spv_upload_id && ["uploaded", "processing"].includes(i.spv_status)).map(i => i.id);
    if (!idsToCheck.length) { showMessage("Nicio factură transmisă fără status final.", "warning"); return; }
    setBatchCheckingStatus(true);
    try {
      const r = await fetch(`${API_URL}/api/efactura/check-status-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: idsToCheck }),
      });
      const data = await r.json();
      showMessage(`Status verificat pentru ${data.results?.length || 0} facturi.`, "success");
      await loadInvoices();
    } catch (e) { showMessage(e.message, "error"); }
    finally { setBatchCheckingStatus(false); }
  };

  // ── Download XML
  const downloadXml = (inv) => {
    const url = `${API_URL}/api/efactura/xml/${inv.id}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `factura-${inv.invoice_code || inv.id}.xml`;
    a.click();
  };

  // ── Download ANAF response zip
  const downloadResponse = (inv) => {
    const url = `${API_URL}/api/efactura/download/${inv.id}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `raspuns_anaf_${inv.invoice_code || inv.id}.zip`;
    a.click();
  };

  // ── Summary counts
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
            <Send className="w-6 h-6 text-amber-600" />
            e-Factura SPV
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-normal">TEST</span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Transmitere și monitorizare facturi în SPV ANAF (mediu de test)</p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-gray-700">
          <Settings className="w-4 h-4" /> Configurare OAuth2 / Token
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("upload")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "upload" ? "bg-white shadow text-amber-700" : "text-gray-600 hover:text-gray-800"}`}>
          <Upload className="w-4 h-4" /> Transmitere facturi
        </button>
        <button
          onClick={() => setActiveTab("messages")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "messages" ? "bg-white shadow text-amber-700" : "text-gray-600 hover:text-gray-800"}`}>
          <Inbox className="w-4 h-4" /> Mesaje SPV
        </button>
      </div>

      {activeTab === "upload" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  key={key}
                  onClick={() => setFilterStatus(filterStatus === key ? "all" : key)}
                  className={`rounded-xl p-3 border text-left transition-all hover:shadow-md ${filterStatus === key ? "ring-2 ring-amber-500 shadow-md" : ""} ${cfg.color}`}>
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
              className={`rounded-xl p-3 border text-left transition-all hover:shadow-md bg-gray-100 text-gray-700 ${filterStatus === "all" ? "ring-2 ring-amber-500 shadow-md" : ""}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">Total</span>
              </div>
              <div className="text-lg font-bold">{invoices.length}</div>
            </button>
          </div>

          {/* Filter bar */}
          <div className="bg-white rounded-xl shadow-sm border p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">De la</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Până la</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
            </div>
            <button onClick={loadInvoices} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Reîncarcă
            </button>

            {selectedIds.size > 0 && (
              <>
                <button onClick={batchUpload} disabled={batchUploading}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:opacity-50">
                  {batchUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Transmite selectate ({selectedIds.size})
                </button>
              </>
            )}
            <button onClick={batchCheckStatus} disabled={batchCheckingStatus}
              className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50 ml-auto">
              {batchCheckingStatus ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Verifică stare toate
            </button>
          </div>

          {/* Invoices table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {loading ? (
              <div className="p-8 text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-amber-500 mb-2" />
                <p className="text-gray-500 text-sm">Se încarcă facturile…</p>
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>Nicio factură găsită pentru perioada selectată.</p>
                {filterStatus !== "all" && (
                  <button onClick={() => setFilterStatus("all")} className="mt-2 text-sm text-amber-600 hover:underline">Afișează toate</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left">
                        <input type="checkbox" checked={selectedIds.size === filteredInvoices.length && filteredInvoices.length > 0}
                          onChange={toggleAll} className="rounded" />
                      </th>
                      <th className="px-4 py-3 text-left text-gray-600">Nr. factură</th>
                      <th className="px-4 py-3 text-left text-gray-600">Data</th>
                      <th className="px-4 py-3 text-left text-gray-600">Client</th>
                      <th className="px-4 py-3 text-right text-gray-600">Total</th>
                      <th className="px-4 py-3 text-center text-gray-600">Stare SPV</th>
                      <th className="px-4 py-3 text-left text-gray-600">ID încărcare</th>
                      <th className="px-4 py-3 text-center text-gray-600">Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredInvoices.map((inv) => {
                      const isExpanded = expandedRows.has(inv.id);
                      const spvStatus = inv.spv_status || "none";
                      const canUpload = !["uploading", "validated"].includes(spvStatus);
                      const canCheck = ["uploaded", "processing"].includes(spvStatus);
                      const canDownload = !!inv.spv_download_id;

                      return (
                        <React.Fragment key={inv.id}>
                          <tr className={`hover:bg-gray-50 ${selectedIds.has(inv.id) ? "bg-amber-50" : ""}`}>
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)} className="rounded" />
                            </td>
                            <td className="px-4 py-3 font-medium">{inv.invoice_code || inv.id}</td>
                            <td className="px-4 py-3 text-gray-600">{inv.document_date || "—"}</td>
                            <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                              {inv.client_name || inv.bt_44_buyer_name || "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-medium">
                              {inv.total_with_vat != null ? `${Number(inv.total_with_vat).toFixed(2)} RON` : "—"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <StatusBadge status={spvStatus} />
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-500">
                              {inv.spv_upload_id || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-center flex-wrap">
                                {/* Upload / transmit */}
                                <button
                                  onClick={() => uploadInvoice(inv)}
                                  disabled={!canUpload || uploading[inv.id]}
                                  title={canUpload ? "Transmite în SPV" : "Deja transmisă/validată"}
                                  className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors ${
                                    canUpload
                                      ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                  }`}>
                                  {uploading[inv.id]
                                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    : <Upload className="w-3.5 h-3.5" />}
                                </button>

                                {/* Check status */}
                                {canCheck && (
                                  <button
                                    onClick={() => checkStatus(inv)}
                                    disabled={checkingStatus[inv.id]}
                                    title="Verifică stare în SPV"
                                    className="p-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1">
                                    {checkingStatus[inv.id]
                                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      : <RefreshCw className="w-3.5 h-3.5" />}
                                  </button>
                                )}

                                {/* Download XML */}
                                <button
                                  onClick={() => downloadXml(inv)}
                                  title="Descarcă XML UBL"
                                  className="p-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                                  <FileCode className="w-3.5 h-3.5" />
                                </button>

                                {/* Download ANAF response */}
                                {canDownload && (
                                  <button
                                    onClick={() => downloadResponse(inv)}
                                    title="Descarcă răspuns ANAF (ZIP)"
                                    className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200">
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {/* Detail / response */}
                                <button
                                  onClick={() => setDetailModal(inv)}
                                  title="Detalii răspuns SPV"
                                  className="p-1.5 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200">
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                {/* Expand row */}
                                <button
                                  onClick={() => setExpandedRows(prev => {
                                    const next = new Set(prev);
                                    next.has(inv.id) ? next.delete(inv.id) : next.add(inv.id);
                                    return next;
                                  })}
                                  title="Expandează detalii"
                                  className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded row – quick response preview */}
                          {isExpanded && (
                            <tr className="bg-gray-50">
                              <td colSpan={8} className="px-6 py-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gray-600">
                                  <div><span className="font-medium">ID încărcare:</span> {inv.spv_upload_id || "—"}</div>
                                  <div><span className="font-medium">ID descarcare:</span> {inv.spv_download_id || "—"}</div>
                                  <div><span className="font-medium">Încărcat la:</span> {inv.spv_uploaded_at ? new Date(inv.spv_uploaded_at).toLocaleString("ro-RO") : "—"}</div>
                                  <div><span className="font-medium">Stare:</span> <StatusBadge status={inv.spv_status || "none"} /></div>
                                </div>
                                {inv.spv_response && (
                                  <div className="mt-2">
                                    <p className="text-xs font-medium text-gray-500 mb-1">Răspuns ANAF:</p>
                                    <pre className="bg-white border rounded p-2 text-xs overflow-auto max-h-40 whitespace-pre-wrap">
                                      {(() => { try { return JSON.stringify(JSON.parse(inv.spv_response), null, 2); } catch { return inv.spv_response; } })()}
                                    </pre>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "messages" && <MessagesTab API_URL={API_URL} showMessage={showMessage} />}

      {showSettings && <SettingsPanel API_URL={API_URL} onClose={() => setShowSettings(false)} onSaved={() => setShowSettings(false)} />}
      {detailModal && <ResponseModal invoice={detailModal} onClose={() => setDetailModal(null)} />}
    </div>
  );
};

export default EfacturaScreen;
