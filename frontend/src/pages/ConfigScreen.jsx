import React, { useState, useEffect } from "react";
import { Save, Download, Plus, Edit2, Trash2 } from "lucide-react";

const ConfigScreen = ({
  company,
  setCompany,
  gestiuni,
  agents,
  setAgents,
  zones,
  setZones,
  priceZones,
  setPriceZones,
  products,
  clients,
  setClients,
  contracts,
  orders,
  dayStatus,
  currentUser,
  users,
  showMessage,
  saveData,
  loadAllData,
  syncClientsToAPI,
  syncProductsToAPI,
  syncUsersToAPI,
  syncAgentsToAPI,
  syncOrdersToAPI,
  syncZonesToAPI,
  API_URL,
}) => {
  const [localCompany, setLocalCompany] = useState(company);
  const [editingZone, setEditingZone] = useState(null);

  useEffect(() => {
    setLocalCompany(company);
  }, [company]);

  const handleSaveConfig = async () => {
    if (!localCompany.furnizorNume || !localCompany.furnizorCIF) {
      showMessage("Completați datele obligatorii!  ", "error");
      return;
    }

    const success = await saveData("company", localCompany);
    if (success) {
      setCompany(localCompany);
      showMessage("Configurare salvată cu succes!");
    }
  };

  // Zone management functions
  const handleAddZone = () => {
    setEditingZone({
      id: `zone-${Date.now()}`,
      name: "",
      description: "",
    });
  };

  const handleSaveZone = async () => {
    // ✅ FIXED: Only validate name and description
    if (!editingZone.name || !editingZone.description) {
      showMessage("Completați numele și descrierea zonei!", "error");
      return;
    }

    try {
      const existingIndex = zones.findIndex((z) => z.id === editingZone.id);

      let zoneToSave = { ...editingZone };

      // ✅ GENERATE CODE AUTOMATICALLY if missing
      if (!zoneToSave.code) {
        // Generate code from name: "Zona A" -> "zona-a"
        zoneToSave.code = editingZone.name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]/g, "");
      }

      if (existingIndex >= 0) {
        // Update existing zone
        const response = await fetch(`${API_URL}/api/zones/${zoneToSave.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(zoneToSave),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to update zone");
        }

        const updatedZones = [...zones];
        updatedZones[existingIndex] = zoneToSave;
        setZones(updatedZones);

        showMessage("Zonă actualizată cu succes!");
      } else {
        // Create new zone
        const response = await fetch(`${API_URL}/api/zones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(zoneToSave),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create zone");
        }

        setZones([...zones, zoneToSave]);
        showMessage("Zonă creată cu succes!");
      }

      setEditingZone(null);
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };

  const handleDeleteZone = async (zoneId) => {
    if (!confirm("Sigur doriți să ștergeți această zonă?")) return;

    try {
      const response = await fetch(`${API_URL}/api/zones/${zoneId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete zone");
      }

      const updatedZones = zones.filter((z) => z.id !== zoneId);
      setZones(updatedZones);

      // Also update priceZones to maintain compatibility
      const updatedPriceZones = priceZones.filter((z) => z.id !== zoneId);
      setPriceZones(updatedPriceZones);
      await saveData("priceZones", updatedPriceZones);

      showMessage("Zonă ștearsă cu succes!");
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };
  const handleAllocateAgentToZone = async (zoneId, agentId) => {
    if (!agentId) {
      showMessage("Selectați un agent!", "error");
      return;
    }

    try {
      const clientsInZone = clients.filter((c) => c.priceZone === zoneId);

      if (clientsInZone.length === 0) {
        showMessage("Nu sunt clienți în această zonă!", "error");
        return;
      }

      // ✅ Update all clients in this zone with the new agent
      const updatedClients = clients.map((c) => {
        if (c.priceZone === zoneId) {
          return { ...c, agentId: agentId };
        }
        return c;
      });

      // ✅ Update agents to include zone reference
      const updatedAgents = agents.map((a) => {
        if (a.id === agentId) {
          const zones = a.zones || [];
          if (!zones.includes(zoneId)) {
            return { ...a, zones: [...zones, zoneId] };
          }
          return a;
        } else {
          const zones = (a.zones || []).filter((z) => z !== zoneId);
          return { ...a, zones };
        }
      });

      // ✅ SIMPLIFIED: Save ONLY to localStorage, skip API sync
      const successClients = await saveData("clients", updatedClients);
      const successAgents = await saveData("agents", updatedAgents);

      if (successClients && successAgents) {
        setClients(updatedClients);
        setAgents(updatedAgents);

        const agentName = agents.find((a) => a.id === agentId)?.name;
        showMessage(
          `✅ Agent "${agentName}" alocat la zona! ${clientsInZone.length} clienți au fost alocați.`,
        );
      } else {
        showMessage("Eroare la salvarea datelor!", "error");
      }
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">
        Configurare Societate
      </h2>

      <div className="bg-white p-6 rounded-lg shadow space-y-6">
        {/* DATE IDENTIFICARE */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Date Identificare</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CUI/CIF
              </label>
              <input
                type="text"
                value={localCompany.furnizorCIF}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    furnizorCIF: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus: ring-blue-500 focus: border-transparent"
                placeholder="RO12345678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nr. Reg. Com.
              </label>
              <input
                type="text"
                value={localCompany.furnizorNrRegCom}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    furnizorNrRegCom: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="J14/603/1993"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Denumire firmă
            </label>
            <input
              type="text"
              value={localCompany.furnizorNume}
              onChange={(e) =>
                setLocalCompany({
                  ...localCompany,
                  furnizorNume: e.target.value,
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="SC PANIFICATIE SRL"
            />
          </div>

          <div className="grid grid-cols-1 sm: grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Județ
              </label>
              <input
                type="text"
                value={localCompany.furnizorJudet}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    furnizorJudet: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Covasna"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Localitate
              </label>
              <input
                type="text"
                value={localCompany.furnizorLocalitate}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    furnizorLocalitate: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Sfântu Gheorghe"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adresă
            </label>
            <input
              type="text"
              value={localCompany.furnizorStrada}
              onChange={(e) =>
                setLocalCompany({
                  ...localCompany,
                  furnizorStrada: e.target.value,
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Str. Fabricii nr. 10"
            />
          </div>
        </div>

        {/* SERIE DOCUMENTE */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-4">Serie Documente</h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Serie Facturi
              </label>
              <input
                type="text"
                value={localCompany.invoiceSeries}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    invoiceSeries: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="FAC"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Număr următor factură
              </label>
              <input
                type="number"
                min="1"
                value={localCompany.invoiceNextNumber ?? 1}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    invoiceNextNumber: parseInt(e.target.value) || 1,
                  })
                }
                disabled={currentUser.role !== "admin"}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                  currentUser.role === "admin"
                    ? "focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-text"
                    : "bg-gray-100 text-gray-600 cursor-not-allowed"
                }`}
              />
              <p className="text-xs text-gray-500 mt-1">
                ✏️ Numărul cu care va fi emisă următoarea factură
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Serie Chitanțe
              </label>
              <input
                type="text"
                value={localCompany.receiptSeries}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    receiptSeries: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="CN"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Număr LOT curent
              </label>
              <input
                type="number"
                value={localCompany.lotNumberCurrent}
                onChange={(e) =>
                  setLocalCompany({
                    ...localCompany,
                    lotNumberCurrent: parseInt(e.target.value) || 0,
                  })
                }
                disabled={currentUser.role !== "admin"}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                  currentUser.role === "admin"
                    ? "focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-text"
                    : "bg-gray-100 text-gray-600 cursor-not-allowed"
                }`}
              />
              <p className="text-xs text-gray-500 mt-1">
                {currentUser.role === "admin"
                  ? "✏️ Doar admin poate edita LOT"
                  : "ℹ️ LOT se incrementează automat la prima comandă a zilei noi"}
              </p>
            </div>
          </div>

          {company.lotDate && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                ✅ Ultimul LOT: <strong>{company.lotNumberCurrent}</strong> din{" "}
                <strong>{company.lotDate}</strong>
              </p>
            </div>
          )}
        </div>

        {/* DATE E-FACTURA VANZATOR */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-1">Date e-Factura Vânzător</h3>
          <p className="text-sm text-gray-500 mb-4">
            Câmpuri BT utilizate la generarea facturilor electronice (e-Factura). Dacă sunt completate, vor fi preluate automat pe fiecare factură.
          </p>

          {/* Identitate vânzător */}
          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Identitate Vânzător
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-27 Denumire vânzător
              </label>
              <input
                type="text"
                value={localCompany.bt_27_seller_name ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_27_seller_name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="SC PANIFICATIE SRL"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-30 Nr. înregistrare comercială
              </label>
              <input
                type="text"
                value={localCompany.bt_30_seller_legal_registration ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_30_seller_legal_registration: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="J14/603/1993"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-31/32 CIF/CUI vânzător (TVA)
              </label>
              <input
                type="text"
                value={localCompany.bt_31_32_seller_vat_identifier ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_31_32_seller_vat_identifier: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="RO12345678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-29 Identificator vânzător{" "}
                <span className="text-gray-400 font-normal">(opțional)</span>
              </label>
              <input
                type="text"
                value={localCompany.bt_29_seller_identifier ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_29_seller_identifier: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Cod intern opțional"
              />
            </div>
          </div>

          {/* Adresă vânzător */}
          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Adresă Vânzător
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-35 Adresă stradă
              </label>
              <input
                type="text"
                value={localCompany.bt_35_seller_address ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_35_seller_address: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Str. Fabricii nr. 10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-37 Localitate
              </label>
              <input
                type="text"
                value={localCompany.bt_37_seller_city ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_37_seller_city: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Sfântu Gheorghe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-39 Județ / Regiune
              </label>
              <input
                type="text"
                value={localCompany.bt_39_seller_region ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_39_seller_region: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Covasna"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-40 Țară{" "}
                <span className="text-gray-400 font-normal">(implicit RO)</span>
              </label>
              <input
                type="text"
                value={localCompany.bt_40_seller_country ?? 'RO'}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_40_seller_country: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="RO"
                maxLength={2}
              />
            </div>
          </div>

          {/* Contact vânzător */}
          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Contact Vânzător
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-41 Persoană contact
              </label>
              <input
                type="text"
                value={localCompany.bt_41_seller_contact ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_41_seller_contact: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Ion Popescu"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-42 Telefon
              </label>
              <input
                type="text"
                value={localCompany.bt_42_seller_phone ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_42_seller_phone: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="+40 267 123 456"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-43 Email
              </label>
              <input
                type="email"
                value={localCompany.bt_43_seller_email ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_43_seller_email: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="contact@firma.ro"
              />
            </div>
          </div>

          {/* Detalii plată */}
          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Detalii Plată
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-84 IBAN beneficiar
              </label>
              <input
                type="text"
                value={localCompany.bt_84_payee_iban ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_84_payee_iban: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="RO49RNCB0000000123456789"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-85 Denumire bancă
              </label>
              <input
                type="text"
                value={localCompany.bt_85_payee_bank_name ?? ''}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_85_payee_bank_name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="BCR"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BT-81 Cod mijloc plată{" "}
                <span className="text-gray-400 font-normal">(implicit 42)</span>
              </label>
              <input
                type="text"
                value={localCompany.bt_81_payment_means_code ?? '42'}
                onChange={(e) =>
                  setLocalCompany({ ...localCompany, bt_81_payment_means_code: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="42"
              />
              <p className="text-xs text-gray-500 mt-1">42 = transfer bancar</p>
            </div>
          </div>
        </div>

        {/* BUTOANE */}
        <div className="border-t pt-6">
          <button
            onClick={handleSaveConfig}
            className="bg-amber-600 text-white px-6 py-2 rounded-lg hover:bg-amber-700 transition flex items-center gap-2 font-medium"
          >
            <Save className="w-5 h-5" />
            Salvează Configurare
          </button>
        </div>
      </div>

      {/* BACKUP & RESTORE */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-4">
          💾 Backup & Restore Date
        </h3>
        <p className="text-sm text-blue-800 mb-4">
          Exportați sau importați toată baza de date pentru transfer pe alt
          calculator.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* EXPORT */}
          <div className="bg-white p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Download className="w-5 h-5 text-blue-600" />
              Export Date
            </h4>
            <p className="text-xs text-gray-600 mb-3">
              Descarcă toată baza de date ca fișier JSON pentru backup sau
              transfer.
            </p>
            <button
              onClick={async () => {
                try {
                  // Fetch client_products data from API
                  let clientProducts = [];
                  try {
                    const response = await fetch(
                      `${API_URL}/api/client-products/all`,
                    );
                    if (response.ok) {
                      clientProducts = await response.json();
                    }
                  } catch (error) {
                    console.warn(
                      "Could not fetch client_products, backup will not include them",
                    );
                  }

                  const allData = {
                    company,
                    gestiuni,
                    agents,
                    users,
                    priceZones,
                    products,
                    clients,
                    contracts,
                    orders,
                    dayStatus,
                    client_products: clientProducts,
                  };

                  const json = JSON.stringify(allData, null, 2);
                  const blob = new Blob([json], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `backup-${new Date().toISOString().split("T")[0]}.json`;
                  
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  showMessage("✅ Date exportate cu succes!");
                } catch (error) {
                  console.error("Error creating backup:", error);
                  showMessage("❌ Eroare la crearea backup-ului!", "error");
                }
              }}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2 font-medium"
            >
              <Download className="w-4 h-4" />
              Descarcă Backup
            </button>
          </div>

          {/* IMPORT */}
          <div className="bg-white p-4 rounded-lg border border-green-200">
            <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Download className="w-5 h-5 text-green-600" />
              Import Date
            </h4>
            <p className="text-xs text-gray-600 mb-3">
              Încarcă un fișier JSON backup pentru a restaura toată baza de
              date.
            </p>
            <label className="w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2 font-medium cursor-pointer">
              <Download className="w-4 h-4" />
              Selectează Fișier
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = async (event) => {
                    try {
                      const text = event.target?.result;
                      const data = JSON.parse(text);

                      // Validare
                      if (!data.company || !data.clients || !data.products) {
                        showMessage(
                          "❌ Fișierul nu are structura corectă!",
                          "error",
                        );
                        return;
                      }

                      // Salvează tot
                      await Promise.all([
                        saveData("company", data.company),
                        saveData("gestiuni", data.gestiuni || []),
                        saveData("agents", data.agents || []),
                        saveData("users", data.users || []),
                        saveData("priceZones", data.priceZones || []),
                        saveData("products", data.products),
                        saveData("clients", data.clients),
                        saveData("contracts", data.contracts || []),
                        saveData("orders", data.orders || []),
                        saveData("dayStatus", data.dayStatus || {}),
                      ]);

                      // Sync all data to API with better error handling
                      const syncResults = await Promise.allSettled([
                        syncUsersToAPI(data.users || []),
                        syncAgentsToAPI(data.agents || []),
                        syncOrdersToAPI(data.orders || []),
                        syncZonesToAPI(data.priceZones || []),
                        syncClientsToAPI(data.clients),
                        syncProductsToAPI(data.products),
                      ]);

                      // Restore client_products if available
                      if (
                        data.client_products &&
                        Array.isArray(data.client_products)
                      ) {
                        try {
                          const response = await fetch(
                            `${API_URL}/api/client-products/restore`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(data.client_products),
                            },
                          );
                          if (!response.ok) {
                            console.warn("Failed to restore client_products");
                          }
                        } catch (error) {
                          console.error(
                            "Error restoring client_products:",
                            error,
                          );
                        }
                      }

                      // Check for sync failures
                      const failedSyncs = syncResults.filter(
                        (r) => r.status === "rejected",
                      );
                      if (failedSyncs.length > 0) {
                        console.warn("Some syncs failed:", failedSyncs);
                        showMessage(
                          `⚠️ Date importate cu ${failedSyncs.length} avertismente. Verificați consola.`,
                          "warning",
                        );
                      }

                      // Reîncarcă
                      await loadAllData();

                      showMessage(
                        "✅ Date importate cu succes! Pagina se va reîncărca...",
                      );
                      setTimeout(() => window.location.reload(), 1500);
                    } catch (error) {
                      showMessage("❌ Eroare la import", "error");
                    }
                  };
                  reader.readAsText(file);
                }}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4">
          <p className="text-xs text-orange-800">
            ⚠️ <strong>ATENȚIE:</strong> Importul va suprascrie TOATE datele
            curente! Asigurați-vă că ați făcut backup înainte.
          </p>
        </div>
      </div>

      {/* GESTIONARE ZONE */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            🗺️ Gestionare Zone de Preț
          </h3>
          <button
            onClick={handleAddZone}
            className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition flex items-center gap-2 font-medium"
          >
            <Plus className="w-4 h-4" />
            Zonă Nouă
          </button>
        </div>

        {editingZone && (
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-200">
            <h4 className="font-semibold text-gray-700 mb-3">
              {zones.some((z) => z.id === editingZone.id)
                ? "Editare Zonă"
                : "Zonă Nouă"}
            </h4>

            {/* ✅ NEW: Display auto-generated priceZoneId */}
            {!zones.some((z) => z.id === editingZone.id) && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ID Zonă
                </label>
                <input
                  type="text"
                  value={editingZone.id}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-700 font-mono text-sm cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  ℹ️ ID-ul se genereaza automat la salvare
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nume *
                </label>
                <input
                  type="text"
                  value={editingZone.name}
                  onChange={(e) =>
                    setEditingZone({ ...editingZone, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  placeholder="Zona A"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descriere *
                </label>
                <input
                  type="text"
                  value={editingZone.description}
                  onChange={(e) =>
                    setEditingZone({
                      ...editingZone,
                      description: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  placeholder="Premium"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveZone}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Salvează
              </button>
              <button
                onClick={() => setEditingZone(null)}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition"
              >
                Anulează
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                {/* ✅ CHANGED: Display priceZoneId */}
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  ID Zonă Preț
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Nume
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Descriere
                </th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr
                  key={zone.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  {/* ✅ CHANGED: Show priceZoneId */}
                  <td className="py-3 px-4 font-bold text-amber-600 text-base font-mono">
                    {zone.id}
                  </td>
                  <td className="py-3 px-4">{zone.name}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {zone.description || "-"}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingZone(zone)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteZone(zone.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {zones.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Nu există zone în sistem. Adaugă prima zonă!
            </div>
          )}
        </div>
      </div>

      {/* ALOCARE AGENTI LA ZONE */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            👤 Alocare Agenți la Zone
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Zonă
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Agent Alocat
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Clienți în Zonă
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  Acțiune
                </th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => {
                const clientsInZone = clients.filter(
                  (c) => c.priceZone === zone.id,
                );
                const zoneAgent = agents.find((a) =>
                  a.zones?.includes(zone.id),
                );

                return (
                  <tr
                    key={zone.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium">{zone.name}</td>
                    <td className="px-4 py-3">
                      {zoneAgent ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {zoneAgent.name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          Nealocat
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {clientsInZone.length} clienți
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={zoneAgent?.id || ""}
                        onChange={(e) =>
                          handleAllocateAgentToZone(zone.id, e.target.value)
                        }
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 text-sm"
                      >
                        <option value="">-- Selectați Agent --</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            💡 Când alocat un agent la o zonă, toti clienții din acea zonă vor
            fi alocați automat acelui agent.
          </p>
        </div>
      </div>

      {/* INFO PANEL */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="font-semibold text-gray-800 mb-3">ℹ️ Informații LOT</h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li>
            ✅ LOT-ul se incrementează **automat** la prima comandă a zilei noi
          </li>
          <li>📦 Ziua anterioară ≠ Ziua curentă = incrementare</li>
          <li>🔒 Câmpul LOT e **read-only** și nu poate fi editat manual</li>
          <li>
            ⚠️ Dacă se fac corecții și se devalideaza ziua, LOT rămâne
            neschimbat
          </li>
        </ul>
      </div>
    </div>
  );
};

export default ConfigScreen;
