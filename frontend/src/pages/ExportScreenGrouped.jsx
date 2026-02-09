import React, { useState, useEffect } from "react";
import { Download, Settings, X, Trash2, Edit2 } from "lucide-react";

const ExportScreenGrouped = ({
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
  const [exportMode, setExportMode] = useState("toExport");
  const [exportCount, setExportCount] = useState({});
  const [productGroups, setProductGroups] = useState([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState(null);
  const [masterProductId, setMasterProductId] = useState("");

  // Memoize master product for efficient lookups
  const masterProduct = masterProductId 
    ? products.find((p) => p.id === masterProductId)
    : null;

  // Load product groups from API
  useEffect(() => {
    loadProductGroups();
  }, []);

  // Load export count from API
  useEffect(() => {
    const loadExportCount = async () => {
      try {
        const currentDate = new Date().toISOString().split("T")[0];
        const response = await fetch(`${API_URL}/api/export-counters/${currentDate}`);
        if (response.ok) {
          const data = await response.json();
          setExportCount({
            [data.export_date]: Math.max(
              data.invoice_count || 0,
              data.receipt_count || 0,
              data.production_count || 0
            )
          });
        }
      } catch (error) {
        console.error("Error loading export count:", error);
      }
    };
    loadExportCount();
  }, [API_URL]);

  const loadProductGroups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/product-groups`);
      if (response.ok) {
        const data = await response.json();
        setProductGroups(data);
      } else {
        console.warn("Failed to load product groups from API");
      }
    } catch (error) {
      console.error("Error loading product groups:", error);
    }
  };

  const ordersForDate = orders.filter((o) => o.date === selectedDate);
  const invoiceOrders = ordersForDate.filter((o) => !o.invoiceExported);
  const receiptOrders = ordersForDate.filter((o) => !o.receiptExported);

  const totalOrders = ordersForDate.length;
  const totalInvoices = invoiceOrders.length;
  const totalReceipts = receiptOrders.length;

  const isDayClosed = dayStatus[selectedDate]?.productionExported || false;

  // Validate product group - all products must have same price and VAT
  const validateProductGroup = (productIds) => {
    if (productIds.length < 2) {
      return { valid: false, message: "Selectați cel puțin 2 produse" };
    }

    const selectedProds = products.filter((p) => productIds.includes(p.id));
    
    // Get price zone for reference (use first product's price zone or default)
    const firstProduct = selectedProds[0];
    const priceZones = Object.keys(firstProduct.prices || {});
    const referenceZone = priceZones[0] || "default";
    
    const firstPrice = firstProduct.prices?.[referenceZone] || 0;
    const firstVAT = firstProduct.cotaTVA;

    for (const prod of selectedProds) {
      const prodPrice = prod.prices?.[referenceZone] || 0;
      if (Math.abs(prodPrice - firstPrice) > 0.001) {
        return {
          valid: false,
          message: "❌ Toate produsele trebuie să aibă același preț!",
        };
      }
      if (prod.cotaTVA !== firstVAT) {
        return {
          valid: false,
          message: "❌ Toate produsele trebuie să aibă același TVA!",
        };
      }
    }

    return {
      valid: true,
      price: firstPrice,
      cotaTVA: firstVAT,
    };
  };

  // Save product group
  const handleSaveGroup = async () => {
    if (!masterProductId || !masterProduct) {
      showMessage("Selectați un produs master pentru grupare!", "error");
      return;
    }

    const validation = validateProductGroup(selectedProducts);
    if (!validation.valid) {
      showMessage(validation.message, "error");
      return;
    }

    // Use master product's descriere as group name and codArticolFurnizor as group code
    const finalGroupName = masterProduct.descriere;
    const finalGroupCode = masterProduct.codArticolFurnizor;

    // Validate that master product has required fields
    if (!finalGroupName || !finalGroupCode) {
      showMessage("Produsul master selectat nu are denumire sau cod valid!", "error");
      return;
    }

    const groupData = {
      id: editingGroup?.id || `pg_${Date.now()}`,
      name: finalGroupName,
      productIds: selectedProducts,
      price: validation.price,
      cotaTVA: validation.cotaTVA,
      masterProductId: masterProductId,
      masterProductCode: finalGroupCode,
    };

    try {
      const url = editingGroup
        ? `${API_URL}/api/product-groups/${editingGroup.id}`
        : `${API_URL}/api/product-groups`;
      const method = editingGroup ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(groupData),
      });

      if (response.ok) {
        await loadProductGroups();
        showMessage(
          `✅ Grupare ${editingGroup ? "actualizată" : "creată"} cu succes!`,
        );
        handleCloseModal();
      } else {
        const error = await response.json();
        showMessage(error.message || "Eroare la salvarea grupării", "error");
      }
    } catch (error) {
      console.error("Error saving product group:", error);
      showMessage("Eroare la salvarea grupării", "error");
    }
  };

  // Delete product group
  const handleDeleteGroup = async (groupId) => {
    if (!confirm("Sigur doriți să ștergeți această grupare?")) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/product-groups/${groupId}`, {
        method: "DELETE",
      });

      if (response.ok || response.status === 204) {
        await loadProductGroups();
        showMessage("✅ Grupare ștearsă cu succes!");
      } else {
        showMessage("Eroare la ștergerea grupării", "error");
      }
    } catch (error) {
      console.error("Error deleting product group:", error);
      showMessage("Eroare la ștergerea grupării", "error");
    }
  };

  // Edit product group
  const handleEditGroup = (group) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setSelectedProducts(group.productIds);
    setMasterProductId(group.masterProductId || "");
    setShowGroupModal(true);
  };

  const handleCloseModal = () => {
    setShowGroupModal(false);
    setEditingGroup(null);
    setGroupName("");
    setSelectedProducts([]);
    setMasterProductId("");
  };

  // Toggle product selection
  const toggleProductSelection = (productId) => {
    setSelectedProducts((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  };

  // Generate XML with grouping logic
  const generateInvoicesXML = () => {
    if (invoiceOrders.length === 0) {
      showMessage("Nu sunt facturi neexportate pentru această dată!", "error");
      return;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Facturi>\n';

    let invoiceNumber = 28;
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

      // Group items by product groups
      const groupedItems = {};
      const ungroupedItems = [];

      order.items.forEach((item) => {
        const group = productGroups.find((g) =>
          g.productIds.includes(item.productId),
        );
        if (group) {
          if (!groupedItems[group.id]) {
            groupedItems[group.id] = {
              name: group.name,
              quantity: 0,
              weight: 0,
              price: group.price,
              cotaTVA: group.cotaTVA,
              productIds: [],
            };
          }
          groupedItems[group.id].quantity += item.quantity;
          const product = products.find((p) => p.id === item.productId);
          groupedItems[group.id].weight += item.quantity * (product.gramajKg || 0);
          groupedItems[group.id].productIds.push(item.productId);
        } else {
          ungroupedItems.push(item);
        }
      });

      let lineNumber = 1;

      // Add grouped items
      Object.values(groupedItems).forEach((group) => {
        const valoare = (group.quantity * group.price).toFixed(2);
        const tva = (valoare * (group.cotaTVA / 100)).toFixed(2);

        xml += "        <Linie>\n";
        xml += `          <LinieNrCrt>${lineNumber}</LinieNrCrt>\n`;
        xml += `          <Descriere>${group.name}</Descriere>\n`;
        xml += `          <CodArticolFurnizor>GRUP</CodArticolFurnizor>\n`;
        xml += `          <CodArticolClient></CodArticolClient>\n`;
        xml += `          <CodBare/>\n`;
        xml += `          <InformatiiSuplimentare>Lot:${company.lotNumberCurrent}</InformatiiSuplimentare>\n`;
        xml += `          <UM>BUC</UM>\n`;
        xml += `          <Cantitate>${group.quantity.toFixed(3)}</Cantitate>\n`;
        xml += `          <Pret>${group.price.toFixed(4)}</Pret>\n`;
        xml += `          <Valoare>${valoare}</Valoare>\n`;
        xml += `          <ProcTVA>${group.cotaTVA}</ProcTVA>\n`;
        xml += `          <TVA>${tva}</TVA>\n`;
        xml += "        </Linie>\n";
        lineNumber++;

        // Add weight line if client has afiseazaKG
        if (client.afiseazaKG && group.weight > 0) {
          xml += "        <Linie>\n";
          xml += `          <LinieNrCrt>${lineNumber}</LinieNrCrt>\n`;
          xml += `          <Descriere>${group.name}</Descriere>\n`;
          xml += `          <CodArticolFurnizor>GRUP</CodArticolFurnizor>\n`;
          xml += `          <InformatiiSuplimentare>Lot: ${company.lotNumberCurrent}</InformatiiSuplimentare>\n`;
          xml += `          <UM>KG</UM>\n`;
          xml += `          <Cantitate>${group.weight.toFixed(3)}</Cantitate>\n`;
          xml += `          <Pret>0.0000</Pret>\n`;
          xml += `          <Valoare>0.00</Valoare>\n`;
          xml += `          <ProcTVA>0</ProcTVA>\n`;
          xml += `          <TVA>0.00</TVA>\n`;
          xml += "        </Linie>\n";
          lineNumber++;
        }
      });

      // Add ungrouped items
      ungroupedItems.forEach((item) => {
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

  // Generate XML Receipts (same as ExportScreen)
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

  // Generate CSV Production (same as ExportScreen)
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

  // Download file
  const downloadFile = (content, filename, mimeType = "text/plain") => {
    const element = document.createElement("a");
    const file = new Blob([content], { type: mimeType });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(element.href);
  };

  // Export Invoices
  const handleExportInvoices = async () => {
    const xml = generateInvoicesXML();
    if (!xml) return;

    const [year, month, day] = selectedDate.split("-");
    const currentExport = (exportCount[selectedDate] || 0) + 1;
    const filename = `f_${company.furnizorCIF.replace("RO", "")}_${currentExport}_${day}-${month}-${year}.XML`;

    downloadFile(xml, filename, "application/xml");

    const updatedOrders = orders.map((o) =>
      o.date === selectedDate && invoiceOrders.find((io) => io.id === o.id)
        ? { ...o, invoiceExported: true }
        : o,
    );

    const success = await saveData("orders", updatedOrders);
    if (success) {
      setOrders(updatedOrders);
      const newCount = { ...exportCount, [selectedDate]: currentExport };
      setExportCount(newCount);
      await saveData("exportCount", newCount);
      showMessage(`✅ Facturi exportate: ${filename}`);
    }
  };

  // Export Receipts
  const handleExportReceipts = async () => {
    const xml = generateReceiptsXML();
    if (!xml) return;

    const [year, month, day] = selectedDate.split("-");
    const currentExport = (exportCount[selectedDate] || 0) + 1;
    const filename = `I_${company.furnizorCIF.replace("RO", "")}_${currentExport}_${day}-${month}-${year}.XML`;

    downloadFile(xml, filename, "application/xml");

    const updatedOrders = orders.map((o) =>
      o.date === selectedDate && receiptOrders.find((ro) => ro.id === o.id)
        ? { ...o, receiptExported: true }
        : o,
    );

    const success = await saveData("orders", updatedOrders);
    if (success) {
      setOrders(updatedOrders);
      const newCount = { ...exportCount, [selectedDate]: currentExport };
      setExportCount(newCount);
      await saveData("exportCount", newCount);
      showMessage(`✅ Chitanțe exportate: ${filename}`);
    }
  };

  // Export Production
  const handleExportProduction = async () => {
    if (ordersForDate.length === 0) {
      showMessage("Nu sunt comenzi pentru a exporta producția!", "error");
      return;
    }

    const csv = generateProductionCSV();
    const [year, month, day] = selectedDate.split("-");
    const filename = `p_${company.furnizorCIF.replace("RO", "")}_${day}-${month}-${year}.CSV`;

    downloadFile(csv, filename, "text/csv");

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
      showMessage(`✅ Producție exportată: ${filename} - ZI ÎNCHISĂ! 🔒`);
    }
  };

  // Reopen day
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
        <h2 className="text-2xl font-bold text-gray-800">
          Export Facturi cu Grupări Produse
        </h2>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => setShowGroupModal(true)}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
          >
            <Settings className="w-5 h-5" />
            Configurează Grupări
          </button>
        </div>
      </div>

      {/* Product Groups List */}
      {productGroups.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-3">Grupări Existente</h3>
          <div className="space-y-2">
            {productGroups.map((group) => (
              <div
                key={group.id}
                className="flex items-center justify-between p-3 bg-purple-50 rounded-lg"
              >
                <div>
                  <p className="font-medium">{group.name}</p>
                  <p className="text-sm text-gray-600">
                    {group.productIds.length} produse | Preț: {group.price} RON
                    | TVA: {group.cotaTVA}%
                  </p>
                  {group.masterProductCode && (
                    <p className="text-xs text-purple-600 mt-1">
                      🔹 Produs Master: {group.masterProductCode}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditGroup(group)}
                    className="p-2 text-blue-600 hover:bg-blue-100 rounded"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.id)}
                    className="p-2 text-red-600 hover:bg-red-100 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group Configuration Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">
                  {editingGroup ? "Editare Grupare" : "Configurare Grupări Produse"}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="p-2 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 1. Produs Master - FIRST */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Produs Master <span className="text-red-600">*</span>
                </label>
                <select
                  value={masterProductId}
                  onChange={(e) => setMasterProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">-- Selectați un produs master --</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.descriere} (Cod: {product.codArticolFurnizor})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Nume Grupare - READ-ONLY display */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Nume Grupare (auto-filled)
                </label>
                <div className={`w-full px-3 py-2 rounded-lg border ${
                  masterProduct 
                    ? 'bg-green-50 border-green-200 text-gray-900 font-medium' 
                    : 'bg-gray-50 border-gray-200 text-gray-500 italic'
                }`}>
                  {masterProduct ? masterProduct.descriere : 'Selectează produs master mai întâi'}
                </div>
              </div>

              {/* 3. Cod Grupare - READ-ONLY display */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Cod Grupare (auto-filled)
                </label>
                <div className={`w-full px-3 py-2 rounded-lg border ${
                  masterProduct 
                    ? 'bg-green-50 border-green-200 text-gray-900 font-medium' 
                    : 'bg-gray-50 border-gray-200 text-gray-500 italic'
                }`}>
                  {masterProduct ? masterProduct.codArticolFurnizor : 'Selectează produs master mai întâi'}
                </div>
              </div>

              {/* 4. Selectează Produse - with warning */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Selectează Produse <span className="text-red-600">*</span>
                </label>
                <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-sm text-yellow-800">
                  ⚠️ Toate produsele trebuie să aibă același preț și TVA!
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                  {products
                    .filter((product) => product.id !== masterProductId)
                    .map((product) => (
                      <label
                        key={product.id}
                        className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProducts.includes(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          className="w-4 h-4"
                        />
                        <div className="flex-1">
                          <p className="font-medium">{product.descriere}</p>
                          <p className="text-xs text-gray-600">
                            TVA: {product.cotaTVA}% | Cod:{" "}
                            {product.codArticolFurnizor}
                          </p>
                        </div>
                      </label>
                    ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSaveGroup}
                  className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition"
                >
                  Salvează Grupare
                </button>
                <button
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Anulează
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

export default ExportScreenGrouped;
