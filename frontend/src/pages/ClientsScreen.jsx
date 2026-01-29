import React, { useState, useEffect } from "react";
import { Plus, Search, Edit2, Trash2, Save, X } from "lucide-react";

const ClientsScreen = ({
  clients,
  setClients,
  agents,
  priceZones,
  products,
  editingClient,
  setEditingClient,
  showMessage,
  createClient,
  updateClient,
  deleteClient,
  API_URL,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [localEditingClient, setLocalEditingClient] = useState(null);
  const [clientProducts, setClientProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // ✅ SYNC cu editingClient când se schimbă
  useEffect(() => {
    setLocalEditingClient(editingClient);
    
    // Load products when editing an existing client
    if (editingClient && editingClient.id) {
      loadClientProducts(editingClient.id);
    } else {
      setClientProducts([]);
    }
  }, [editingClient]);

  // Load products with their status for this client
  const loadClientProducts = async (clientId) => {
    setLoadingProducts(true);
    try {
      const response = await fetch(`${API_URL}/api/clients/${clientId}/products/all`);
      if (response.ok) {
        const data = await response.json();
        setClientProducts(data);
      } else {
        console.error('Failed to load client products');
        setClientProducts([]);
      }
    } catch (error) {
      console.error('Error loading client products:', error);
      setClientProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  const filteredClients = clients.filter(
    (c) =>
      c.nume.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cif.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleAddClient = () => {
    const newClient = {
      id: `client-${Date.now()}`,
      nume: "",
      cif: "",
      nrRegCom: "",
      codContabil: `${(clients.length + 1).toString().padStart(5, "0")}`,
      judet: "",
      localitate: "",
      strada: "",
      codPostal: "",
      telefon: "",
      email: "",
      banca: "",
      iban: "",
      agentId: agents[0]?.id || "",
      priceZone: priceZones[0]?.id || "",
      afiseazaKG: false,
      productCodes: {},
    };
    setEditingClient(newClient);
    setLocalEditingClient(newClient);
  };

  const handleSaveClient = async () => {
    if (!localEditingClient.nume || !localEditingClient.cif) {
      showMessage("Completați denumirea și CUI!  ", "error");
      return;
    }

    try {
      const existingIndex = clients.findIndex(
        (c) => c.id === localEditingClient.id,
      );

      if (existingIndex >= 0) {
        // Update existing client
        await updateClient(localEditingClient.id, localEditingClient);
        const updatedClients = [...clients];
        updatedClients[existingIndex] = localEditingClient;
        setClients(updatedClients);
      } else {
        // Create new client
        await createClient(localEditingClient);
        setClients([...clients, localEditingClient]);
      }
      
      setEditingClient(null);
      setLocalEditingClient(null);
      showMessage("Client salvat cu succes!");
    } catch (error) {
      showMessage("Eroare la salvarea clientului!", "error");
      console.error(error);
    }
  };

  const handleDeleteClient = async (clientId) => {
    if (confirm("Sigur doriți să ștergeți acest client?")) {
      try {
        await deleteClient(clientId);
        const updatedClients = clients.filter((c) => c.id !== clientId);
        setClients(updatedClients);
        showMessage("Client șters cu succes!");
      } catch (error) {
        showMessage("Eroare la ștergerea clientului!", "error");
        console.error(error);
      }
    }
  };

  // Product management functions
  const handleToggleProduct = async (productId, currentStatus) => {
    if (!localEditingClient || !localEditingClient.id) return;
    
    try {
      const response = await fetch(
        `${API_URL}/api/clients/${localEditingClient.id}/products/${productId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !currentStatus })
        }
      );
      
      if (response.ok) {
        // Update local state
        setClientProducts(prev => 
          prev.map(p => p.id === productId ? { ...p, is_active: !currentStatus } : p)
        );
      } else {
        showMessage("Eroare la actualizarea produsului!", "error");
      }
    } catch (error) {
      console.error('Error toggling product:', error);
      showMessage("Eroare la actualizarea produsului!", "error");
    }
  };

  const handleSelectAllProducts = async () => {
    if (!localEditingClient || !localEditingClient.id) return;
    
    try {
      const productIds = clientProducts.map(p => p.id);
      const response = await fetch(
        `${API_URL}/api/clients/${localEditingClient.id}/products/bulk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds, is_active: true })
        }
      );
      
      if (response.ok) {
        setClientProducts(prev => prev.map(p => ({ ...p, is_active: true })));
        showMessage("Toate produsele au fost activate!");
      } else {
        showMessage("Eroare la activarea produselor!", "error");
      }
    } catch (error) {
      console.error('Error activating all products:', error);
      showMessage("Eroare la activarea produselor!", "error");
    }
  };

  const handleDeselectAllProducts = async () => {
    if (!localEditingClient || !localEditingClient.id) return;
    
    try {
      const productIds = clientProducts.map(p => p.id);
      const response = await fetch(
        `${API_URL}/api/clients/${localEditingClient.id}/products/bulk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds, is_active: false })
        }
      );
      
      if (response.ok) {
        setClientProducts(prev => prev.map(p => ({ ...p, is_active: false })));
        showMessage("Toate produsele au fost dezactivate!");
      } else {
        showMessage("Eroare la dezactivarea produselor!", "error");
      }
    } catch (error) {
      console.error('Error deactivating all products:', error);
      showMessage("Eroare la dezactivarea produselor!", "error");
    }
  };

  if (localEditingClient) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-800">
            {clients.find((c) => c.id === localEditingClient.id)
              ? "Editare Client"
              : "Client Nou"}
          </h2>
          <button
            onClick={() => {
              setEditingClient(null);
              setLocalEditingClient(null);
            }}
            className="text-gray-600 hover:text-gray-800"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-6">
          {/* DATE IDENTIFICARE */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Date Identificare</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CUI/CIF *
                </label>
                <input
                  type="text"
                  value={localEditingClient.cif}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      cif: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus: ring-blue-500 focus: border-transparent"
                  placeholder="RO12345678"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nr. Reg. Com. / PFA *
                </label>
                <input
                  type="text"
                  value={localEditingClient.nrRegCom}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      nrRegCom: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="J25/123/2020"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Denumire *
              </label>
              <input
                type="text"
                value={localEditingClient.nume}
                onChange={(e) =>
                  setLocalEditingClient({
                    ...localEditingClient,
                    nume: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="OLIMPOS SRL"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cod Contabil *
              </label>
              <input
                type="text"
                value={localEditingClient.codContabil}
                onChange={(e) =>
                  setLocalEditingClient({
                    ...localEditingClient,
                    codContabil: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="00001"
              />
            </div>
          </div>

          {/* ADRESA */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Adresă</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Județ
                </label>
                <input
                  type="text"
                  value={localEditingClient.judet}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      judet: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Covasna"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Localitate
                </label>
                <input
                  type="text"
                  value={localEditingClient.localitate}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      localitate: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Sfântu Gheorghe"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Strada
              </label>
              <input
                type="text"
                value={localEditingClient.strada}
                onChange={(e) =>
                  setLocalEditingClient({
                    ...localEditingClient,
                    strada: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Str. Principală nr. 10"
              />
            </div>
          </div>

          {/* CONFIGURARE VÂNZĂRI */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">
              Configurare Vânzări
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Agent
                </label>
                <select
                  value={localEditingClient.agentId}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      agentId: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Zonă Preț
                </label>
                <select
                  value={localEditingClient.priceZone}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      priceZone: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {priceZones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={localEditingClient.afiseazaKG}
                onChange={(e) =>
                  setLocalEditingClient({
                    ...localEditingClient,
                    afiseazaKG: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-gray-700">
                Afișează cantități în KG pe factură
              </span>
            </label>
          </div>

          {/* PRODUSE DISPONIBILE - only show for existing clients */}
          {localEditingClient.id && clients.find((c) => c.id === localEditingClient.id) && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">
                Produse Disponibile
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Selectați produsele pe care agentul le poate comanda pentru acest client.
              </p>

              {loadingProducts ? (
                <div className="text-center py-4 text-gray-500">
                  Se încarcă produsele...
                </div>
              ) : clientProducts.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  Nu există produse în sistem.
                </div>
              ) : (
                <>
                  <div className="mb-4 flex gap-2">
                    <button
                      onClick={handleSelectAllProducts}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition text-sm font-medium"
                    >
                      Selectează Toate
                    </button>
                    <button
                      onClick={handleDeselectAllProducts}
                      className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition text-sm font-medium"
                    >
                      Deselectează Toate
                    </button>
                  </div>

                  <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4 space-y-2">
                    {clientProducts.map((product) => (
                      <label
                        key={product.id}
                        className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={product.is_active}
                          onChange={() => handleToggleProduct(product.id, product.is_active)}
                          className="w-4 h-4 rounded text-blue-600"
                        />
                        <span className="text-sm flex-1">
                          <span className="font-medium">{product.descriere}</span>
                          <span className="text-gray-500 ml-2">
                            ({product.codArticolFurnizor})
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 text-sm text-gray-600">
                    {clientProducts.filter(p => p.is_active).length} din {clientProducts.length} produse active
                  </div>
                </>
              )}
            </div>
          )}

          {/* BUTOANE */}
          <div className="border-t pt-6 flex gap-3">
            <button
              onClick={handleSaveClient}
              className="bg-amber-600 text-white px-8 py-2 rounded-lg hover:bg-amber-700 transition flex items-center gap-2 font-medium"
            >
              <Save className="w-5 h-5" />
              Salvează Client
            </button>
            <button
              onClick={() => {
                setEditingClient(null);
                setLocalEditingClient(null);
              }}
              className="bg-gray-300 text-gray-700 px-8 py-2 rounded-lg hover:bg-gray-400 transition font-medium"
            >
              Anulează
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">
          Administrare Clienți
        </h2>
        <button
          onClick={handleAddClient}
          className="bg-amber-600 text-white px-6 py-2 rounded-lg hover:bg-amber-700 transition flex items-center gap-2 font-medium"
        >
          <Plus className="w-5 h-5" />
          Adaugă Client
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Caută client (nume sau CUI)..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Cod
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Denumire
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  CUI
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Nr. Reg.
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Agent
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Zonă
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => {
                const agent = agents.find((a) => a.id === client.agentId);
                const zone = priceZones.find(
                  (z) => z.id === client.priceZone,
                );
                return (
                  <tr
                    key={client.id}
                    className="border-t border-gray-200 hover:bg-gray-50 transition"
                  >
                    <td className="px-4 py-3 text-sm font-medium">
                      {client.codContabil}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {client.nume}
                    </td>
                    <td className="px-4 py-3 text-sm">{client.cif}</td>
                    <td className="px-4 py-3 text-sm">{client.nrRegCom}</td>
                    <td className="px-4 py-3 text-sm">
                      {agent?.name || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm">{zone?.name || "-"}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingClient(client);
                            setLocalEditingClient(client);
                          }}
                          className="text-blue-600 hover:text-blue-800 transition"
                          title="Editare"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClient(client.id)}
                          className="text-red-600 hover:text-red-800 transition"
                          title="Ștergere"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredClients.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Nu au fost găsiți clienți
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientsScreen;
