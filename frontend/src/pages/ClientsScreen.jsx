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
  const [selectedClients, setSelectedClients] = useState([]);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("active");
  const [bulkActiveFrom, setBulkActiveFrom] = useState("");
  const [bulkActiveTo, setBulkActiveTo] = useState("");
  const [showBulkZoneModal, setShowBulkZoneModal] = useState(false);
  const [bulkZone, setBulkZone] = useState("");
  const [showEFacturaSection, setShowEFacturaSection] = useState(false);

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
      const response = await fetch(
        `${API_URL}/api/clients/${clientId}/products/all`,
      );
      if (response.ok) {
        const data = await response.json();
        setClientProducts(data);
      } else {
        console.error("Failed to load client products");
        setClientProducts([]);
      }
    } catch (error) {
      console.error("Error loading client products:", error);
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
    const defaultAgent = agents.length > 0 ? agents[0].id : null;
    const defaultZone = priceZones.length > 0 ? priceZones[0].id : null;
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
      agentId: defaultAgent || "", // ✅ Will be first agent OR empty
      priceZone: defaultZone || "", // ✅ Will be first zone OR empty
      afiseazaKG: false,
      productCodes: {},
      status: "active",
      activeFrom: null,
      activeTo: null,
      buyer_contact: "",
      buyer_country: "RO",
      buyer_vat_identifier: "",
      delivery_name: "",
      delivery_gln: "",
      delivery_address: "",
      delivery_city: "",
      delivery_region: "",
      delivery_country: "RO",
    };
    setEditingClient(newClient);
    setLocalEditingClient(newClient);
  };

  const handleSaveClient = async () => {
    // Validate required fields
    if (!localEditingClient.nume || !localEditingClient.cif) {
      showMessage("Completați denumirea și CUI!", "error");
      return;
    }

    // Validate agentId and priceZone
    if (
      !localEditingClient.agentId ||
      localEditingClient.agentId.trim() === ""
    ) {
      showMessage("Selectați un agent!", "error");
      return;
    }

    if (
      !localEditingClient.priceZone ||
      localEditingClient.priceZone.trim() === ""
    ) {
      showMessage("Selectați o zonă de preț!", "error");
      return;
    }

    // Validate that selected agent exists
    const agentExists = agents.find((a) => a.id === localEditingClient.agentId);
    if (!agentExists) {
      showMessage("Agentul selectat nu există!", "error");
      return;
    }

    // Validate that selected price zone exists
    const zoneExists = priceZones.find(
      (z) => z.id === localEditingClient.priceZone,
    );
    if (!zoneExists) {
      showMessage("Zona de preț selectată nu există!", "error");
      return;
    }

    // Validate status and date range for periodic clients
    const status = localEditingClient.status || "active";
    if (status === "periodic") {
      if (!localEditingClient.activeFrom || !localEditingClient.activeTo) {
        showMessage("Pentru status periodic, completați ambele date!", "error");
        return;
      }
      if (localEditingClient.activeFrom > localEditingClient.activeTo) {
        showMessage(
          "Data de început trebuie să fie înainte sau egală cu data de sfârșit!",
          "error",
        );
        return;
      }
    }

    try {
      const existingIndex = clients.findIndex(
        (c) => c.id === localEditingClient.id,
      );

      console.log("💾 Saving client:", {
        id: localEditingClient.id,
        nume: localEditingClient.nume,
        agentId: localEditingClient.agentId,
        priceZone: localEditingClient.priceZone,
        isUpdate: existingIndex >= 0,
      });

      let response;
      if (existingIndex >= 0) {
        // Update existing client
        response = await updateClient(
          localEditingClient.id,
          localEditingClient,
        );
        console.log("✅ Update response:", response);

        // Reload client from API to ensure we have the latest data
        try {
          const updatedClientResponse = await fetch(
            `${API_URL}/api/clients/${localEditingClient.id}`,
          );
          if (updatedClientResponse.ok) {
            const updatedClient = await updatedClientResponse.json();
            const updatedClients = [...clients];
            updatedClients[existingIndex] = updatedClient;
            setClients(updatedClients);
            console.log("✅ Client updated in state:", updatedClient);
          } else {
            // Fallback to local state if API read fails
            const updatedClients = [...clients];
            updatedClients[existingIndex] = localEditingClient;
            setClients(updatedClients);
          }
        } catch (fetchError) {
          // If reload fails, use local state - the save itself was successful
          console.warn(
            "⚠️ Could not reload client from API, using local state:",
            fetchError,
          );
          const updatedClients = [...clients];
          updatedClients[existingIndex] = localEditingClient;
          setClients(updatedClients);
        }
      } else {
        // Create new client
        response = await createClient(localEditingClient);
        console.log("✅ Create response:", response);

        // Reload client from API to ensure we have the latest data
        const newClient = response.id ? response : localEditingClient;
        setClients([...clients, newClient]);
        console.log("✅ Client added to state:", newClient);
      }

      setEditingClient(null);
      setLocalEditingClient(null);
      showMessage("Client salvat cu succes!");
    } catch (error) {
      console.error("❌ Error saving client:", error);
      showMessage(
        "Eroare la salvarea clientului: " +
          (error?.message || "Eroare necunoscută"),
        "error",
      );
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
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !currentStatus }),
        },
      );

      if (response.ok) {
        // Update local state
        setClientProducts((prev) =>
          prev.map((p) =>
            p.id === productId ? { ...p, is_active: !currentStatus } : p,
          ),
        );
      } else {
        showMessage("Eroare la actualizarea produsului!", "error");
      }
    } catch (error) {
      console.error("Error toggling product:", error);
      showMessage("Eroare la actualizarea produsului!", "error");
    }
  };

  const handleSelectAllProducts = async () => {
    if (!localEditingClient || !localEditingClient.id) return;

    try {
      const productIds = clientProducts.map((p) => p.id);
      const response = await fetch(
        `${API_URL}/api/clients/${localEditingClient.id}/products/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds, is_active: true }),
        },
      );

      if (response.ok) {
        setClientProducts((prev) =>
          prev.map((p) => ({ ...p, is_active: true })),
        );
        showMessage("Toate produsele au fost activate!");
      } else {
        showMessage("Eroare la activarea produselor!", "error");
      }
    } catch (error) {
      console.error("Error activating all products:", error);
      showMessage("Eroare la activarea produselor!", "error");
    }
  };

  const handleDeselectAllProducts = async () => {
    if (!localEditingClient || !localEditingClient.id) return;

    try {
      const productIds = clientProducts.map((p) => p.id);
      const response = await fetch(
        `${API_URL}/api/clients/${localEditingClient.id}/products/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds, is_active: false }),
        },
      );

      if (response.ok) {
        setClientProducts((prev) =>
          prev.map((p) => ({ ...p, is_active: false })),
        );
        showMessage("Toate produsele au fost dezactivate!");
      } else {
        showMessage("Eroare la dezactivarea produselor!", "error");
      }
    } catch (error) {
      console.error("Error deactivating all products:", error);
      showMessage("Eroare la dezactivarea produselor!", "error");
    }
  };

  // Bulk status management functions
  const handleSelectClient = (clientId) => {
    setSelectedClients((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  };

  const handleSelectAll = () => {
    if (selectedClients.length === filteredClients.length) {
      setSelectedClients([]);
    } else {
      setSelectedClients(filteredClients.map((c) => c.id));
    }
  };

  const handleBulkStatusChange = async () => {
    if (selectedClients.length === 0) {
      showMessage("Selectați cel puțin un client!", "error");
      return;
    }

    if (bulkStatus === "periodic") {
      if (!bulkActiveFrom || !bulkActiveTo) {
        showMessage("Completați datele de început și sfârșit!", "error");
        return;
      }
      if (bulkActiveFrom > bulkActiveTo) {
        showMessage(
          "Data de început trebuie să fie înainte de data de sfârșit!",
          "error",
        );
        return;
      }
    }

    try {
      const updatedClients = clients.map((c) => {
        if (!selectedClients.includes(c.id)) return c;
        const updated = { ...c, status: bulkStatus };
        if (bulkStatus === "periodic") {
          updated.activeFrom = bulkActiveFrom;
          updated.activeTo = bulkActiveTo;
        }
        return updated;
      });

      await Promise.all(
        updatedClients
          .filter((c) => selectedClients.includes(c.id))
          .map((c) => updateClient(c.id, c)),
      );

      setClients(updatedClients);
      showMessage(
        `Statusul a fost schimbat pentru ${selectedClients.length} clienți!`,
      );
      setSelectedClients([]);
      setShowBulkModal(false);
      setBulkStatus("active");
      setBulkActiveFrom("");
      setBulkActiveTo("");
    } catch (error) {
      console.error("Error updating bulk status:", error);
      showMessage("Eroare la schimbarea statusului!", "error");
    }
  };

  const handleBulkZoneChange = async () => {
    if (selectedClients.length === 0) {
      showMessage("Selectați cel puțin un client!", "error");
      return;
    }

    if (!bulkZone) {
      showMessage("Selectați o zonă!", "error");
      return;
    }

    try {
      const updatedClients = clients.map((c) =>
        selectedClients.includes(c.id) ? { ...c, priceZone: bulkZone } : c,
      );

      await Promise.all(
        updatedClients
          .filter((c) => selectedClients.includes(c.id))
          .map((c) => updateClient(c.id, c)),
      );

      setClients(updatedClients);
      showMessage(
        `Zona a fost schimbată pentru ${selectedClients.length} clienți!`,
      );
      setSelectedClients([]);
      setShowBulkZoneModal(false);
      setBulkZone("");
    } catch (error) {
      console.error("Error updating bulk zone:", error);
      showMessage("Eroare la schimbarea zonei!", "error");
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
            <h3 className="text-lg font-semibold mb-4">Configurare Vânzări</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Agent
                </label>
                <select
                  value={localEditingClient.agentId || ""}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      agentId: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {agents.length === 0 ? (
                    <option value="">-- Niciun agent disponibil --</option>
                  ) : (
                    <>
                      <option value="">-- Selectați agent --</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Zonă Preț
                </label>
                <select
                  value={localEditingClient.priceZone || ""}
                  onChange={(e) =>
                    setLocalEditingClient({
                      ...localEditingClient,
                      priceZone: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {priceZones.length === 0 ? (
                    <option value="">-- Nicio zonă disponibilă --</option>
                  ) : (
                    <>
                      <option value="">-- Selectați zonă --</option>
                      {priceZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                        </option>
                      ))}
                    </>
                  )}
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

            {/* CLIENT STATUS */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status Client
              </label>
              <select
                value={localEditingClient.status || "active"}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  setLocalEditingClient({
                    ...localEditingClient,
                    status: newStatus,
                    // Clear dates if not periodic
                    activeFrom:
                      newStatus === "periodic"
                        ? localEditingClient.activeFrom
                        : null,
                    activeTo:
                      newStatus === "periodic"
                        ? localEditingClient.activeTo
                        : null,
                  });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="active">Activ</option>
                <option value="inactive">Inactiv</option>
                <option value="periodic">Periodic</option>
              </select>
            </div>

            {/* DATE RANGE FOR PERIODIC STATUS */}
            {localEditingClient.status === "periodic" && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Activ De La *
                  </label>
                  <input
                    type="date"
                    value={localEditingClient.activeFrom || ""}
                    onChange={(e) =>
                      setLocalEditingClient({
                        ...localEditingClient,
                        activeFrom: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Activ Până La *
                  </label>
                  <input
                    type="date"
                    value={localEditingClient.activeTo || ""}
                    onChange={(e) =>
                      setLocalEditingClient({
                        ...localEditingClient,
                        activeTo: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}
          </div>

          {/* DETALII E-FACTURA */}
          <div className="border-t pt-6">
            <button
              type="button"
              onClick={() => setShowEFacturaSection(!showEFacturaSection)}
              className="flex items-center gap-2 text-lg font-semibold text-gray-800 hover:text-blue-700 transition w-full text-left"
            >
              <span>{showEFacturaSection ? "▾" : "▸"}</span>
              Detalii e-Factura
            </button>

            {showEFacturaSection && (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-gray-500">
                  Câmpuri utilizate la generarea automată a facturilor electronice (e-Factura RO).
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Persoană Contact Cumpărător (BT-56)
                    </label>
                    <input
                      type="text"
                      value={localEditingClient.buyer_contact || ""}
                      onChange={(e) =>
                        setLocalEditingClient({
                          ...localEditingClient,
                          buyer_contact: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ion Popescu"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Țară Cumpărător (BT-55)
                    </label>
                    <input
                      type="text"
                      value={localEditingClient.buyer_country || "RO"}
                      onChange={(e) =>
                        setLocalEditingClient({
                          ...localEditingClient,
                          buyer_country: e.target.value || "RO",
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="RO"
                      maxLength={2}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cod TVA Cumpărător (BT-48)
                  </label>
                  <input
                    type="text"
                    value={localEditingClient.buyer_vat_identifier || ""}
                    onChange={(e) =>
                      setLocalEditingClient({
                        ...localEditingClient,
                        buyer_vat_identifier: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="RO12345678"
                  />
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    Adresă Livrare
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Denumire Loc Livrare (BT-70)
                      </label>
                      <input
                        type="text"
                        value={localEditingClient.delivery_name || ""}
                        onChange={(e) =>
                          setLocalEditingClient({
                            ...localEditingClient,
                            delivery_name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Depozit Central"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        GLN Loc Livrare (BT-71)
                      </label>
                      <input
                        type="text"
                        value={localEditingClient.delivery_gln || ""}
                        onChange={(e) =>
                          setLocalEditingClient({
                            ...localEditingClient,
                            delivery_gln: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="5600123000000"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Adresă Livrare (BT-75)
                    </label>
                    <input
                      type="text"
                      value={localEditingClient.delivery_address || ""}
                      onChange={(e) =>
                        setLocalEditingClient({
                          ...localEditingClient,
                          delivery_address: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Str. Industriilor nr. 5"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Localitate Livrare (BT-77)
                      </label>
                      <input
                        type="text"
                        value={localEditingClient.delivery_city || ""}
                        onChange={(e) =>
                          setLocalEditingClient({
                            ...localEditingClient,
                            delivery_city: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="București"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Județ/Regiune Livrare (BT-79)
                      </label>
                      <input
                        type="text"
                        value={localEditingClient.delivery_region || ""}
                        onChange={(e) =>
                          setLocalEditingClient({
                            ...localEditingClient,
                            delivery_region: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Ilfov"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Țară Livrare (BT-80)
                      </label>
                      <input
                        type="text"
                        value={localEditingClient.delivery_country || "RO"}
                        onChange={(e) =>
                          setLocalEditingClient({
                            ...localEditingClient,
                            delivery_country: e.target.value || "RO",
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="RO"
                        maxLength={2}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* PRODUSE DISPONIBILE - only show for existing clients */}
          {localEditingClient.id &&
            clients.find((c) => c.id === localEditingClient.id) && (
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">
                  Produse Disponibile
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Selectați produsele pe care agentul le poate comanda pentru
                  acest client.
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
                            onChange={() =>
                              handleToggleProduct(product.id, product.is_active)
                            }
                            className="w-4 h-4 rounded text-blue-600"
                          />
                          <span className="text-sm flex-1">
                            <span className="font-medium">
                              {product.descriere}
                            </span>
                            <span className="text-gray-500 ml-2">
                              ({product.codArticolFurnizor})
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="mt-3 text-sm text-gray-600">
                      {clientProducts.filter((p) => p.is_active).length} din{" "}
                      {clientProducts.length} produse active
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

        {/* Bulk Actions Toolbar */}
        {selectedClients.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-blue-800">
              {selectedClients.length} clienți selectați
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBulkModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
              >
                Schimbă Status
              </button>
              <button
                onClick={() => setShowBulkZoneModal(true)}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition text-sm font-medium"
              >
                Schimbă Zonă
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  <input
                    type="checkbox"
                    checked={
                      selectedClients.length === filteredClients.length &&
                      filteredClients.length > 0
                    }
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded"
                  />
                </th>
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
                  Denumire Loc Livrare
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Agent
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Zonă
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Status
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => {
                const agent = agents.find((a) => a.id === client.agentId);
                const zone = priceZones.find((z) => z.id === client.priceZone);
                return (
                  <tr
                    key={client.id}
                    className="border-t border-gray-200 hover:bg-gray-50 transition"
                  >
                    <td className="px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedClients.includes(client.id)}
                        onChange={() => handleSelectClient(client.id)}
                        className="w-4 h-4 rounded"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {client.codContabil}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {client.nume}
                    </td>
                    <td className="px-4 py-3 text-sm">{client.cif}</td>
                    <td className="px-4 py-3 text-sm">{client.delivery_name || "-"}</td>
                    <td className="px-4 py-3 text-sm">{agent?.name || "-"}</td>
                    <td className="px-4 py-3 text-sm">{zone?.name || "-"}</td>
                    <td className="px-4 py-3 text-sm">
                      {(() => {
                        const status = client.status || "active";
                        if (status === "active") {
                          return (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Activ
                            </span>
                          );
                        } else if (status === "inactive") {
                          return (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              Inactiv
                            </span>
                          );
                        } else if (status === "periodic") {
                          const dateRange =
                            client.activeFrom && client.activeTo
                              ? `${new Date(client.activeFrom).toLocaleDateString("ro-RO", { day: "numeric", month: "short" })} - ${new Date(client.activeTo).toLocaleDateString("ro-RO", { day: "numeric", month: "short", year: "numeric" })}`
                              : "";
                          return (
                            <span
                              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                              title={dateRange}
                            >
                              Periodic {dateRange && `(${dateRange})`}
                            </span>
                          );
                        }
                      })()}
                    </td>
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

      {/* Bulk Status Change Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              Schimbare Status în Masă
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Modificați statusul pentru {selectedClients.length} clienți
              selectați
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status Nou
                </label>
                <select
                  value={bulkStatus}
                  onChange={(e) => {
                    setBulkStatus(e.target.value);
                    if (e.target.value !== "periodic") {
                      setBulkActiveFrom("");
                      setBulkActiveTo("");
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="active">Activ</option>
                  <option value="inactive">Inactiv</option>
                  <option value="periodic">Periodic</option>
                </select>
              </div>

              {bulkStatus === "periodic" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Activ De La *
                    </label>
                    <input
                      type="date"
                      value={bulkActiveFrom}
                      onChange={(e) => setBulkActiveFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Activ Până La *
                    </label>
                    <input
                      type="date"
                      value={bulkActiveTo}
                      onChange={(e) => setBulkActiveTo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleBulkStatusChange}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition font-medium"
                >
                  Aplică
                </button>
                <button
                  onClick={() => {
                    setShowBulkModal(false);
                    setBulkActiveFrom("");
                    setBulkActiveTo("");
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition font-medium"
                >
                  Anulează
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showBulkZoneModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              Schimbare Zonă în Masă
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Modificați zona pentru {selectedClients.length} clienți selectați
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Zonă Nouă *
                </label>
                <select
                  value={bulkZone}
                  onChange={(e) => setBulkZone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">-- Selectați zonă --</option>
                  {priceZones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleBulkZoneChange}
                  className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition font-medium"
                >
                  Aplică
                </button>
                <button
                  onClick={() => {
                    setShowBulkZoneModal(false);
                    setBulkZone("");
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition font-medium"
                >
                  Anulează
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsScreen;
