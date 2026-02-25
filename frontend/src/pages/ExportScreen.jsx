import React, { useState, useEffect } from "react";
import { Download } from "lucide-react";

// Default counter values
const DEFAULT_COUNTERS = { invoice: 0, receipt: 0, production: 0 };

const ExportScreen = ({
  orders,
  setOrders,
  clients,
  products,
  gestiuni,
  company,
  dayStatus,
  setDayStatus,
  currentUser,
  showMessage,
  saveData,
  API_URL,
}) => {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [exportMode, setExportMode] = useState("toExport"); // 'toExport' sau 'all'
  const [exportCount, setExportCount] = useState({});

  // Load export count from API
  useEffect(() => {
    const loadExportCount = async () => {
      try {
        const currentDate = new Date().toISOString().split("T")[0];
        const response = await fetch(`${API_URL}/api/export-counters/${currentDate}`);
        if (response.ok) {
          const data = await response.json();
          // Store counters by type: { "2026-02-09": { invoice: 0, receipt: 0, production: 0 } }
          setExportCount({
            [data.export_date]: {
              invoice: data.invoice_count || 0,
              receipt: data.receipt_count || 0,
              production: data.production_count || 0
            }
          });
        }
      } catch (error) {
        console.error("Error loading export count:", error);
      }
    };
    loadExportCount();
  }, [API_URL]);

  const ordersForDate = orders.filter((o) => o.date === selectedDate);
  const invoiceOrders = ordersForDate.filter((o) => !o.invoiceExported);
  const receiptOrders = ordersForDate.filter((o) => !o.receiptExported);

  const totalOrders = ordersForDate.length;
  const totalInvoices = invoiceOrders.length;
  const totalReceipts = receiptOrders.length;

  const isDayClosed = dayStatus[selectedDate]?.productionExported || false;

  // ✅ Generare XML Facturi
  const generateInvoicesXML = () => {
    if (invoiceOrders.length === 0) {
      showMessage("Nu sunt facturi neexportate pentru această dată! ", "error");
      return;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Facturi>\n';

    let invoiceNumber = 28; // Start from 28 based on example
    invoiceOrders.forEach((order) => {
      const client = clients.find((c) => c.id === order.clientId);

      xml += "  <Factura>\n";
      xml += "    <Antet>\n";
      xml += `      <FurnizorNume>${company.furnizorNume}</FurnizorNume>\n`;
      xml += `      <FurnizorCIF>${company.furnizorCIF}</FurnizorCIF>\n`;
      xml += `      <FurnizorNrRegCom>${company.furnizorNrRegCom}</FurnizorNrRegCom>\n`;
      xml += `      <FurnizorCapital>0.00</FurnizorCapital>\n`;
      xml += `      <FurnizorAdresa>${company.furnizorStrada}</FurnizorAdresa>\n`;
      xml += `      <FurnizorBanca>${company.banca || ""}</FurnizorBanca>\n`;
      xml += `      <FurnizorIBAN>${company.iban || ""}</FurnizorIBAN>\n`;
      xml += `      <FurnizorInformatiiSuplimentare></FurnizorInformatiiSuplimentare>\n`;
      xml += `      <ClientNume>${client.nume}</ClientNume>\n`;
      xml += `      <ClientInformatiiSuplimentare></ClientInformatiiSuplimentare>\n`;
      xml += `      <ClientCIF>${client.cif}</ClientCIF>\n`;
      xml += `      <ClientNrRegCom>${client.nrRegCom}</ClientNrRegCom>\n`;
      xml += `      <ClientJudet>${client.judet}</ClientJudet>\n`;
      xml += `      <ClientLocalitate>${client.localitate}</ClientLocalitate>\n`;
      xml += `      <ClientTara>RO</ClientTara>\n`;
      xml += `      <ClientAdresa>${client.strada}</ClientAdresa>\n`;
      xml += `      <ClientTelefon></ClientTelefon>\n`;
      xml += `      <ClientEmail></ClientEmail>\n`;
      xml += `      <ClientBanca></ClientBanca>\n`;
      xml += `      <ClientIBAN></ClientIBAN>\n`;
      xml += `      <FacturaNumar>${invoiceNumber}</FacturaNumar>\n`;

      const [year, month, day] = selectedDate.split("-");
      xml += `      <FacturaData>${day}.${month}.${year}</FacturaData>\n`;
      xml += `      <FacturaScadenta>${day}.${month}.${year}</FacturaScadenta>\n`;
      xml += `      <FacturaTaxareInversa>Nu</FacturaTaxareInversa>\n`;
      xml += `      <FacturaTVAIncasare>Nu</FacturaTVAIncasare>\n`;
      xml += `      <FacturaInformatiiSuplimentare> </FacturaInformatiiSuplimentare>\n`;
      xml += `      <FacturaMoneda>RON</FacturaMoneda>\n`;
      xml += `      <FacturaCotaTVA>TVA (${order.items[0]?.productId ? products.find((p) => p.id === order.items[0].productId)?.cotaTVA : 21}%)</FacturaCotaTVA>\n`;
      xml += `      <FacturaGreutate>0.000</FacturaGreutate>\n`;
      xml += `      <FacturaAccize>0.00</FacturaAccize>\n`;
      xml += `      <FacturaIndexSPV></FacturaIndexSPV>\n`;
      xml += "    </Antet>\n";
      xml += "    <Detalii>\n";
      xml += "      <Continut>\n";

      let lineNumber = 1;
      order.items.forEach((item) => {
        const product = products.find((p) => p.id === item.productId);
        const valoare = (item.quantity * item.price).toFixed(2);
        const tva = (valoare * (product.cotaTVA / 100)).toFixed(2);

        xml += "        <Linie>\n";
        xml += `          <LinieNrCrt>${lineNumber}</LinieNrCrt>\n`;
        xml += `          <Descriere>${product.descriere}</Descriere>\n`;
        xml += `          <CodArticolFurnizor>${product.codArticolFurnizor} </CodArticolFurnizor>\n`;
        xml += `          <CodArticolClient></CodArticolClient>\n`;
        xml += `          <CodBare/>\n`;
        xml += `          <InformatiiSuplimentare>Lot:${company.lotNumberCurrent}</InformatiiSuplimentare>\n`;
        xml += `          <UM>${product.um}</UM>\n`;
        xml += `          <Cantitate>${item.quantity.toFixed(3)}</Cantitate>\n`;
        xml += `          <Pret>${item.price.toFixed(4)}</Pret>\n`;
        xml += `          <Valoare>${valoare}</Valoare>\n`;
        xml += `          <ProcTVA>${product.cotaTVA}</ProcTVA>\n`;
        xml += `          <TVA>${tva}</TVA>\n`;
        xml += "        </Linie>\n";
        lineNumber++;
        if (client.afiseazaKG && product.gramajKg > 0) {
          const cantitateKg = item.quantity * product.gramajKg;

          xml += "        <Linie>\n";
          xml += `          <LinieNrCrt>${lineNumber}</LinieNrCrt>\n`;
          xml += `          <Descriere>${product.descriere}</Descriere>\n`;
          xml += `          <CodArticolFurnizor>${product.codArticolFurnizor}</CodArticolFurnizor>\n`;
          xml += `          <InformatiiSuplimentare>Lot: ${company.lotNumberCurrent}</InformatiiSuplimentare>\n`;
          xml += `          <UM>KG</UM>\n`;
          xml += `          <Cantitate>${cantitateKg.toFixed(3)}</Cantitate>\n`;
          xml += `          <Pret>0.0000</Pret>\n`;
          xml += `          <Valoare>0.00</Valoare>\n`;
          xml += `          <ProcTVA>0</ProcTVA>\n`;
          xml += `          <TVA>0.00</TVA>\n`;
          xml += "        </Linie>\n";
          lineNumber++;
        }
      });

      xml += "      </Continut>\n";
      xml += "      <txtObservatii1></txtObservatii1>\n";
      xml += "    </Detalii>\n";
      xml += "    <Sumar>\n";
      xml += `      <TotalValoare>${order.total.toFixed(2)}</TotalValoare>\n`;
      xml += `      <TotalTVA>${order.totalTVA.toFixed(2)}</TotalTVA>\n`;
      xml += `      <Total>${order.totalWithVAT.toFixed(2)}</Total>\n`;
      xml += `      <LinkPlata></LinkPlata>\n`;
      xml += "    </Sumar>\n";
      xml += "    <Observatii>\n";
      xml += "      <txtObservatii></txtObservatii>\n";
      xml += "      <SoldClient></SoldClient>\n";
      xml += "      <ModalitatePlata></ModalitatePlata>\n";
      xml += "    </Observatii>\n";
      xml += "  </Factura>\n";

      invoiceNumber++;
    });

    xml += "</Facturi>";
    return xml;
  };

  // ✅ Generare XML Chitanțe
  const generateReceiptsXML = () => {
    if (receiptOrders.length === 0) {
      showMessage("Nu sunt chitanțe neexportate pentru această dată!", "error");
      return;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Incasari>\n';

    let receiptNumber = 1;
    let invoiceNumber = 28;

    receiptOrders.forEach((order) => {
      const receiptCode = `CN${receiptNumber.toString().padStart(3, "0")}`;
      xml += "  <Linie>\n";

      const [year, month, day] = selectedDate.split("-");
      xml += `    <Data>${day}.${month}.${year}</Data>\n`;
      xml += `    <Numar>${receiptCode}</Numar>\n`;
      xml += `    <Suma>${order.totalWithVAT.toFixed(2)}</Suma>\n`;
      xml += `    <Cont>5311</Cont>\n`;

      const client = clients.find((c) => c.id === order.clientId);
      xml += `    <ContClient>${client.codContabil}</ContClient>\n`;
      xml += `    <FacturaNumar>${invoiceNumber}</FacturaNumar>\n`;
      xml += "  </Linie>\n";

      receiptNumber++;
      invoiceNumber++;
    });

    xml += "</Incasari>";
    return xml;
  };

  // ✅ Generare CSV Producție
  const generateProductionCSV = () => {
    let csv =
      "nr,data,den_gest,cod,denumire,lot,um,cantitate,pret,valoare,consumuri,comanda,explicatie\n";

    let lineNumber = 1;
    ordersForDate.forEach((order) => {
      order.items.forEach((item) => {
        const product = products.find((p) => p.id === item.productId);
        const gest = gestiuni.find((g) => g.id === product.gestiune);
        const valoare = (item.quantity * item.price).toFixed(2);

        csv += `${lineNumber},${selectedDate},${gest.name},${product.codArticolFurnizor},${product.descriere},${company.lotNumberCurrent},${product.um},${item.quantity},${item.price},${valoare},0,${order.id},\n`;
        lineNumber++;
      });
    });

    return csv;
  };

  // ✅ Download fișier
  const downloadFile = (content, filename, mimeType = "text/plain") => {
    const element = document.createElement("a");
    const file = new Blob([content], { type: mimeType });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    element.setAttribute("download", filename); // ← ADAUGĂ
    element.style.display = "none"; // ← ADAUGĂ
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(element.href); // ← ADAUGĂ (free memory)
  };

  // ✅ Export Facturi
  const handleExportInvoices = async () => {
    const xml = generateInvoicesXML();
    if (!xml) return;

    const [year, month, day] = selectedDate.split("-");
    const dateCounters = exportCount[selectedDate] || DEFAULT_COUNTERS;
    const currentExport = dateCounters.invoice + 1;
    const filename = `f_${company.furnizorCIF.replace("RO", "")}_${currentExport}_${day}-${month}-${year}.XML`;

    downloadFile(xml, filename, "application/xml");

    // ✅ Mark invoices as exported
    const updatedOrders = orders.map((o) =>
      o.date === selectedDate && invoiceOrders.find((io) => io.id === o.id)
        ? { ...o, invoiceExported: true }
        : o,
    );

    const success = await saveData("orders", updatedOrders);
    if (success) {
      setOrders(updatedOrders);
      const newCount = { 
        ...exportCount, 
        [selectedDate]: {
          ...dateCounters,
          invoice: currentExport
        }
      };
      setExportCount(newCount);
      // Update only invoice count in API
      await fetch(`${API_URL}/api/export-counters/${selectedDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_count: currentExport,
          receipt_count: dateCounters.receipt,
          production_count: dateCounters.production
        })
      });
      showMessage(`✅ Facturi exportate:  ${filename}`);
    }
  };

  // ✅ Export Chitanțe
  const handleExportReceipts = async () => {
    const xml = generateReceiptsXML();
    if (!xml) return;

    const [year, month, day] = selectedDate.split("-");
    const dateCounters = exportCount[selectedDate] || DEFAULT_COUNTERS;
    const currentExport = dateCounters.receipt + 1;
    const filename = `I_${company.furnizorCIF.replace("RO", "")}_${currentExport}_${day}-${month}-${year}.XML`;

    downloadFile(xml, filename, "application/xml");

    // ✅ Mark receipts as exported
    const updatedOrders = orders.map((o) =>
      o.date === selectedDate && receiptOrders.find((ro) => ro.id === o.id)
        ? { ...o, receiptExported: true }
        : o,
    );

    const success = await saveData("orders", updatedOrders);
    if (success) {
      setOrders(updatedOrders);
      const newCount = { 
        ...exportCount, 
        [selectedDate]: {
          ...dateCounters,
          receipt: currentExport
        }
      };
      setExportCount(newCount);
      // Update only receipt count in API
      await fetch(`${API_URL}/api/export-counters/${selectedDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_count: dateCounters.invoice,
          receipt_count: currentExport,
          production_count: dateCounters.production
        })
      });
      showMessage(`✅ Chitanțe exportate: ${filename}`);
    }
  };

  // ✅ Export Producție & Close Day
  const handleExportProduction = async () => {
    if (ordersForDate.length === 0) {
      showMessage("Nu sunt comenzi pentru a exporta producția!", "error");
      return;
    }

    const csv = generateProductionCSV();
    const [year, month, day] = selectedDate.split("-");
    const filename = `p_${company.furnizorCIF.replace("RO", "")}_${day}-${month}-${year}.CSV`;

    downloadFile(csv, filename, "text/csv"); // ← SCHIMBĂ

    // ✅ Auto-close day
    const updatedDayStatus = {
      ...dayStatus,
      [selectedDate]: {
        productionExported: true,
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser.name,
        lotNumber: company.lotNumberCurrent,
      },
    };

    const success = await saveData("dayStatus", updatedDayStatus);
    if (success) {
      setDayStatus(updatedDayStatus);
      showMessage(`✅ Producție exportată: ${filename} - ZI ÎNCHISĂ!  🔒`);
    }
  };

  // ✅ Redeschide ziua (admin only)
  const handleReopenDay = async () => {
    if (currentUser.role !== "admin") {
      showMessage("Doar admin poate redeschide ziua!", "error");
      return;
    }

    if (!confirm(`Sigur doriți să redeschideți ziua ${selectedDate}?`)) {
      return;
    }

    const updatedDayStatus = { ...dayStatus };
    delete updatedDayStatus[selectedDate];

    const success = await saveData("dayStatus", updatedDayStatus);
    if (success) {
      setDayStatus(updatedDayStatus);
      showMessage("✅ Ziua redeschisă pentru modificări!");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Export Documente</h2>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* MOD EXPORT */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-3">Mod Export</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={exportMode === "toExport"}
              onChange={() => setExportMode("toExport")}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">Doar Neexportate</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={exportMode === "all"}
              onChange={() => setExportMode("all")}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">Toate</span>
          </label>
        </div>
        <p className="text-xs text-blue-700 mt-2">
          Selectați ce comenzi să fie exportate
        </p>
      </div>

      {/* STATISTICI */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
          <p className="text-sm text-gray-600">Total Comenzi</p>
          <p className="text-3xl font-bold text-blue-600">{totalOrders}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
          <p className="text-sm text-gray-600">Facturi Neexportate</p>
          <p className="text-3xl font-bold text-blue-600">{totalInvoices}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
          <p className="text-sm text-gray-600">Chitanțe Neexportate</p>
          <p className="text-3xl font-bold text-green-600">{totalReceipts}</p>
        </div>
        <div
          className={`bg-white p-4 rounded-lg shadow border-l-4 ${
            isDayClosed ? "border-red-500" : "border-gray-300"
          }`}
        >
          <p className="text-sm text-gray-600">Status Zi</p>
          <p
            className={`text-3xl font-bold ${
              isDayClosed ? "text-red-600" : "text-gray-600"
            }`}
          >
            {isDayClosed ? "🔒 Închisă" : "🟢 Deschisă"}
          </p>
        </div>
      </div>

      {/* EXPORT FACTURI */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">📄</span>
          <div>
            <h3 className="text-lg font-semibold">Export Facturi (XML)</h3>
            <p className="text-sm text-gray-600">
              {totalInvoices} facturi neexportate
            </p>
          </div>
        </div>
        <button
          onClick={handleExportInvoices}
          disabled={totalInvoices === 0}
          className="w-full bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2 font-medium"
        >
          <Download className="w-5 h-5" />
          Export Facturi
        </button>
      </div>

      {/* EXPORT CHITANȚE */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">🧾</span>
          <div>
            <h3 className="text-lg font-semibold">Export Chitanțe (XML)</h3>
            <p className="text-sm text-gray-600">
              {totalReceipts} chitanțe neexportate
            </p>
          </div>
        </div>
        <button
          onClick={handleExportReceipts}
          disabled={totalReceipts === 0}
          className="w-full bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2 font-medium"
        >
          <Download className="w-5 h-5" />
          Export Chitanțe
        </button>
      </div>

      {/* EXPORT PRODUCȚIE */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div>
            <h3 className="text-lg font-semibold">
              Export Fișă Producție (CSV)
            </h3>
            <p className="text-sm text-gray-600">
              Total {totalOrders} articole pentru producție
            </p>
          </div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3">
          <p className="text-sm text-orange-800">
            ⚠️ ATENȚIE: După export, ziua se va ÎNCHIDE și nu se va mai putea
            edita!
          </p>
        </div>
        <button
          onClick={handleExportProduction}
          disabled={ordersForDate.length === 0 || isDayClosed}
          className="w-full bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2 font-medium"
        >
          <Download className="w-5 h-5" />
          Export Producție
        </button>
      </div>

      {/* REDESCHIDE ZI (admin) */}
      {isDayClosed && currentUser.role === "admin" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-800 mb-3">
            🔓 Redeschide Ziua
          </h3>
          <p className="text-sm text-red-700 mb-4">
            Ziua {selectedDate} este închisă. Doar admin poate redeschide pentru
            modificări.
          </p>
          <button
            onClick={handleReopenDay}
            className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition font-medium"
          >
            Redeschide Ziua
          </button>
        </div>
      )}
    </div>
  );
};

export default ExportScreen;
