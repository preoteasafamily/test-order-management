import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  RefreshCw,
  Settings,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Eye,
  Trash2,
  ChevronDown,
  ChevronUp,
  Info,
  LogOut,
  Send,
  List,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (ts) => {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("ro-RO");
  } catch {
    return String(ts);
  }
};

const secondsLeft = (expiresAt) => {
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
};

// Generate UBL 2.1 XML for a billing invoice (same logic as InvoicesV2Screen)
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const generateUBLXml = (inv, company, client) => {
  const snap =
    inv.raw_snapshot && typeof inv.raw_snapshot === "object"
      ? inv.raw_snapshot
      : inv.raw_snapshot
      ? (() => { try { return JSON.parse(inv.raw_snapshot); } catch { return {}; } })()
      : {};

  const issueDate  = inv.document_date || inv.bt_2_issue_date || new Date().toISOString().split("T")[0];
  const dueDate    = snap.dueDate       || inv.bt_9_due_date  || issueDate;
  const invoiceNum = inv.invoice_code   || inv.bt_1_invoice_number || String(inv.id);

  const sellerName     = company?.bt_27_seller_name             || "";
  const sellerVAT      = company?.bt_31_32_seller_vat_identifier || company?.bt_29_seller_identifier || "";
  const sellerReg      = company?.bt_30_seller_legal_registration || "";
  const sellerAddr     = company?.bt_35_seller_address           || "";
  const sellerCity     = company?.bt_37_seller_city              || "";
  const sellerRegion   = company?.bt_39_seller_region            || "";
  const sellerCountry  = company?.bt_40_seller_country           || "RO";
  const sellerPhone    = company?.bt_42_seller_phone             || "";
  const sellerEmail    = company?.bt_43_seller_email             || "";
  const payeeIBAN      = company?.bt_84_payee_iban               || "";
  const payeeBankName  = company?.bt_85_payee_bank_name          || "";
  const paymentCode    = company?.bt_81_payment_means_code       || "42";

  const cName     = snap.clientName      || client?.nume        || "";
  const cCIF      = snap.clientCIF       || client?.cif         || "";
  const cNrReg    = snap.clientNrRegCom  || client?.nrRegCom    || "";
  const cStrada   = snap.clientStrada    || client?.strada      || "";
  const cLoc      = snap.clientLocalitate|| client?.localitate  || "";
  const cJudet    = snap.clientJudet     || client?.judet       || "";
  const cCountry  = snap.clientTara      || client?.buyer_country || "RO";
  const nrComanda = snap.nrComanda       || null;

  // Items
  const items = (() => {
    try {
      return snap.items
        ? typeof snap.items === "string"
          ? JSON.parse(snap.items)
          : snap.items
        : [];
    } catch {
      return [];
    }
  })();

  const vatGroups = {};
  for (const it of items) {
    const rate  = Number(it.cotaTVA ?? it.tva ?? 19);
    const total = Number(it.cantitate ?? 1) * Number(it.pret ?? 0);
    const vat   = total * rate / 100;
    vatGroups[rate] = vatGroups[rate] || { taxable: 0, vat: 0 };
    vatGroups[rate].taxable += total;
    vatGroups[rate].vat     += vat;
  }

  const totalBase = Object.values(vatGroups).reduce((s, g) => s + g.taxable, 0);
  const totalVAT  = Object.values(vatGroups).reduce((s, g) => s + g.vat, 0);
  const totalDue  = totalBase + totalVAT;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${esc(invoiceNum)}</cbc:ID>
  <cbc:IssueDate>${esc(issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${esc(dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>\n`;

  if (nrComanda) {
    xml += `  <cac:OrderReference>\n    <cbc:ID>${esc(nrComanda)}</cbc:ID>\n  </cac:OrderReference>\n`;
  }

  xml += `  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="9944">${esc(sellerVAT)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${esc(sellerName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(sellerAddr)}</cbc:StreetName>
        <cbc:CityName>${esc(sellerCity)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(sellerRegion)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(sellerCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(sellerVAT)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:CompanyID>${esc(sellerReg)}</cbc:CompanyID></cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Telephone>${esc(sellerPhone)}</cbc:Telephone>
        <cbc:ElectronicMail>${esc(sellerEmail)}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(cName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(cStrada)}</cbc:StreetName>
        <cbc:CityName>${esc(cLoc)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(cJudet)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(cCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(cCIF)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:CompanyID>${esc(cNrReg)}</cbc:CompanyID></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(paymentCode)}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(payeeIBAN)}</cbc:ID>
      <cbc:Name>${esc(payeeBankName)}</cbc:Name>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>\n`;

  // TaxTotal
  xml += `  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID="RON">${totalVAT.toFixed(2)}</cbc:TaxAmount>\n`;
  for (const [rate, g] of Object.entries(vatGroups)) {
    xml += `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">${g.taxable.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">${g.vat.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>\n`;
  }
  xml += `  </cac:TaxTotal>\n`;

  xml += `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${totalBase.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${totalBase.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${totalDue.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">${totalDue.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>\n`;

  items.forEach((it, idx) => {
    const qty   = Number(it.cantitate ?? 1);
    const price = Number(it.pret ?? 0);
    const rate  = Number(it.cotaTVA ?? it.tva ?? 19);
    const net   = qty * price;
    const name  = it.descriere || it.name || `Produs ${idx + 1}`;
    const um    = it.um || "BUC";
    const code  = it.codArticolFurnizor || it.codProductie || "";
    const barcode = it.codBare || "";

    xml += `  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(um)}">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${net.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(name)}</cbc:Name>
      ${code ? `<cac:SellersItemIdentification><cbc:ID>${esc(code)}</cbc:ID></cac:SellersItemIdentification>` : ""}
      ${barcode ? `<cac:StandardItemIdentification><cbc:ID schemeID="0160">${esc(barcode)}</cbc:ID></cac:StandardItemIdentification>` : ""}
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="RON">${price.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>\n`;
  });

  xml += `</Invoice>`;
  return xml;
};

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONF = {
  pending:   { label: "În așteptare",  color: "bg-gray-100 text-gray-700",   icon: Clock },
  uploading: { label: "Se trimite…",   color: "bg-blue-100 text-blue-700",   icon: Upload },
  uploaded:  { label: "Trimis",        color: "bg-cyan-100 text-cyan-700",   icon: Clock },
  processing:{ label: "În procesare",  color: "bg-yellow-100 text-yellow-700", icon: Clock },
  ok:        { label: "Validat OK",    color: "bg-green-100 text-green-800", icon: CheckCircle },
  error:     { label: "Eroare",        color: "bg-red-100 text-red-700",     icon: XCircle },
  nok:       { label: "Respins",       color: "bg-red-200 text-red-800",     icon: XCircle },
};

const StatusBadge = ({ status }) => {
  const conf = STATUS_CONF[status] || STATUS_CONF.pending;
  const Icon = conf.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${conf.color}`}>
      <Icon className="w-3 h-3" />
      {conf.label}
    </span>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const EFacturaScreen = ({ API_URL, orders = [], clients = [], agents = [], products = [], showMessage }) => {
  // ── Configuration state ──
  const [config, setConfig] = useState({
    client_id: "", client_secret: "", redirect_uri: "", cif: "", environment: "test",
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showConfig, setShowConfig]     = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [serverConfig, setServerConfig] = useState(null);

  // ── OAuth state ──
  const [authCode, setAuthCode]         = useState("");
  const [exchanging, setExchanging]     = useState(false);
  const [refreshing, setRefreshing]     = useState(false);

  // ── Invoice list state ──
  const [invoices, setInvoices]         = useState([]);
  const [loadingInv, setLoadingInv]     = useState(false);
  const [dateFilter, setDateFilter]     = useState("");
  const [uploadStatuses, setUploadStatuses] = useState({});  // invoiceId → status obj

  // ── Messages list (SPV) ──
  const [messages, setMessages]         = useState([]);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);
  const [showMessages, setShowMessages] = useState(false);

  // ── Token status refresh ──
  const tokenRefTimer = useRef(null);

  // ─── Load server config ────────────────────────────────────────────────────

  const loadServerConfig = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/anaf/config`);
      if (!r.ok) return;
      const data = await r.json();
      setServerConfig(data);
      setConfig(prev => ({
        ...prev,
        client_id:    data.client_id    || "",
        redirect_uri: data.redirect_uri || "",
        cif:          data.cif          || "",
        environment:  data.environment  || "test",
        client_secret: "",  // never pre-fill secret
      }));
      setConfigLoaded(true);
    } catch {
      setConfigLoaded(true);
    }
  }, [API_URL]);

  useEffect(() => { loadServerConfig(); }, [loadServerConfig]);

  // Auto-refresh token status every 30 seconds
  useEffect(() => {
    tokenRefTimer.current = setInterval(loadServerConfig, 30_000);
    return () => clearInterval(tokenRefTimer.current);
  }, [loadServerConfig]);

  // ─── Load invoices ─────────────────────────────────────────────────────────

  const loadInvoices = useCallback(async () => {
    setLoadingInv(true);
    try {
      const r = await fetch(`${API_URL}/api/billing/local-invoices`);
      if (!r.ok) throw new Error("Eroare la încărcarea facturilor.");
      const data = await r.json();
      setInvoices(data);
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      setLoadingInv(false);
    }
  }, [API_URL, showMessage]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  // ─── Save configuration ────────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    if (!config.client_id || !config.redirect_uri || !config.cif) {
      showMessage("Completați cel puțin client_id, redirect_uri și CIF.", "error");
      return;
    }
    setSavingConfig(true);
    try {
      const payload = {
        client_id:    config.client_id.trim(),
        redirect_uri: config.redirect_uri.trim(),
        cif:          config.cif.trim(),
        environment:  config.environment,
      };
      if (config.client_secret.trim()) {
        payload.client_secret = config.client_secret.trim();
      }
      const r = await fetch(`${API_URL}/api/anaf/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Eroare la salvare.");
      showMessage("Configurare ANAF salvată!", "success");
      setConfig(prev => ({ ...prev, client_secret: "" }));
      await loadServerConfig();
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      setSavingConfig(false);
    }
  };

  // ─── Authorization flow ────────────────────────────────────────────────────

  const handleAuthorize = async () => {
    try {
      const r = await fetch(`${API_URL}/api/anaf/authorize-url`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Eroare la generarea URL-ului de autorizare.");
      window.open(data.url, "_blank", "noopener,noreferrer");
      showMessage(
        "Fereastra de autorizare ANAF a fost deschisă. Autentificați-vă cu certificatul digital, apoi copiați codul din URL-ul de redirecționare și lipiți-l mai jos.",
        "info"
      );
    } catch (err) {
      showMessage(err.message, "error");
    }
  };

  const handleExchangeCode = async () => {
    if (!authCode.trim()) {
      showMessage("Introduceți codul de autorizare.", "error");
      return;
    }
    setExchanging(true);
    try {
      const r = await fetch(`${API_URL}/api/anaf/oauth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authCode.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Eroare la schimbul codului.");
      showMessage(`Token ANAF obținut! Expiră în ${data.expires_in}s.`, "success");
      setAuthCode("");
      await loadServerConfig();
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      setExchanging(false);
    }
  };

  const handleRefreshToken = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`${API_URL}/api/anaf/token/refresh`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Eroare la reîmprospătare.");
      showMessage(`Token reîmprospătat! Expiră în ${data.expires_in}s.`, "success");
      await loadServerConfig();
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!window.confirm("Ștergeți token-ul ANAF stocat? Va fi necesară o nouă autorizare.")) return;
    try {
      await fetch(`${API_URL}/api/anaf/token`, { method: "DELETE" });
      showMessage("Token ANAF șters.", "info");
      await loadServerConfig();
    } catch (err) {
      showMessage(err.message, "error");
    }
  };

  // ─── Upload single invoice ─────────────────────────────────────────────────

  const uploadInvoice = async (inv) => {
    const invId = inv.id;

    // Get client
    const client = clients.find(c => c.id === inv.external_client_id) || null;

    // Get company config
    let company = null;
    try {
      const cr = await fetch(`${API_URL}/api/config/company`);
      if (cr.ok) company = await cr.json();
    } catch {}

    setUploadStatuses(prev => ({ ...prev, [invId]: { status: "uploading", ts: Date.now() } }));

    try {
      const xml = generateUBLXml(inv, company, client);
      const r = await fetch(`${API_URL}/api/anaf/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml, environment: serverConfig?.environment }),
      });
      const data = await r.json();

      if (!r.ok) {
        setUploadStatuses(prev => ({
          ...prev,
          [invId]: { status: "error", error: data.error || "Eroare upload", ts: Date.now(), anaf: data.anaf_response },
        }));
        return;
      }

      const idIncarcare = data.id_incarcare;
      setUploadStatuses(prev => ({
        ...prev,
        [invId]: { status: "uploaded", idIncarcare, ts: Date.now(), anaf: data.anaf_response },
      }));

      // Poll status
      if (idIncarcare) {
        pollStatus(invId, idIncarcare);
      }
    } catch (err) {
      setUploadStatuses(prev => ({
        ...prev,
        [invId]: { status: "error", error: err.message, ts: Date.now() },
      }));
    }
  };

  const pollStatus = async (invId, idIncarcare, attempts = 0) => {
    if (attempts > 10) return;
    const env = serverConfig?.environment || "test";
    try {
      await new Promise(r => setTimeout(r, 3000 + attempts * 1000));
      const r = await fetch(`${API_URL}/api/anaf/status/${idIncarcare}?environment=${env}`);
      const data = await r.json();
      const stare = data.anaf_response?.stare || data.anaf_response?.ExecutionStatus || "";

      let status = "processing";
      if (stare === "ok" || stare === "OK") status = "ok";
      else if (stare === "nok" || stare === "NOK" || stare === "Eroare") status = "nok";
      else if (stare === "in prelucrare" || stare === "PRELUCRARE") status = "processing";

      setUploadStatuses(prev => ({
        ...prev,
        [invId]: {
          ...prev[invId],
          status,
          stare,
          ts: Date.now(),
          anaf: data.anaf_response,
          idIncarcare,
        },
      }));

      if (status === "processing") {
        pollStatus(invId, idIncarcare, attempts + 1);
      }
    } catch {}
  };

  // ─── Check status manually ─────────────────────────────────────────────────

  const checkStatus = async (invId) => {
    const us = uploadStatuses[invId];
    if (!us?.idIncarcare) return;
    pollStatus(invId, us.idIncarcare, 0);
  };

  // ─── Upload all visible invoices ───────────────────────────────────────────

  const uploadAll = async (visibleInvoices) => {
    if (!serverConfig?.token_status?.is_valid) {
      showMessage("Token ANAF invalid. Autorizați-vă mai întâi.", "error");
      return;
    }
    for (const inv of visibleInvoices) {
      await uploadInvoice(inv);
    }
  };

  // ─── Load SPV messages ─────────────────────────────────────────────────────

  const loadMessages = async () => {
    setLoadingMsgs(true);
    try {
      const env = serverConfig?.environment || "test";
      const cif = serverConfig?.cif || "";
      const r = await fetch(`${API_URL}/api/anaf/messages?zile=60&tip=E&environment=${env}&cif=${cif}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Eroare la încărcarea mesajelor.");
      setMessages(data.messages || []);
      setShowMessages(true);
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      setLoadingMsgs(false);
    }
  };

  // ─── Derived ───────────────────────────────────────────────────────────────

  const visibleInvoices = dateFilter
    ? invoices.filter(inv => inv.document_date === dateFilter)
    : invoices;

  const tokenStatus = serverConfig?.token_status;
  const tokenValid  = tokenStatus?.is_valid;
  const sLeft       = tokenValid ? secondsLeft(tokenStatus?.expires_at) : 0;

  // Available dates
  const dates = [...new Set(invoices.map(i => i.document_date).filter(Boolean))].sort().reverse();

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">e-Factura SPV – ANAF</h1>
          <p className="text-sm text-gray-500 mt-1">
            Transmitere facturi electronice în Sistemul Național e-Factura (SPV ANAF)
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm"
          >
            <Settings className="w-4 h-4" />
            Configurare OAuth2
            {showConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={loadInvoices}
            disabled={loadingInv}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loadingInv ? "animate-spin" : ""}`} />
            Reîncarcă facturi
          </button>
        </div>
      </div>

      {/* ── Environment notice ── */}
      {serverConfig && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
          serverConfig.environment === "prod"
            ? "bg-red-50 border border-red-200 text-red-800"
            : "bg-blue-50 border border-blue-200 text-blue-800"
        }`}>
          <Info className="w-4 h-4 flex-shrink-0" />
          <span>
            Mediu activ: <strong>{serverConfig.environment === "prod" ? "PRODUCȚIE" : "TEST (sandbox)"}</strong>
            {serverConfig.environment === "test" && " – facturile nu vor fi procesate real de ANAF"}
          </span>
        </div>
      )}

      {/* ── Configuration Panel ── */}
      {showConfig && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-500" />
            Configurare înregistrare aplicație ANAF
          </h2>

          {/* Registration instructions */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-2">
            <p className="font-semibold">📋 Pași pentru înregistrarea aplicației la ANAF:</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>Accesați <a href="https://www.anaf.ro/anaf/internet/ANAF/servicii_online/inreg_api" target="_blank" rel="noopener noreferrer" className="underline text-amber-700 hover:text-amber-900">portalul de înregistrare API ANAF <ExternalLink className="w-3 h-3 inline" /></a></li>
              <li>Creați cont de dezvoltator (dacă nu aveți)</li>
              <li>Înregistrați o nouă aplicație, specificând:
                <ul className="list-disc ml-4 mt-1">
                  <li>Numele aplicației</li>
                  <li>URL de callback (redirect_uri) – trebuie să fie exact URL-ul de mai jos</li>
                  <li>Serviciul: e-Factura</li>
                </ul>
              </li>
              <li>Copiați <strong>Client ID</strong> și <strong>Client Secret</strong> generate</li>
              <li>Introduceți-le în câmpurile de mai jos și salvați</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={config.client_id}
                onChange={e => setConfig(prev => ({ ...prev, client_id: e.target.value }))}
                placeholder="client_id de la portalul ANAF"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Secret {serverConfig?.has_secret && <span className="text-green-600 text-xs">(salvat)</span>}
              </label>
              <input
                type="password"
                value={config.client_secret}
                onChange={e => setConfig(prev => ({ ...prev, client_secret: e.target.value }))}
                placeholder={serverConfig?.has_secret ? "••••••• (lasați gol pentru a păstra)" : "client_secret de la portalul ANAF"}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Redirect URI (Callback URL) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={config.redirect_uri}
                onChange={e => setConfig(prev => ({ ...prev, redirect_uri: e.target.value }))}
                placeholder="ex: https://aplicatia-mea.ro/oauth/callback"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
              <p className="text-xs text-gray-500 mt-1">
                Trebuie să fie identic cu URL-ul înregistrat în portalul ANAF. Dacă aplicația rulează local, folosiți un URL public (ngrok, tunnel etc.) sau înregistrați-o cu IP fix.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CIF Furnizor <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={config.cif}
                onChange={e => setConfig(prev => ({ ...prev, cif: e.target.value }))}
                placeholder="ex: RO12345678"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mediu</label>
              <select
                value={config.environment}
                onChange={e => setConfig(prev => ({ ...prev, environment: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="test">TEST (sandbox – recomandat pentru testare)</option>
                <option value="prod">PRODUCȚIE (real ANAF – atenție!)</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50"
            >
              {savingConfig ? "Salvez…" : "Salvează configurarea"}
            </button>
          </div>
        </div>
      )}

      {/* ── OAuth2 Authorization Panel ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <ExternalLink className="w-5 h-5 text-blue-500" />
          Autorizare OAuth2 ANAF
        </h2>

        {/* Token Status */}
        <div className={`flex items-center gap-3 p-3 rounded-lg ${
          tokenValid
            ? "bg-green-50 border border-green-200"
            : tokenStatus?.has_token
            ? "bg-yellow-50 border border-yellow-200"
            : "bg-gray-50 border border-gray-200"
        }`}>
          {tokenValid ? (
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          ) : tokenStatus?.has_token ? (
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {tokenValid ? (
              <p className="text-sm text-green-800 font-medium">
                Token valid – expiră în {sLeft}s ({fmtDate(tokenStatus?.expires_at)})
              </p>
            ) : tokenStatus?.has_token ? (
              <p className="text-sm text-yellow-800 font-medium">
                Token expirat (obținut: {fmtDate(tokenStatus?.obtained_at)})
                {tokenStatus?.has_refresh && " – puteți reîmprospăta mai jos"}
              </p>
            ) : (
              <p className="text-sm text-gray-600">Nu există token ANAF. Autorizați aplicația.</p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {tokenStatus?.has_refresh && (
              <button
                onClick={handleRefreshToken}
                disabled={refreshing}
                className="flex items-center gap-1 px-3 py-1.5 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
                Reîmprospătare
              </button>
            )}
            {tokenStatus?.has_token && (
              <button
                onClick={handleRevokeToken}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-xs"
              >
                <LogOut className="w-3 h-3" />
                Deconectare
              </button>
            )}
          </div>
        </div>

        {/* Step 1: Authorize */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Pasul 1: Deschideți pagina de autorizare ANAF (necesită certificat digital)
          </p>
          <button
            onClick={handleAuthorize}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Autorizează în ANAF (logincert.anaf.ro)
          </button>
          <p className="text-xs text-gray-500">
            Se va deschide o fereastră nouă. Autentificați-vă cu certificatul digital calificat, aprobați accesul, iar ANAF vă va redirecționa la redirect_uri cu un parametru <code className="bg-gray-100 px-1 rounded">?code=...</code>.
          </p>
        </div>

        {/* Step 2: Exchange code */}
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-700">
            Pasul 2: Copiați codul din URL și introduceți-l mai jos
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={authCode}
              onChange={e => setAuthCode(e.target.value)}
              placeholder="Copiați valoarea parametrului ?code= din URL-ul de redirecționare"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={handleExchangeCode}
              disabled={exchanging || !authCode.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {exchanging ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {exchanging ? "Se procesează…" : "Obțineți token"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Serverul va schimba codul pe <strong>access_token</strong> și <strong>refresh_token</strong> și le va stoca securizat. 
            Access token-ul expiră în 600s; refresh token-ul în 7200s.
          </p>
        </div>
      </div>

      {/* ── Invoice Upload Panel ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Upload className="w-5 h-5 text-green-600" />
            Transmitere facturi în SPV
          </h2>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={loadMessages}
              disabled={loadingMsgs || !tokenValid}
              title={!tokenValid ? "Autorizați mai întâi" : "Mesaje SPV (ultimele 60 zile)"}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm disabled:opacity-50"
            >
              <List className={`w-4 h-4 ${loadingMsgs ? "animate-pulse" : ""}`} />
              Mesaje SPV
            </button>
            <button
              onClick={() => uploadAll(visibleInvoices)}
              disabled={!tokenValid || visibleInvoices.length === 0}
              title={!tokenValid ? "Autorizați mai întâi" : ""}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Trimite toate {dateFilter ? `(${visibleInvoices.length})` : ""}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Filtrare dată:</label>
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Toate datele ({invoices.length})</option>
              {dates.map(d => (
                <option key={d} value={d}>
                  {d} ({invoices.filter(i => i.document_date === d).length} facturi)
                </option>
              ))}
            </select>
          </div>
          {!tokenValid && (
            <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
              <AlertTriangle className="w-3 h-3" />
              Autorizați-vă cu ANAF pentru a putea trimite facturi
            </div>
          )}
        </div>

        {/* Invoice table */}
        {loadingInv ? (
          <div className="text-center py-10 text-gray-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 opacity-40" />
            Se încarcă facturile…
          </div>
        ) : visibleInvoices.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            Nu există facturi{dateFilter ? ` pentru ${dateFilter}` : ""}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Cod factura</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Client</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Dată</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Total (RON)</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600">Status SPV</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map(inv => {
                  const us = uploadStatuses[inv.id];
                  const status = us?.status || "pending";
                  return (
                    <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs text-gray-800">
                        {inv.invoice_code || inv.id}
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">
                        {inv.client_name || "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{inv.document_date || "—"}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">
                        {Number(inv.total_with_vat ?? inv.total ?? 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <StatusBadge status={status} />
                          {us?.idIncarcare && (
                            <span className="text-xs text-gray-400 font-mono">#{us.idIncarcare}</span>
                          )}
                          {us?.error && (
                            <span className="text-xs text-red-600 max-w-[180px] truncate" title={us.error}>
                              {us.error}
                            </span>
                          )}
                          {us?.stare && (
                            <span className="text-xs text-gray-500">ANAF: {us.stare}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => uploadInvoice(inv)}
                            disabled={!tokenValid || status === "uploading"}
                            title={!tokenValid ? "Autorizați mai întâi" : "Trimite în SPV"}
                            className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs disabled:opacity-40"
                          >
                            <Upload className="w-3 h-3" />
                            Trimite
                          </button>
                          {us?.idIncarcare && (
                            <button
                              onClick={() => checkStatus(inv.id)}
                              title="Verifică statusul"
                              className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs"
                            >
                              <Eye className="w-3 h-3" />
                              Status
                            </button>
                          )}
                          {us?.anaf && (
                            <button
                              onClick={() => {
                                const w = window.open("", "_blank");
                                if (w) {
                                  w.document.write(
                                    `<pre style="font-family:monospace;white-space:pre-wrap;padding:20px">${JSON.stringify(us.anaf, null, 2)}</pre>`
                                  );
                                  w.document.close();
                                }
                              }}
                              title="Vizualizare răspuns ANAF"
                              className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 text-xs"
                            >
                              <Eye className="w-3 h-3" />
                              Răspuns
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SPV Messages Panel ── */}
      {showMessages && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <List className="w-5 h-5 text-purple-600" />
              Mesaje SPV (ultimele 60 zile – emise)
            </h2>
            <button onClick={() => setShowMessages(false)} className="text-gray-400 hover:text-gray-600">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          {messages.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">Nu s-au găsit mesaje în SPV.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-medium text-gray-600">ID Încărcare</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Dată</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">CIF Emitent</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Tip</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Stare</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((msg, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{msg.id || msg.index_incarcare || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{msg.data_creare || msg.data || "—"}</td>
                      <td className="px-3 py-2 text-gray-700">{msg.cif || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{msg.tip || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge status={
                          (msg.stare || "").toLowerCase() === "ok"  ? "ok"  :
                          (msg.stare || "").toLowerCase() === "nok" ? "nok" :
                          (msg.stare || "").toLowerCase().includes("prelucrare") ? "processing" :
                          "pending"
                        } />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Help Section ── */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <details>
          <summary className="font-semibold text-gray-700 cursor-pointer flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-500" />
            Ghid configurare și utilizare OAuth2 ANAF
          </summary>
          <div className="mt-4 space-y-4 text-sm text-gray-700">
            <section>
              <h3 className="font-semibold text-gray-800 mb-1">1. Înregistrare aplicație ANAF</h3>
              <p>Accesați <a href="https://www.anaf.ro/anaf/internet/ANAF/servicii_online/inreg_api" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">portalul de înregistrare API ANAF</a> și creați un cont de dezvoltator. Înregistrați aplicația specificând un <strong>Callback URL</strong> (redirect_uri) care să fie accesibil de pe internet. ANAF va genera un <strong>Client ID</strong> și un <strong>Client Secret</strong>.</p>
            </section>
            <section>
              <h3 className="font-semibold text-gray-800 mb-1">2. Configurare în aplicație</h3>
              <p>Deschideți panoul <em>Configurare OAuth2</em> de mai sus, introduceți Client ID, Client Secret, redirect_uri exactă (trebuie să coincidă cu ce ați înregistrat la ANAF), CIF-ul firmei și selectați mediul de testare sau producție.</p>
            </section>
            <section>
              <h3 className="font-semibold text-gray-800 mb-1">3. Autorizare (token inițial)</h3>
              <p>Apăsați <em>Autorizează în ANAF</em>. Se va deschide pagina de login ANAF cu certificat digital. Autentificați-vă și acordați accesul. ANAF vă va redirecționa la redirect_uri cu un cod în URL (ex: <code className="bg-gray-100 px-1 rounded">?code=abc123</code>). Copiați valoarea codului și lipiți-o în câmpul din Pasul 2, apoi apăsați <em>Obțineți token</em>.</p>
              <p className="mt-1 text-amber-700 font-medium">⚠️ Codul expiră rapid (~30s). Folosiți-l imediat.</p>
            </section>
            <section>
              <h3 className="font-semibold text-gray-800 mb-1">4. Transmitere facturi</h3>
              <p>Selectați data din filtru și apăsați <em>Trimite</em> pentru fiecare factură sau <em>Trimite toate</em> pentru batch. Aplicația va genera XML UBL 2.1 conform CIUS-RO și îl va încărca la ANAF. Puteți urmări statusul (În așteptare → Trimis → În procesare → Validat OK / Respins).</p>
            </section>
            <section>
              <h3 className="font-semibold text-gray-800 mb-1">5. Reîmprospătare token</h3>
              <p>Access token-ul expiră în 600 secunde (10 min). Dacă refresh_token este disponibil, apăsați <em>Reîmprospătare</em> fără a mai fi nevoie de autentificare cu certificatul. Refresh token-ul expiră în 7200s (2h); după aceea este necesară o nouă autorizare completă.</p>
            </section>
            <section>
              <h3 className="font-semibold text-gray-800 mb-1">6. Testare (mediu test ANAF)</h3>
              <p>Folosiți mediul <strong>TEST</strong> pentru validarea integrării. Facturile trimise în mediul test nu sunt procesate real; răspunsurile simulează fluxul real. Când sunteți siguri că totul funcționează, comutați pe <strong>PRODUCȚIE</strong>.</p>
            </section>
          </div>
        </details>
      </div>
    </div>
  );
};

export default EFacturaScreen;
