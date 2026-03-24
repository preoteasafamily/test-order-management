/**
 * EfacturaV3Screen.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Ecranul principal pentru modulul E-Factura SPV-V3.
 *
 * Modul complet nou (clean slate) cu:
 *   - Autentificare OAuth2 ANAF exclusiv prin browser (fără mTLS)
 *   - Import token JWT din Postman/curl
 *   - Încărcare facturi XML UBL 2.1 CIUS-RO
 *   - Verificare stare, descărcare răspuns
 *   - Mesaje SPV
 *   - Diagnosticare completă
 *   - Jurnal acțiuni
 *
 * Toate apelurile API sunt la prefix /api/efactura-v3/.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Upload, RefreshCw, Download, Settings, CheckCircle, XCircle,
  Clock, AlertTriangle, FileText, FileCode, ChevronDown, ChevronUp,
  Send, Inbox, Eye, X, Info, Key, ExternalLink, ShieldCheck,
  Copy, Globe, Shield, Clipboard, Trash2, Plus, Activity,
  Terminal, LogOut, Zap, BookOpen,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  none:       { label: "Neîncărcat",    color: "bg-gray-100 text-gray-600",     icon: Clock },
  uploading:  { label: "Se încarcă…",   color: "bg-blue-100 text-blue-700",     icon: RefreshCw },
  uploaded:   { label: "Transmisă",     color: "bg-cyan-100 text-cyan-700",     icon: Send },
  processing: { label: "În prelucrare", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  validated:  { label: "Validată ✓",   color: "bg-green-100 text-green-700",   icon: CheckCircle },
  rejected:   { label: "Respinsă ✗",  color: "bg-red-100 text-red-700",       icon: XCircle },
  error:      { label: "Eroare",        color: "bg-orange-100 text-orange-700", icon: AlertTriangle },
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

// ─── Alert component ──────────────────────────────────────────────────────────

const Alert = ({ type = "info", children, onClose }) => {
  const styles = {
    info:    "bg-blue-50 border-blue-200 text-blue-800",
    success: "bg-green-50 border-green-200 text-green-800",
    warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
    error:   "bg-red-50 border-red-200 text-red-800",
  };
  const icons = {
    info:    Info,
    success: CheckCircle,
    warning: AlertTriangle,
    error:   XCircle,
  };
  const Icon = icons[type] || Info;
  return (
    <div className={`flex items-start gap-2 border rounded-lg p-3 text-sm ${styles[type]}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} className="flex-shrink-0 opacity-60 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const EfacturaV3Screen = ({ apiUrl }) => {
  const API = `${apiUrl}/api/efactura-v3`;

  // ── State ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("invoices");
  const [loading, setLoading]     = useState(false);
  const [message, setMessage]     = useState(null);

  // Settings
  const [settings, setSettings]   = useState(null);
  const [editSettings, setEditSettings] = useState({
    cif: "", clientId: "", clientSecret: "", redirectUri: "",
    publicCallbackUrl: "", environment: "test",
  });

  // OAuth
  const [authUrl, setAuthUrl]     = useState(null);
  const [diagnostic, setDiagnostic] = useState(null);
  const [importToken, setImportToken] = useState({ access_token: "", refresh_token: "", expires_in: "3600" });

  // Invoices
  const [invoices, setInvoices]   = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [xmlPreview, setXmlPreview]   = useState(null);
  const [uploading, setUploading]     = useState(new Set());

  // Messages
  const [messages, setMessages]   = useState([]);

  // Action log
  const [actionLog, setActionLog] = useState([]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const showMsg = (type, text) => {
    setMessage({ type, text });
    if (type !== "error") setTimeout(() => setMessage(null), 5000);
  };

  const apiFetch = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
    return data;
  }, [API]);

  // ── Load initial data ─────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    try {
      const data = await apiFetch("/settings");
      setSettings(data);
      setEditSettings({
        cif:               data.cif              || "",
        clientId:          data.clientId         || "",
        clientSecret:      "",  // never pre-fill from server
        redirectUri:       data.redirectUri      || "",
        publicCallbackUrl: data.publicCallbackUrl || "",
        environment:       data.environment       || "test",
      });
    } catch (err) {
      showMsg("error", `Eroare la încărcarea setărilor: ${err.message}`);
    }
  }, [apiFetch]);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await apiFetch("/invoices?limit=50");
      setInvoices(data.invoices || []);
    } catch (err) {
      showMsg("error", `Eroare la încărcarea facturilor: ${err.message}`);
    }
  }, [apiFetch]);

  const loadMessages = useCallback(async () => {
    try {
      const data = await apiFetch("/local-messages");
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      showMsg("error", `Eroare la încărcarea mesajelor: ${err.message}`);
    }
  }, [apiFetch]);

  const loadActionLog = useCallback(async () => {
    try {
      const data = await apiFetch("/action-log");
      setActionLog(Array.isArray(data) ? data : []);
    } catch (err) {
      // non-critical
    }
  }, [apiFetch]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeTab === "invoices")  loadInvoices();
    if (activeTab === "messages")  loadMessages();
    if (activeTab === "log")       loadActionLog();
    if (activeTab === "diagnostic") loadDiagnostic();
  }, [activeTab]);

  // Check for OAuth callback result in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_success") === "1" && params.get("section") === "efactura-v3") {
      showMsg("success", "✓ Autentificare ANAF reușită! Token JWT obținut și salvat.");
      loadSettings();
      const url = new URL(window.location.href);
      url.searchParams.delete("oauth_success");
      url.searchParams.delete("section");
      window.history.replaceState({}, "", url);
    }
    if (params.get("oauth_error") && params.get("section") === "efactura-v3") {
      showMsg("error", `Eroare autentificare ANAF: ${decodeURIComponent(params.get("oauth_error"))}`);
      const url = new URL(window.location.href);
      url.searchParams.delete("oauth_error");
      url.searchParams.delete("section");
      window.history.replaceState({}, "", url);
    }
  }, []);

  // ── Settings actions ─────────────────────────────────────────────────────

  const saveSettings = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/settings", { method: "PUT", body: JSON.stringify(editSettings) });
      showMsg("success", "Setări salvate cu succes.");
      await loadSettings();
    } catch (err) {
      showMsg("error", `Eroare: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── OAuth actions ─────────────────────────────────────────────────────────

  const getAuthUrl = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/oauth/authorize");
      setAuthUrl(data.authUrl);
      showMsg("info", "URL autorizare generat. Deschideți URL-ul în browser pentru autentificare cu certificatul digital.");
    } catch (err) {
      showMsg("error", `Eroare: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const openAuthUrl = () => {
    if (authUrl) window.open(authUrl, "_blank", "width=900,height=700");
  };

  const refreshToken = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/oauth/refresh", { method: "POST" });
      showMsg("success", `Token reînnoit cu succes. Expiră: ${data.expiresAt}`);
      await loadSettings();
    } catch (err) {
      showMsg("error", `Eroare reînnoire token: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const importJwt = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/oauth/token-import", { method: "POST", body: JSON.stringify(importToken) });
      showMsg("success", "Token JWT importat cu succes.");
      setImportToken({ access_token: "", refresh_token: "", expires_in: "3600" });
      await loadSettings();
    } catch (err) {
      showMsg("error", `Eroare import token: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const clearToken = async () => {
    if (!confirm("Sigur ștergeți token-ul OAuth2? Va trebui să vă autentificați din nou.")) return;
    try {
      await apiFetch("/oauth/token", { method: "DELETE" });
      showMsg("success", "Token șters. Modulul SPV este deconectat.");
      await loadSettings();
    } catch (err) {
      showMsg("error", err.message);
    }
  };

  const loadDiagnostic = async () => {
    try {
      const data = await apiFetch("/oauth/diagnostic");
      setDiagnostic(data);
    } catch (err) {
      showMsg("error", err.message);
    }
  };

  // ── Invoice actions ───────────────────────────────────────────────────────

  const uploadInvoice = async (invoiceId) => {
    setUploading((prev) => new Set([...prev, invoiceId]));
    try {
      const data = await apiFetch(`/upload/${invoiceId}`, { method: "POST" });
      showMsg("success", `✓ Factură ${invoiceId} transmisă. ID ANAF: ${data.uploadId || "—"}`);
      await loadInvoices();
    } catch (err) {
      showMsg("error", `Eroare upload ${invoiceId}: ${err.message}`);
    } finally {
      setUploading((prev) => { const s = new Set(prev); s.delete(invoiceId); return s; });
    }
  };

  const uploadBatch = async () => {
    if (selectedIds.size === 0) {
      showMsg("warning", "Selectați cel puțin o factură.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch("/upload-batch", {
        method: "POST",
        body: JSON.stringify({ invoiceIds: [...selectedIds] }),
      });
      const ok  = data.results.filter((r) => r.ok).length;
      const err = data.results.filter((r) => !r.ok).length;
      showMsg(err === 0 ? "success" : "warning", `Lot: ${ok} transmise, ${err} cu erori.`);
      setSelectedIds(new Set());
      await loadInvoices();
    } catch (err) {
      showMsg("error", `Eroare lot: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const previewXml = async (invoiceId) => {
    try {
      const res = await fetch(`${API}/xml/${invoiceId}`);
      const text = await res.text();
      setXmlPreview({ id: invoiceId, xml: text });
    } catch (err) {
      showMsg("error", `Eroare previzualizare XML: ${err.message}`);
    }
  };

  const checkStatus = async (invoiceId) => {
    try {
      const data = await apiFetch(`/check-status/${invoiceId}`);
      showMsg("info", `Stare ANAF: ${JSON.stringify(data.statusData || data.raw || "—")}`);
    } catch (err) {
      showMsg("error", err.message);
    }
  };

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/messages?days=30");
      showMsg("success", `${data.count} mesaje preluate din ANAF.`);
      await loadMessages();
    } catch (err) {
      showMsg("error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === invoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((i) => i.id)));
    }
  };

  // ── Status indicator ──────────────────────────────────────────────────────

  const tokenReady = settings?.hasToken && settings?.tokenIsJwt && !settings?.tokenExpired;

  const StatusIndicator = () => (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
      tokenReady
        ? "bg-green-100 text-green-700"
        : "bg-red-100 text-red-700"
    }`}>
      {tokenReady ? <ShieldCheck className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
      {tokenReady
        ? `Conectat (${settings?.environment || "test"})`
        : "Neconectat"}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const tabs = [
    { id: "invoices",   label: "Facturi",           icon: FileText },
    { id: "auth",       label: "Autentificare",      icon: Key },
    { id: "auth-php",   label: "Autentificare-Php",  icon: Terminal },
    { id: "settings",   label: "Setări",             icon: Settings },
    { id: "messages",   label: "Mesaje SPV",         icon: Inbox },
    { id: "diagnostic", label: "Diagnosticare",      icon: Activity },
    { id: "log",        label: "Jurnal",             icon: Clock },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-blue-600" />
            e-Factura SPV <span className="bg-blue-600 text-white text-sm px-2 py-0.5 rounded-full">V3</span>
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Modul nou – autentificare OAuth2 ANAF + upload UBL 2.1 CIUS-RO</p>
        </div>
        <StatusIndicator />
      </div>

      {/* Global message */}
      {message && (
        <Alert type={message.type} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── TAB: FACTURI ─────────────────────────────────────────────────────── */}
      {activeTab === "invoices" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-gray-800">Facturi de transmis</h2>
            <div className="flex gap-2">
              <button
                onClick={loadInvoices}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border rounded-lg hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" /> Reîncarcă
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={uploadBatch}
                  disabled={loading || !tokenReady}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  Transmite lot ({selectedIds.size})
                </button>
              )}
            </div>
          </div>

          {!tokenReady && (
            <Alert type="warning">
              Token OAuth2 invalid sau lipsă. Autentificați-vă în tab-ul <strong>Autentificare</strong> înainte de a transmite facturi.
            </Alert>
          )}

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={invoices.length > 0 && selectedIds.size === invoices.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Factură</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Cumpărător</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Data</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600">Total</th>
                    <th className="px-3 py-3 text-center font-medium text-gray-600">Stare SPV</th>
                    <th className="px-3 py-3 text-center font-medium text-gray-600">Acțiuni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                        Nu există facturi. Generați facturi din modulul Facturare.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => {
                      const isUploading = uploading.has(inv.id);
                      return (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(inv.id)}
                              onChange={() => toggleSelect(inv.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">
                            {inv.invoice_code || inv.id}
                          </td>
                          <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">
                            {inv.bt_44_buyer_name || "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {inv.document_date || "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">
                            {inv.total_with_vat ? `${Number(inv.total_with_vat).toFixed(2)} RON` : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <StatusBadge status={inv.spv_status} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => previewXml(inv.id)}
                                title="Previzualizare XML"
                                className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                              >
                                <FileCode className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => uploadInvoice(inv.id)}
                                disabled={isUploading || !tokenReady}
                                title="Transmite în SPV"
                                className="p-1 hover:bg-blue-50 rounded text-blue-500 hover:text-blue-700 disabled:opacity-40"
                              >
                                {isUploading
                                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                                  : <Upload className="w-4 h-4" />
                                }
                              </button>
                              {inv.spv_status === "uploaded" && (
                                <button
                                  onClick={() => checkStatus(inv.id)}
                                  title="Verificare stare"
                                  className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AUTENTIFICARE ────────────────────────────────────────────────── */}
      {activeTab === "auth" && (
        <div className="space-y-6">

          {/* Status card */}
          <div className={`rounded-xl border p-4 ${tokenReady ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            <div className="flex items-start gap-3">
              {tokenReady
                ? <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
                : <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              }
              <div>
                <p className={`font-semibold ${tokenReady ? "text-green-800" : "text-red-800"}`}>
                  {tokenReady ? "Autentificat în ANAF SPV" : "Neautentificat"}
                </p>
                <p className="text-sm mt-0.5">
                  {tokenReady
                    ? `Token JWT valid, expiră: ${settings?.tokenExpiresAt ? new Date(settings.tokenExpiresAt).toLocaleString("ro-RO") : "—"}`
                    : settings?.hasToken && !settings?.tokenIsJwt
                      ? "Token stocat nu este JWT (lipsesc segmentele base64). Importați un token JWT."
                      : settings?.tokenExpired
                        ? "Token expirat. Reînnoinți sau autentificați-vă din nou."
                        : "Niciun token. Folosiți Pasul 1 sau 2 de mai jos."
                  }
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                {tokenReady && settings?.tokenExpiresAt && (
                  <button
                    onClick={refreshToken}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4" /> Reînnoire token
                  </button>
                )}
                {settings?.hasToken && (
                  <button
                    onClick={clearToken}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" /> Deconectare
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Pasul 1 – Autentificare automată */}
            <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                Autentificare automată (recomandat)
              </h3>
              <p className="text-sm text-gray-600">
                Generați URL-ul de autorizare ANAF, deschideți în browser și autentificați-vă
                cu certificatul digital calificat SPV. Token-ul JWT este salvat automat.
              </p>
              <div className="space-y-2">
                <button
                  onClick={getAuthUrl}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  <Globe className="w-5 h-5" />
                  Generează URL autorizare ANAF
                </button>
                {authUrl && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={authUrl}
                        readOnly
                        className="flex-1 text-xs bg-gray-50 border rounded px-2 py-1.5 font-mono"
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(authUrl)}
                        className="p-2 hover:bg-gray-100 rounded border"
                        title="Copiați URL"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={openAuthUrl}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Deschide în browser nou
                    </button>
                    <Alert type="info">
                      <p className="font-medium mb-1">Flux autentificare:</p>
                      <ol className="list-decimal list-inside space-y-0.5 text-xs">
                        <li>Deschideți URL-ul de autorizare în browser</li>
                        <li>Autentificați-vă cu certificatul digital calificat</li>
                        <li>ANAF vă va redirecționa înapoi automat</li>
                        <li>Token-ul JWT va fi salvat automat</li>
                      </ol>
                    </Alert>
                  </div>
                )}
              </div>
            </div>

            {/* Pasul 2 – Import manual */}
            <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                Import token JWT din Postman/curl
              </h3>
              <Alert type="warning">
                <p className="font-medium mb-1">Obligatoriu în Postman:</p>
                <p className="text-xs">
                  Advanced → Extra Parameters → adăugați: <br />
                  <code className="bg-yellow-100 px-1 rounded font-mono">token_content_type = jwt</code>
                  <br />Fără acest parametru, ANAF emite un token opac (hex) care returnează <strong>401</strong> la orice apel API.
                </p>
              </Alert>
              <form onSubmit={importJwt} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Access Token JWT <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={importToken.access_token}
                    onChange={(e) => setImportToken((p) => ({ ...p, access_token: e.target.value }))}
                    placeholder="eyJhbGciOiJSUz..."
                    rows={3}
                    required
                    className="w-full text-xs border rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                  <p className="text-xs text-gray-400 mt-0.5">
                    Trebuie să aibă 3 segmente base64 separate prin punct
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Refresh Token (opțional)
                  </label>
                  <input
                    type="text"
                    value={importToken.refresh_token}
                    onChange={(e) => setImportToken((p) => ({ ...p, refresh_token: e.target.value }))}
                    placeholder="refresh_token_..."
                    className="w-full text-xs border rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Valabilitate (secunde)
                  </label>
                  <input
                    type="number"
                    value={importToken.expires_in}
                    onChange={(e) => setImportToken((p) => ({ ...p, expires_in: e.target.value }))}
                    placeholder="3600"
                    className="w-full text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
                >
                  <Clipboard className="w-5 h-5" />
                  Importă Token JWT
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AUTENTIFICARE-PHP ──────────────────────────────────────────── */}
      {activeTab === "auth-php" && (
        <div className="space-y-6">

          {/* Titlu și descriere */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 p-5">
            <div className="flex items-start gap-3">
              <Terminal className="w-7 h-7 text-indigo-600 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-bold text-indigo-900">Autentificare ANAF – Flux complet (inspirat din PHP)</h2>
                <p className="text-sm text-indigo-700 mt-1">
                  Meniu complet pentru gestionarea autentificării ANAF OAuth2, bazat pe fluxul demonstrat în exemple PHP.
                  Toate operațiunile se efectuează exclusiv prin browser (fără mTLS / fără extragere cheie privată din stick).
                </p>
              </div>
            </div>
          </div>

          {/* STATUS TOKEN – card proeminent */}
          <div className={`rounded-xl border-2 p-5 ${
            tokenReady
              ? "bg-green-50 border-green-300"
              : settings?.tokenExpired
                ? "bg-orange-50 border-orange-300"
                : "bg-red-50 border-red-200"
          }`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                {tokenReady
                  ? <ShieldCheck className="w-8 h-8 text-green-600 flex-shrink-0" />
                  : settings?.tokenExpired
                    ? <AlertTriangle className="w-8 h-8 text-orange-500 flex-shrink-0" />
                    : <XCircle className="w-8 h-8 text-red-500 flex-shrink-0" />
                }
                <div>
                  <p className={`font-bold text-lg ${
                    tokenReady ? "text-green-800" : settings?.tokenExpired ? "text-orange-800" : "text-red-800"
                  }`}>
                    {tokenReady
                      ? "✓ Autentificat în ANAF SPV"
                      : settings?.tokenExpired
                        ? "⚠ Token expirat – reînnoire necesară"
                        : "✗ Neautentificat"}
                  </p>
                  <p className="text-sm mt-0.5 text-gray-600">
                    {tokenReady
                      ? `Token JWT valid · Expiră: ${settings?.tokenExpiresAt ? new Date(settings.tokenExpiresAt).toLocaleString("ro-RO") : "—"}`
                      : settings?.hasToken && !settings?.tokenIsJwt
                        ? "Tokenul stocat nu este JWT. Importați un token JWT (cu 3 segmente base64 separate prin punct)."
                        : settings?.tokenExpired
                          ? "Tokenul a expirat. Folosiți «Reînnoire token» sau porniți un flux nou."
                          : "Niciun token. Porniți fluxul de autentificare din Pasul 1."
                    }
                  </p>
                  {settings?.hasToken && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${settings.tokenIsJwt ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {settings.tokenIsJwt ? "✓ Format JWT" : "✗ Nu este JWT"}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full font-medium ${!settings.tokenExpired ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                        {settings.tokenExpired ? "⚠ Expirat" : "✓ Activ"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                        Mediu: {settings?.environment || "test"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Acțiuni rapide status */}
              <div className="flex flex-wrap gap-2">
                {settings?.hasToken && settings?.tokenExpiresAt && (
                  <button
                    onClick={refreshToken}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 disabled:opacity-50 font-medium"
                  >
                    <RefreshCw className="w-4 h-4" /> Reînnoire token
                  </button>
                )}
                {settings?.hasToken && (
                  <button
                    onClick={clearToken}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-medium"
                  >
                    <LogOut className="w-4 h-4" /> Deconectare
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* MENIU PRINCIPAL – Pași flux OAuth2 (inspirat din PHP) */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-500" />
              Meniu Autentificare ANAF – Flux complet OAuth2
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">

              {/* Acțiunea 1: Autentificare nouă */}
              <div className="flex flex-col gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
                  <span className="font-semibold text-blue-900 text-sm">Autentificare nouă</span>
                </div>
                <p className="text-xs text-blue-700">
                  Generați URL-ul ANAF și autentificați-vă cu certificatul digital calificat în browser.
                  <br /><span className="font-mono text-xs opacity-70">→ action=new</span>
                </p>
                <button
                  onClick={getAuthUrl}
                  disabled={loading}
                  className="mt-auto w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  <Globe className="w-4 h-4" />
                  Generează URL autorizare
                </button>
                {authUrl && (
                  <button
                    onClick={openAuthUrl}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 text-xs"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Deschide din nou
                  </button>
                )}
              </div>

              {/* Acțiunea 2: Reînnoire token */}
              <div className="flex flex-col gap-3 p-4 bg-orange-50 rounded-xl border border-orange-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 bg-orange-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
                  <span className="font-semibold text-orange-900 text-sm">Reînnoire token</span>
                </div>
                <p className="text-xs text-orange-700">
                  Obțineți un token de acces nou folosind refresh_token, fără certificat digital.
                  Funcționează chiar dacă access_token a expirat, cât timp refresh_token este valabil (365 zile de la emitere).
                  <br /><span className="font-mono text-xs opacity-70">→ action=refresh</span>
                </p>
                <button
                  onClick={refreshToken}
                  disabled={loading || !settings?.hasToken}
                  className="mt-auto w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 text-sm font-medium"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reînnoire token
                </button>
              </div>

              {/* Acțiunea 3: Info / Status token */}
              <div className="flex flex-col gap-3 p-4 bg-purple-50 rounded-xl border border-purple-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">3</span>
                  <span className="font-semibold text-purple-900 text-sm">Info debug token</span>
                </div>
                <p className="text-xs text-purple-700">
                  Vizualizați detalii complete despre configurare: stare token, tip, expirare, mediu.
                  Util pentru depanare și audit.
                  <br /><span className="font-mono text-xs opacity-70">→ action=info</span>
                </p>
                <button
                  onClick={() => { loadDiagnostic(); setActiveTab("diagnostic"); }}
                  className="mt-auto w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
                >
                  <Activity className="w-4 h-4" />
                  Diagnosticare completă
                </button>
              </div>

              {/* Acțiunea 4: Deconectare */}
              <div className="flex flex-col gap-3 p-4 bg-red-50 rounded-xl border border-red-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">4</span>
                  <span className="font-semibold text-red-900 text-sm">Deconectare</span>
                </div>
                <p className="text-xs text-red-700">
                  Ștergeți tokenul salvat local. Modulul SPV va fi deconectat. Va fi necesară o nouă autentificare.
                  <br /><span className="font-mono text-xs opacity-70">→ action=logout</span>
                </p>
                <button
                  onClick={clearToken}
                  disabled={!settings?.hasToken}
                  className="mt-auto w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  Deconectare
                </button>
              </div>
            </div>
          </div>

          {/* URL autorizare generat */}
          {authUrl && (
            <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-500" />
                URL autorizare generat (copiați în browser cu certificat)
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={authUrl}
                  readOnly
                  className="flex-1 text-xs bg-gray-50 border rounded px-3 py-2 font-mono"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(authUrl)}
                  className="p-2 hover:bg-gray-100 rounded border"
                  title="Copiați URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={openAuthUrl}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                <ExternalLink className="w-4 h-4" />
                Deschide browser nou (autentificare cu certificat digital)
              </button>
              <Alert type="info">
                <p className="font-medium mb-1">Pași de urmat după deschiderea browserului:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Selectați certificatul digital calificat din lista browserului</li>
                  <li>Introduceți PIN-ul token-ului USB dacă este solicitat</li>
                  <li>ANAF va redirecta automat înapoi – token-ul este salvat</li>
                  <li>Pagina curentă va afișa statusul «Autentificat»</li>
                </ol>
              </Alert>
            </div>
          )}

          {/* Flux PHP documentat */}
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-500" />
              Flux OAuth2 ANAF – Referință PHP (implementare echivalentă în Node.js)
            </h3>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="flex gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <span className="font-mono text-blue-600 font-bold text-xs whitespace-nowrap mt-0.5">Pas 1</span>
                <div>
                  <p className="font-medium text-blue-900">Inițiere autentificare (action=new)</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Se generează URL-ul de autorizare ANAF cu <code className="bg-blue-100 px-1 rounded">response_type=code&amp;token_content_type=jwt</code>.
                    Utilizatorul este redirectat în browser unde se autentifică cu certificatul digital.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 p-3 bg-cyan-50 rounded-lg border border-cyan-100">
                <span className="font-mono text-cyan-600 font-bold text-xs whitespace-nowrap mt-0.5">Pas 2</span>
                <div>
                  <p className="font-medium text-cyan-900">Callback – primire cod de autorizare</p>
                  <p className="text-xs text-cyan-700 mt-0.5">
                    ANAF apelează <code className="bg-cyan-100 px-1 rounded">/api/efactura-v3/oauth/callback?code=XXX&amp;state=YYY</code>.
                    Serverul verifică parametrul <code className="bg-cyan-100 px-1 rounded">state</code> anti-CSRF.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                <span className="font-mono text-green-600 font-bold text-xs whitespace-nowrap mt-0.5">Pas 3</span>
                <div>
                  <p className="font-medium text-green-900">Schimb cod → token (grant_type=authorization_code)</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    POST la <code className="bg-green-100 px-1 rounded">https://logincert.anaf.ro/anaf-oauth2/v1/token</code> cu
                    <code className="bg-green-100 px-1 rounded ml-1">Authorization: Basic base64(client_id:client_secret)</code>.
                    Returnează <strong>access_token</strong> (90 zile) și <strong>refresh_token</strong> (365 zile).
                  </p>
                </div>
              </div>
              <div className="flex gap-3 p-3 bg-orange-50 rounded-lg border border-orange-100">
                <span className="font-mono text-orange-600 font-bold text-xs whitespace-nowrap mt-0.5">Pas 4</span>
                <div>
                  <p className="font-medium text-orange-900">Reînnoire token (action=refresh)</p>
                  <p className="text-xs text-orange-700 mt-0.5">
                    Înainte de expirare, POST cu <code className="bg-orange-100 px-1 rounded">grant_type=refresh_token</code>.
                    Nu necesită certificat digital – se face automat din backend.
                    Token-ul nou are o nouă perioadă de valabilitate de 90 de zile.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Import token JWT din Postman */}
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Clipboard className="w-4 h-4 text-purple-500" />
              Import token JWT din Postman / curl (alternativă)
            </h3>
            <Alert type="warning">
              <p className="font-medium mb-1">Obligatoriu în Postman:</p>
              <p className="text-xs">
                La cererea de token, adăugați parametrul extra: <code className="bg-yellow-100 px-1 rounded font-mono">token_content_type = jwt</code><br />
                Fără acest parametru, ANAF emite un token opac (hex) care returnează <strong>401</strong> la orice apel API.
              </p>
            </Alert>
            <form onSubmit={importJwt} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Access Token JWT <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={importToken.access_token}
                  onChange={(e) => setImportToken((p) => ({ ...p, access_token: e.target.value }))}
                  placeholder="eyJhbGciOiJSUz..."
                  rows={3}
                  required
                  className="w-full text-xs border rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
                <p className="text-xs text-gray-400 mt-0.5">Trebuie să aibă 3 segmente base64 separate prin punct (header.payload.signature)</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Refresh Token (opțional)</label>
                  <input
                    type="text"
                    value={importToken.refresh_token}
                    onChange={(e) => setImportToken((p) => ({ ...p, refresh_token: e.target.value }))}
                    placeholder="refresh_token_..."
                    className="w-full text-xs border rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Valabilitate (secunde)</label>
                  <input
                    type="number"
                    value={importToken.expires_in}
                    onChange={(e) => setImportToken((p) => ({ ...p, expires_in: e.target.value }))}
                    placeholder="3600"
                    className="w-full text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium text-sm"
              >
                <Clipboard className="w-4 h-4" />
                Importă Token JWT
              </button>
            </form>
          </div>

          {/* Teste și diagnosticare */}
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-gray-500" />
              Script de diagnosticare – <code className="text-xs bg-gray-100 px-1 rounded">anaf-oauth2.test.js</code>
            </h3>
            <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono text-green-400 space-y-1">
              <p className="text-gray-400"># Rulare teste unitare OAuth2 (din directorul server/):</p>
              <p>cd server</p>
              <p>node tests/anaf-oauth2.test.js</p>
              <p className="text-gray-400 mt-2"># Sau via npm script:</p>
              <p>npm run test:oauth2</p>
              <p className="text-gray-400 mt-2"># Toate testele:</p>
              <p>npm test</p>
            </div>
            <p className="text-xs text-gray-600">
              Fișierul <code className="bg-gray-100 px-1 rounded">server/tests/anaf-oauth2.test.js</code> conține teste unitare pentru
              modulul <code className="bg-gray-100 px-1 rounded">services/anaf-oauth2/token-manager.js</code>:
              validare JWT, construire URL autorizare, schimb cod-token, refresh token, stocare criptată.
              Consultați <strong>README-EFACTURA-V3.md</strong> pentru documentație completă.
            </p>
          </div>
        </div>
      )}

      {/* ── TAB: SETĂRI ──────────────────────────────────────────────────────── */}
      {activeTab === "settings" && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Configurare SPV V3</h2>
          <form onSubmit={saveSettings} className="space-y-4 max-w-2xl">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CIF Firmă <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editSettings.cif}
                  onChange={(e) => setEditSettings((p) => ({ ...p, cif: e.target.value }))}
                  placeholder="RO12345678"
                  required
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mediu</label>
                <select
                  value={editSettings.environment}
                  onChange={(e) => setEditSettings((p) => ({ ...p, environment: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="test">Test (sandbox ANAF)</option>
                  <option value="prod">Producție</option>
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client ID OAuth2
                </label>
                <input
                  type="text"
                  value={editSettings.clientId}
                  onChange={(e) => setEditSettings((p) => ({ ...p, clientId: e.target.value }))}
                  placeholder="Din portalul ANAF logincert.anaf.ro"
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Secret OAuth2
                </label>
                <input
                  type="password"
                  value={editSettings.clientSecret}
                  onChange={(e) => setEditSettings((p) => ({ ...p, clientSecret: e.target.value }))}
                  placeholder="Lăsați gol pentru a păstra secretul existent"
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Public Callback URL
                <span className="ml-1 text-xs text-gray-400">(IP extern accesibil din internet)</span>
              </label>
              <input
                type="url"
                value={editSettings.publicCallbackUrl}
                onChange={(e) => setEditSettings((p) => ({ ...p, publicCallbackUrl: e.target.value }))}
                placeholder="https://IP_EXTERN:5000"
                className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <p className="text-xs text-gray-400 mt-1">
                Redirect URI complet: <code className="bg-gray-100 px-1 rounded">{editSettings.publicCallbackUrl}/api/efactura-v3/oauth/callback</code>
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-blue-800 mb-2 flex items-center gap-1.5">
                <Shield className="w-4 h-4" /> Configurare mTLS (server/.env)
              </p>
              <p className="text-blue-700 text-xs">
                Certificatele mTLS se configurează în fișierul <code className="bg-blue-100 px-1 rounded">server/.env</code>, nu în UI:
              </p>
              <pre className="bg-blue-100 rounded p-2 text-xs mt-2 text-blue-900 overflow-x-auto">{`ANAF_CERT_PATH=/cale/absoluta/cert.pem
ANAF_KEY_PATH=/cale/absoluta/key.pem
ANAF_CERT_PASSPHRASE=parola_optionala`}</pre>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Salvează Setările
            </button>
          </form>
        </div>
      )}

      {/* ── TAB: MESAJE ───────────────────────────────────────────────────────── */}
      {activeTab === "messages" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Mesaje SPV</h2>
            <div className="flex gap-2">
              <button
                onClick={loadMessages}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border rounded-lg hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" /> Reîncarcă local
              </button>
              <button
                onClick={fetchMessages}
                disabled={loading || !tokenReady}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Preia din ANAF (30 zile)
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">ID ANAF</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Tip</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Data</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Detalii</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">ID Descărcare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {messages.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                        Nu există mesaje. Folosiți „Preia din ANAF" pentru a le descărca.
                      </td>
                    </tr>
                  ) : (
                    messages.map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs">{m.anaf_message_id || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            m.tip === "EROARE" ? "bg-red-100 text-red-700" :
                            m.tip === "OK"     ? "bg-green-100 text-green-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{m.tip || "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{m.data_creare || "—"}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{m.detalii || "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">
                          {m.id_descarcare
                            ? (
                              <a
                                href={`${API}/download-message/${m.id_descarcare}`}
                                download
                                className="text-blue-600 hover:underline flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                                {m.id_descarcare}
                              </a>
                            )
                            : "—"
                          }
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: DIAGNOSTICARE ───────────────────────────────────────────────── */}
      {activeTab === "diagnostic" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Diagnosticare configurare</h2>
            <button
              onClick={loadDiagnostic}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4" /> Reîncarcă
            </button>
          </div>

          {diagnostic ? (
            <div className="space-y-4">
              <div className={`rounded-xl border p-4 ${diagnostic.ready ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                <div className="flex items-center gap-2">
                  {diagnostic.ready
                    ? <CheckCircle className="w-6 h-6 text-green-600" />
                    : <XCircle className="w-6 h-6 text-red-500" />
                  }
                  <span className={`font-semibold text-lg ${diagnostic.ready ? "text-green-800" : "text-red-800"}`}>
                    {diagnostic.ready ? "Modulul SPV V3 este configurat corect" : "Există probleme de configurare"}
                  </span>
                </div>
              </div>

              {diagnostic.issues?.length > 0 && (
                <div className="bg-white rounded-xl border shadow-sm p-4 space-y-2">
                  <h3 className="font-medium text-gray-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    Probleme detectate ({diagnostic.issues.length})
                  </h3>
                  <ul className="space-y-1">
                    {diagnostic.issues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                        <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-white rounded-xl border shadow-sm p-4">
                <h3 className="font-medium text-gray-800 mb-3">Detalii configurare</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {diagnostic.config && Object.entries(diagnostic.config).map(([key, val]) => {
                    const isOk = val === true || (typeof val === "string" && val && val !== "(nesetat)");
                    const isBad = val === false || val === null || val === "(nesetat)";
                    return (
                      <div key={key} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <span className="text-xs text-gray-600 font-mono">{key}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          isBad ? "bg-red-100 text-red-700" :
                          isOk  ? "bg-green-100 text-green-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {typeof val === "boolean" ? (val ? "✓" : "✗") : String(val)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Apăsați „Reîncarcă" pentru a rula diagnosticarea.</p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: JURNAL ──────────────────────────────────────────────────────── */}
      {activeTab === "log" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Jurnal acțiuni SPV</h2>
            <button
              onClick={loadActionLog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4" /> Reîncarcă
            </button>
          </div>
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Timp</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Acțiune</th>
                    <th className="px-3 py-3 text-center font-medium text-gray-600">Stare</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Eroare / Detalii</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {actionLog.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                        Jurnalul este gol.
                      </td>
                    </tr>
                  ) : (
                    actionLog.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleString("ro-RO")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{entry.action}</td>
                        <td className="px-3 py-2 text-center">
                          {entry.success
                            ? <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                            : <XCircle className="w-4 h-4 text-red-500 mx-auto" />
                          }
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">
                          {entry.error_message || (entry.details ? entry.details.substring(0, 80) : "—")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── XML Preview Modal ─────────────────────────────────────────────────── */}
      {xmlPreview && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FileCode className="w-5 h-5 text-blue-500" />
                XML UBL 2.1 CIUS-RO – {xmlPreview.id}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(xmlPreview.xml)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  <Copy className="w-4 h-4" /> Copiați
                </button>
                <button onClick={() => setXmlPreview(null)} className="p-1.5 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-all">
                {xmlPreview.xml}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EfacturaV3Screen;
