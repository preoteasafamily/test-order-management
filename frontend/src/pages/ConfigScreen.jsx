import React, { useState, useEffect } from "react";
import { Save, Download, Plus, Edit2, Trash2 } from "lucide-react";

const ConfigScreen = ({
  company,
  setCompany,
  gestiuni,
  agents,
  zones,
  setZones,
  priceZones,
  setPriceZones,
  products,
  clients,
  contracts,
  orders,
  dayStatus,
  currentUser,
  showMessage,
  saveData,
  loadAllData,
  syncClientsToAPI,
  syncProductsToAPI,
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
      code: '',
      name: '',
      description: '',
    });
  };

  const handleSaveZone = async () => {
    if (!editingZone.code || !editingZone.name) {
      showMessage("Completați codul și numele zonei!", "error");
      return;
    }

    try {
      const existingIndex = zones.findIndex((z) => z.id === editingZone.id);

      if (existingIndex >= 0) {
        // Update existing zone
        const response = await fetch(`${API_URL}/api/zones/${editingZone.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingZone)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update zone');
        }

        const updatedZones = [...zones];
        updatedZones[existingIndex] = editingZone;
        setZones(updatedZones);
        
        // Also update priceZones to maintain compatibility
        const updatedPriceZones = [...priceZones];
        const priceZoneIndex = priceZones.findIndex((z) => z.id === editingZone.id);
        if (priceZoneIndex >= 0) {
          updatedPriceZones[priceZoneIndex] = editingZone;
          setPriceZones(updatedPriceZones);
          await saveData("priceZones", updatedPriceZones);
        }
        
        showMessage("Zonă actualizată cu succes!");
      } else {
        // Create new zone
        const response = await fetch(`${API_URL}/api/zones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingZone)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create zone');
        }

        setZones([...zones, editingZone]);
        
        // Also update priceZones to maintain compatibility
        const updatedPriceZones = [...priceZones, editingZone];
        setPriceZones(updatedPriceZones);
        await saveData("priceZones", updatedPriceZones);
        
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
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete zone');
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
                ✅ Ultimul LOT: <strong>{company.lotNumberCurrent}</strong>{" "}
                din <strong>{company.lotDate}</strong>
              </p>
            </div>
          )}
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
              onClick={() => {
                const allData = {
                  company,
                  gestiuni,
                  agents,
                  priceZones,
                  products,
                  clients,
                  contracts,
                  orders,
                  dayStatus,
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
                        saveData("priceZones", data.priceZones || []),
                        saveData("products", data.products),
                        saveData("clients", data.clients),
                        saveData("contracts", data.contracts || []),
                        saveData("orders", data.orders || []),
                        saveData("dayStatus", data.dayStatus || {}),
                      ]);

                      // Sync clients and products to API
                      await syncClientsToAPI(data.clients);
                      await syncProductsToAPI(data.products);

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
            <Save className="w-4 h-4" />
            Zonă Nouă
          </button>
        </div>

        {editingZone && (
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-200">
            <h4 className="font-semibold text-gray-700 mb-3">
              {zones.some((z) => z.id === editingZone.id) ? "Editare Zonă" : "Zonă Nouă"}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cod *
                </label>
                <input
                  type="text"
                  value={editingZone.code}
                  onChange={(e) =>
                    setEditingZone({ ...editingZone, code: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  placeholder="zona-a"
                />
              </div>
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
                  Descriere
                </label>
                <input
                  type="text"
                  value={editingZone.description}
                  onChange={(e) =>
                    setEditingZone({ ...editingZone, description: e.target.value })
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
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Cod
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
                <tr key={zone.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-amber-600">
                    {zone.code}
                  </td>
                  <td className="py-3 px-4">{zone.name}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {zone.description || '-'}
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

      {/* INFO PANEL */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="font-semibold text-gray-800 mb-3">
          ℹ️ Informații LOT
        </h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li>
            ✅ LOT-ul se incrementează **automat** la prima comandă a zilei
            noi
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
