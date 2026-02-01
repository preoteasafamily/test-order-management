import React, { useState, useEffect } from "react";
import { Calendar, Save, Edit2 } from "lucide-react";

const OrdersMatrixScreen = ({
  orders,
  setOrders,
  clients,
  products,
  agents,
  priceZones,
  contracts,
  dayStatus,
  setDayStatus,
  selectedDate,
  setSelectedDate,
  currentUser,
  showMessage,
  saveData,
  getClientProductPrice,
  isClientActive,
}) => {
  const isDayClosed = dayStatus[selectedDate]?.productionExported || false;

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [matrixData, setMatrixData] = useState({});
  const [editMode, setEditMode] = useState(false);
  const canEdit = !isDayClosed || currentUser.role === "admin";

  const isClientExported = (clientId) => {
    const clientOrder = orders.find(
      (o) => o.clientId === clientId && o.date === selectedDate,
    );
    return clientOrder?.invoiceExported || false;
  };

  useEffect(() => {
    const dateOrders = orders.filter((o) => o.date === selectedDate);
    const matrix = {};

    // Filter clients by agent and active status
    let agentClients =
      selectedAgent === "all"
        ? clients
        : clients.filter((c) => c.agentId === selectedAgent);
    
    // Filter by active status for the selected date
    if (isClientActive) {
      agentClients = agentClients.filter((c) => isClientActive(c, selectedDate));
    }

    agentClients.forEach((client) => {
      const order = dateOrders.find((o) => o.clientId === client.id);

      if (order) {
        matrix[client.id] = {
          paymentType: order.paymentType,
          dueDate: order.dueDate,
          quantities: {},
        };
        order.items.forEach((item) => {
          matrix[client.id].quantities[item.productId] = item.quantity;
        });
      } else {
        matrix[client.id] = {
          paymentType: "immediate",
          dueDate: null,
          quantities: {},
        };
      }
    });

    setMatrixData(matrix);
    setEditMode(false);
  }, [selectedDate, selectedAgent, orders, contracts]);

  const updateQuantity = (clientId, productId, quantity) => {
    setMatrixData((prev) => ({
      ...prev,
      [clientId]: {
        ...prev[clientId],
        quantities: {
          ...prev[clientId].quantities,
          [productId]: quantity,
        },
      },
    }));
  };

  const updatePaymentType = (clientId, paymentType) => {
    setMatrixData((prev) => ({
      ...prev,
      [clientId]: {
        ...prev[clientId],
        paymentType,
        dueDate: paymentType === "credit" ? prev[clientId].dueDate : null,
      },
    }));
  };

  const updateDueDate = (clientId, dueDate) => {
    setMatrixData((prev) => ({
      ...prev,
      [clientId]: {
        ...prev[clientId],
        dueDate,
      },
    }));
  };

  const calculateClientTotal = (clientId) => {
    const client = clients.find((c) => c.id === clientId);
    const data = matrixData[clientId];
    if (!data || !data.quantities) return 0;

    let total = 0;
    Object.entries(data.quantities).forEach(([productId, quantity]) => {
      if (quantity > 0) {
        const product = products.find((p) => p.id === productId);
        const price = getClientProductPrice(client, product);
        const subtotal = quantity * price;
        const tva = subtotal * (product.cotaTVA / 100);
        total += subtotal + tva;
      }
    });

    return total;
  };

  const calculateProductTotal = (productId) => {
    let total = 0;
    Object.values(matrixData).forEach((data) => {
      total += data.quantities[productId] || 0;
    });
    return total;
  };

  const handleSaveMatrix = async () => {
    const newOrders = [];

    Object.entries(matrixData).forEach(([clientId, data]) => {
      const hasItems = Object.values(data.quantities).some((q) => q > 0);

      if (hasItems) {
        const client = clients.find((c) => c.id === clientId);
        const items = [];
        let total = 0;
        let totalTVA = 0;

        Object.entries(data.quantities).forEach(([productId, quantity]) => {
          if (quantity > 0) {
            const product = products.find((p) => p.id === productId);
            const price = getClientProductPrice(client, product);
            const subtotal = quantity * price;
            const tva = subtotal * (product.cotaTVA / 100);

            items.push({ productId, quantity, price });
            total += subtotal;
            totalTVA += tva;
          }
        });

        newOrders.push({
          id: `order-${Date.now()}-${clientId}`,
          date: selectedDate,
          clientId,
          agentId: client.agentId,
          paymentType: data.paymentType,
          dueDate: data.dueDate,
          items,
          total,
          totalTVA,
          totalWithVAT: total + totalTVA,
          invoiceExported: false,
          receiptExported: false,
        });
      }
    });

    const agentIds =
      selectedAgent === "all" ? agents.map((a) => a.id) : [selectedAgent];

    const otherOrders = orders.filter(
      (o) => !(o.date === selectedDate && agentIds.includes(o.agentId)),
    );

    const allOrders = [...otherOrders, ...newOrders];
    const success = await saveData("orders", allOrders);

    if (success) {
      setOrders(allOrders);
      setEditMode(false);
      showMessage(`Salvate ${newOrders.length} comenzi cu succes!`);
    }
  };

  const handleUnlockDay = async () => {
    if (
      !confirm(
        "Sigur doriți să deschideți din nou această zi?  Aceasta va permite editarea comenzilor.",
      )
    ) {
      return;
    }

    const updatedDayStatus = { ...dayStatus };
    if (updatedDayStatus[selectedDate]) {
      updatedDayStatus[selectedDate] = {
        ...updatedDayStatus[selectedDate],
        productionExported: false,
        unlockedBy: currentUser.name,
        unlockedAt: new Date().toISOString(),
      };
    }

    const success = await saveData("dayStatus", updatedDayStatus);
    if (success) {
      setDayStatus(updatedDayStatus);
      showMessage("Ziua a fost deschisă pentru editare!");
    }
  };

  let agentClients =
    selectedAgent === "all"
      ? clients
      : clients.filter((c) => c.agentId === selectedAgent);
  
  // Filter by active status for the selected date
  if (isClientActive) {
    agentClients = agentClients.filter((c) => isClientActive(c, selectedDate));
  }

  const totalValue = agentClients.reduce(
    (sum, c) => sum + calculateClientTotal(c.id),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 bg-white shadow-md rounded-lg p-4 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-gray-800">
              Matrice Comenzi
            </h2>
            {isDayClosed && (
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold">
                  🔒 ZI ÎNCHISĂ
                </span>
                {currentUser.role === "admin" && (
                  <button
                    onClick={handleUnlockDay}
                    className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-semibold hover:bg-orange-200 transition"
                  >
                    🔓 Deschide Ziua
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">Toți Agenții</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-gray-600" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            {editMode ? (
              <div className="flex gap-2">
                <button
                  onClick={handleSaveMatrix}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm transition"
                >
                  <Save className="w-4 h-4" />
                  Salvează
                </button>
                <button
                  onClick={() => {
                    setEditMode(false);
                    const dateOrders = orders.filter(
                      (o) => o.date === selectedDate,
                    );
                    const matrix = {};
                    agentClients.forEach((client) => {
                      const order = dateOrders.find(
                        (o) => o.clientId === client.id,
                      );
                      if (order) {
                        matrix[client.id] = {
                          paymentType: order.paymentType,
                          dueDate: order.dueDate,
                          quantities: {},
                        };
                        order.items.forEach((item) => {
                          matrix[client.id].quantities[item.productId] =
                            item.quantity;
                        });
                      } else {
                        matrix[client.id] = {
                          paymentType: "immediate",
                          dueDate: null,
                          quantities: {},
                        };
                      }
                    });
                    setMatrixData(matrix);
                  }}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 text-sm transition"
                >
                  Anulează
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (!canEdit) {
                    showMessage(
                      "Ziua este închisă!  Doar administratorul poate deschide ziua. ",
                      "error",
                    );
                    return;
                  }
                  setEditMode(true);
                }}
                disabled={!canEdit}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm transition ${
                  canEdit
                    ? "bg-amber-600 text-white hover:bg-amber-700"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }`}
              >
                <Edit2 className="w-4 h-4" />
                {canEdit ? "Editează" : "Blocat"}
              </button>
            )}
          </div>
        </div>
      </div>

      {isDayClosed && currentUser.role !== "admin" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-semibold">
            ⚠️ Atenție: Ziua este închisă!
          </p>
          <p className="text-red-700 text-sm mt-1">
            Producția pentru această zi a fost exportată. Nu se mai pot face
            modificări. Contactați administratorul pentru a deschide ziua.
          </p>
        </div>
      )}
      {isDayClosed && currentUser.role === "admin" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-semibold">
            ⚠️ Atenție: Ziua este închisă!
          </p>
          <p className="text-red-700 text-sm mt-1">
            Producția pentru această zi a fost exportată. Tabelul este vizibil
            dar input-urile sunt dezactivate. Folosiți butonul "🔓 Deschide
            Ziua" pentru a relua editarea.
          </p>
        </div>
      )}

      <div className="bg-white p-4 rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-gray-50 z-10">
                Client
              </th>
              <th className="px-3 py-2 text-center font-semibold">Plată</th>
              <th className="px-3 py-2 text-right font-semibold min-w-[100px]">
                Total
              </th>
              {products.map((p) => (
                <th
                  key={p.id}
                  className="px-1 py-2 text-center font-semibold"
                  style={{ minWidth: "65px" }}
                >
                  <div
                    style={{
                      height: "75px",
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      paddingBottom: "4px",
                    }}
                  >
                    <div
                      style={{
                        writingMode: "vertical-rl",
                        textOrientation: "mixed",
                        transform: "rotate(180deg)",
                        fontSize: "11px",
                        fontWeight: "600",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {p.descriere}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#666",
                      fontWeight: "normal",
                      marginTop: "4px",
                    }}
                  >
                    {p.um}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agentClients.map((client) => {
              const data = matrixData[client.id];
              const total = calculateClientTotal(client.id);
              const isExported = isClientExported(client.id);

              return (
                <tr
                  key={client.id}
                  className={`border-t border-gray-200 hover:bg-gray-50 ${
                    isExported ? "bg-green-50" : ""
                  }`}
                >
                  <td
                    className={`px-3 py-2 font-medium sticky left-0 z-10 ${
                      isExported ? "bg-green-50" : "bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-semibold text-sm">
                          {client.nume}
                        </div>
                        <div className="text-xs text-gray-500">
                          {
                            priceZones.find((z) => z.id === client.priceZone)
                              ?.name
                          }
                        </div>
                      </div>
                      {isExported && (
                        <span className="text-green-600 font-bold text-sm">
                          ✓
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {editMode && !isExported ? (
                      <div className="flex flex-col gap-1 items-center">
                        <select
                          value={data?.paymentType || "immediate"}
                          onChange={(e) =>
                            updatePaymentType(client.id, e.target.value)
                          }
                          disabled={isExported}
                          className="px-2 py-1 border border-gray-300 rounded text-xs w-16 disabled:bg-gray-100"
                        >
                          <option value="immediate">💰</option>
                          <option value="credit">📄</option>
                        </select>
                        {data?.paymentType === "credit" && (
                          <input
                            type="date"
                            value={data.dueDate || ""}
                            onChange={(e) =>
                              updateDueDate(client.id, e.target.value)
                            }
                            className="px-2 py-1 border border-gray-300 rounded text-xs w-24"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="text-center text-sm">
                        {data?.paymentType === "immediate"
                          ? "💰"
                          : data?.paymentType === "credit"
                            ? "📄"
                            : "-"}
                        {data?.paymentType === "credit" && data?.dueDate && (
                          <div className="text-xs text-gray-500">
                            {data.dueDate}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-sm">
                    {total > 0 ? total.toFixed(2) : "-"}
                  </td>
                  {products.map((p) => {
                    const price = getClientProductPrice(client, p);
                    return (
                      <td key={p.id} className="px-1 py-2 text-center">
                        {editMode && !isExported ? (
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              value={data?.quantities[p.id] || ""}
                              onChange={(e) =>
                                updateQuantity(
                                  client.id,
                                  p.id,
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              disabled={isExported}
                              className="w-12 px-1 py-1 border border-gray-300 rounded text-center text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                              placeholder="0"
                            />
                            <div className="text-xs text-gray-400">
                              {price?.toFixed(2)}
                            </div>
                          </div>
                        ) : (
                          <div className="font-medium text-sm">
                            {data?.quantities[p.id] || "-"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t-2 border-gray-400 font-bold bg-amber-50">
              <td className="px-3 py-2 sticky left-0 bg-amber-50 z-10 font-semibold">
                TOTAL
              </td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right text-sm">
                {totalValue.toFixed(2)}
              </td>
              {products.map((p) => (
                <td
                  key={p.id}
                  className="px-1 py-2 text-center font-semibold text-sm"
                >
                  {calculateProductTotal(p.id) || "-"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Clienți Afișați</p>
          <p className="text-2xl font-bold text-gray-800">
            {agentClients.length}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Comenzi Active</p>
          <p className="text-2xl font-bold text-blue-600">
            {
              Object.values(matrixData).filter((d) =>
                Object.values(d.quantities).some((q) => q > 0),
              ).length
            }
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Plată la zi</p>
          <p className="text-2xl font-bold text-amber-600">
            {
              Object.values(matrixData).filter(
                (d) =>
                  d.paymentType === "immediate" &&
                  Object.values(d.quantities).some((q) => q > 0),
              ).length
            }
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-600">Cu termen</p>
          <p className="text-2xl font-bold text-orange-600">
            {
              Object.values(matrixData).filter(
                (d) =>
                  d.paymentType === "credit" &&
                  Object.values(d.quantities).some((q) => q > 0),
              ).length
            }
          </p>
        </div>
      </div>
    </div>
  );
};

export default OrdersMatrixScreen;
