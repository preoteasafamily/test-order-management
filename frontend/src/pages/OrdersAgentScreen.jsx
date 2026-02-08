import React, { useState, useEffect } from "react";
import { Calendar, Save, MinusCircle, PlusCircle, Trash2 } from "lucide-react";

const OrdersAgentScreen = ({
  orders,
  setOrders,
  clients,
  products,
  priceZones,
  company,
  setCompany,
  dayStatus,
  selectedDate,
  setSelectedDate,
  currentUser,
  showMessage,
  saveData,
  getClientProductPrice,
  isClientActive,
  API_URL,
  createOrder,
  updateOrder,
  deleteOrder,
}) => {
  const isDayClosed = dayStatus[selectedDate]?.productionExported || false;
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [availableProducts, setAvailableProducts] = useState(products);
  const [currentOrder, setCurrentOrder] = useState({
    paymentType: "immediate",
    dueDate: null,
    items: [],
  });

  // Filter clients by agent and active status
  const agentClients = clients.filter(
    (c) => c.agentId === currentUser.agentId && (isClientActive ? isClientActive(c, selectedDate) : true),
  );

  // Load active products when client is selected
  useEffect(() => {
    if (selectedClient) {
      loadClientProducts(selectedClient.id);
      
      const existingOrder = orders.find(
        (o) => o.clientId === selectedClient.id && o.date === selectedDate,
      );

      if (existingOrder) {
        setCurrentOrder({
          paymentType: existingOrder.paymentType,
          dueDate: existingOrder.dueDate,
          items: existingOrder.items,
        });
      } else {
        setCurrentOrder({
          paymentType: "immediate",
          dueDate: null,
          items: [],
        });
      }
    } else {
      setAvailableProducts(products);
    }
  }, [selectedClient, selectedDate]);

  // Load active products for selected client
  const loadClientProducts = async (clientId) => {
    try {
      const response = await fetch(`${API_URL}/api/clients/${clientId}/products`);
      if (response.ok) {
        const activeProducts = await response.json();
        setAvailableProducts(activeProducts);
      } else {
        console.error('Failed to load client products, using all products');
        setAvailableProducts(products);
      }
    } catch (error) {
      console.error('Error loading client products:', error);
      setAvailableProducts(products);
    }
  };

  const updateQuantity = (productId, quantity) => {
    const product = availableProducts.find((p) => p.id === productId);
    const price = getClientProductPrice(selectedClient, product);

    setCurrentOrder((prev) => {
      const items = [...prev.items];
      const itemIndex = items.findIndex((i) => i.productId === productId);

      if (quantity > 0) {
        if (itemIndex >= 0) {
          items[itemIndex] = { productId, quantity, price };
        } else {
          items.push({ productId, quantity, price });
        }
      } else {
        if (itemIndex >= 0) {
          items.splice(itemIndex, 1);
        }
      }

      return { ...prev, items };
    });
  };

  const getQuantity = (productId) => {
    const item = currentOrder.items.find((i) => i.productId === productId);
    return item ? item.quantity : 0;
  };

  const calculateTotal = () => {
    return currentOrder.items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId);
      const subtotal = item.quantity * item.price;
      const tva = subtotal * (product.cotaTVA / 100);
      return sum + subtotal + tva;
    }, 0);
  };

  const handleSaveOrder = async () => {
    if (isDayClosed) {
      showMessage(
        "⛔ Ziua este închisă!   Nu se mai pot adăuga comenzi.",
        "error",
      );
      return;
    }

    if (!selectedClient) {
      showMessage("Selectați un client! ", "error");
      return;
    }

    if (currentOrder.items.length === 0) {
      showMessage("Adăugați produse în comandă! ", "error");
      return;
    }

    let total = 0;
    let totalTVA = 0;

    currentOrder.items.forEach((item) => {
      const product = products.find((p) => p.id === item.productId);
      const subtotal = item.quantity * item.price;
      const tva = subtotal * (product.cotaTVA / 100);
      total += subtotal;
      totalTVA += tva;
    });

    // Check if order already exists for this client and date
    const existingOrder = orders.find(
      (o) => o.date === selectedDate && o.clientId === selectedClient.id,
    );

    const orderData = {
      id: existingOrder?.id || `order-${Date.now()}-${selectedClient.id}`,
      date: selectedDate,
      clientId: selectedClient.id,
      agentId: currentUser.agentId,
      paymentType: currentOrder.paymentType,
      dueDate: currentOrder.dueDate,
      items: currentOrder.items,
      total,
      totalTVA,
      totalWithVAT: total + totalTVA,
      invoiceExported: existingOrder?.invoiceExported || false,
      receiptExported: existingOrder?.receiptExported || false,
    };

    // ✅ LOGICA:  Check dacă e prima comandă a acestei zile
    const ordersBeforeToday = orders.filter((o) => o.date === selectedDate);
    const isFirstOrderOfDay = ordersBeforeToday.length === 0;

    let updatedCompany = company;

    // ✅ Dacă e prima comandă a zilei ȘI e o zi nouă, incrementează LOT
    if (isFirstOrderOfDay && !existingOrder) {
      const lastLotDate = company.lotDate;
      const today = selectedDate;

      // Verifică dacă LOT-ul e de ieri
      if (lastLotDate !== today) {
        updatedCompany = {
          ...company,
          lotNumberCurrent: company.lotNumberCurrent + 1,
          lotDate: today,
        };

        const companySaved = await saveData("company", updatedCompany);
        if (!companySaved) {
          showMessage("Eroare salvare LOT!", "error");
          return;
        }
        setCompany(updatedCompany);
        showMessage(
          `📦 LOT incrementat automat:  ${updatedCompany.lotNumberCurrent}`,
        );
      }
    }

    try {
      if (existingOrder) {
        await updateOrder(existingOrder.id, orderData);
        showMessage("Comandă actualizată cu succes!");
      } else {
        await createOrder(orderData);
        showMessage("Comandă salvată cu succes!");
      }
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
    }
  };

  const handleBack = () => {
    setSelectedClient(null);
    setCurrentOrder({
      paymentType: "immediate",
      dueDate: null,
      items: [],
    });
  };

  const handleDeleteOrder = async () => {
    if (!selectedClient) return;

    const existingOrder = orders.find(
      (o) => o.clientId === selectedClient.id && o.date === selectedDate,
    );

    if (!existingOrder) {
      showMessage("Nu există comandă de șters!", "error");
      return;
    }

    if (existingOrder.invoiceExported) {
      showMessage("Nu se poate șterge o comandă exportată!", "error");
      return;
    }

    if (!window.confirm("Sigur doriți să ștergeți această comandă?")) {
      return;
    }

    try {
      await deleteOrder(existingOrder.id);
      showMessage("Comandă ștearsă cu succes!");
      handleBack();
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
    }
  };

  const getOrderStatus = () => {
    if (!selectedClient) return { isExported: false, isDisabled: false };

    const selectedOrder = orders.find(
      (o) => o.clientId === selectedClient.id && o.date === selectedDate,
    );

    const isExported = selectedOrder?.invoiceExported || false;
    const isDisabled = isDayClosed || isExported;

    return { isExported, isDisabled };
  };

  if (!selectedClient) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-800">
              Comenzi - {currentUser.name}
            </h2>
            {isDayClosed && (
              <span className="px-2 sm:px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap">
                🔒 ZI ÎNCHISĂ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-600 flex-shrink-0" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 sm:flex-none px-3 py-2.5 border-2 border-gray-300 rounded-lg text-sm sm:text-base min-h-[44px] focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        {isDayClosed && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 font-semibold text-sm sm:text-base">
              ⚠️ Atenție: Ziua este închisă!
            </p>
            <p className="text-red-700 text-xs sm:text-sm mt-1">
              Producția pentru această zi a fost exportată. Nu se mai pot
              modifica comenzile.
            </p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Selectați Client</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {agentClients.map((client) => {
              const clientOrder = orders.find(
                (o) => o.clientId === client.id && o.date === selectedDate,
              );
              return (
                <button
                  key={client.id}
                  onClick={() => setSelectedClient(client)}
                  disabled={isDayClosed}
                  className={`p-4 border-2 rounded-lg text-left transition-all min-h-[80px] ${
                    clientOrder
                      ? "border-green-500 bg-green-50 hover:bg-green-100"
                      : "border-gray-200 hover:border-amber-500 hover:bg-amber-50"
                  } ${isDayClosed ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm sm:text-base truncate">
                        {client.nume}
                      </p>
                      <p className="text-xs text-gray-600 mt-1 truncate">
                        {
                          priceZones.find((z) => z.id === client.priceZone)
                            ?.name
                        }
                      </p>
                    </div>
                    {clientOrder && (
                      <span className="text-green-600 text-xl ml-2 flex-shrink-0">✓</span>
                    )}
                  </div>
                  {clientOrder && (
                    <div className="mt-2 pt-2 border-t border-green-200">
                      <p className="text-xs text-gray-600">
                        {clientOrder.items?.length || 0} produse ·{" "}
                        {clientOrder.totalWithVAT?.toFixed(2)} RON
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  const { isExported, isDisabled } = getOrderStatus();
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-gray-100 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            ← Înapoi
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-800">
              {selectedClient.nume}
            </h2>
            {isExported && (
              <span className="text-green-600 font-semibold text-xs sm:text-sm">
                ✓ Exportat
              </span>
            )}
            {isDayClosed && !isExported && (
              <span className="text-red-600 font-semibold text-xs sm:text-sm">
                🔒 Închis
              </span>
            )}
          </div>
          {/* Delete button - only show if order exists and is not exported */}
          {orders.find(
            (o) => o.clientId === selectedClient.id && o.date === selectedDate,
          ) && !isExported && (
            <button
              onClick={handleDeleteOrder}
              disabled={isDisabled}
              className={`p-2 hover:bg-red-100 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center text-red-600 ${
                isDisabled ? "opacity-50 cursor-not-allowed" : ""
              }`}
              title="Șterge comanda"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
        
        {/* Payment Type Selection - Mobile Optimized */}
        <div className="flex flex-col gap-2 w-full sm:w-auto">
          <div className="flex gap-2">
            <button
              onClick={() =>
                setCurrentOrder({
                  ...currentOrder,
                  paymentType: "immediate",
                  dueDate: null,
                })
              }
              disabled={isDisabled}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
                currentOrder.paymentType === "immediate"
                  ? "bg-amber-600 text-white"
                  : "bg-white border-2 border-gray-300 text-gray-700 hover:border-amber-500"
              } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              💰 Plată la zi
            </button>
            <button
              onClick={() =>
                setCurrentOrder({ ...currentOrder, paymentType: "credit" })
              }
              disabled={isDisabled}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
                currentOrder.paymentType === "credit"
                  ? "bg-amber-600 text-white"
                  : "bg-white border-2 border-gray-300 text-gray-700 hover:border-amber-500"
              } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              📄 Cu termen
            </button>
          </div>
          {currentOrder.paymentType === "credit" && (
            <input
              type="date"
              value={currentOrder.dueDate || ""}
              onChange={(e) =>
                setCurrentOrder({ ...currentOrder, dueDate: e.target.value })
              }
              disabled={isDisabled}
              className="w-full px-3 py-2.5 border-2 border-gray-300 rounded-lg text-sm min-h-[44px]"
            />
          )}
        </div>
      </div>
      {isExported && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 font-semibold text-sm">
            ✓ Factură exportată - nu se mai poate edita
          </p>
        </div>
      )}

      {isDayClosed && !isExported && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-semibold text-sm sm:text-base">
            ⚠️ Atenție: Ziua este închisă!
          </p>
          <p className="text-red-700 text-xs sm:text-sm mt-1">
            Producția pentru această zi a fost exportată. Nu se mai pot
            modifica comenzile.
          </p>
        </div>
      )}
      <div className="bg-white rounded-lg shadow p-3 sm:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
          {availableProducts.map((product) => {
            const price = getClientProductPrice(selectedClient, product);
            const quantity = getQuantity(product.id);

            return (
              <div
                key={product.id}
                className={`border-2 rounded-lg p-3 transition-all ${
                  quantity > 0
                    ? "border-amber-500 bg-amber-50"
                    : "border-gray-200"
                }`}
              >
                <p className="text-xs sm:text-sm font-medium text-gray-800 mb-1 line-clamp-2 min-h-[32px]">
                  {product.descriere}
                </p>
                <p className="text-xs text-gray-600 mb-2 font-semibold">
                  {price?.toFixed(2)} RON
                </p>
                
                {/* Mobile-Optimized Quantity Controls */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(product.id, Math.max(0, quantity - 1))}
                    disabled={isDisabled || quantity === 0}
                    className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Decrease quantity"
                  >
                    <MinusCircle className="w-5 h-5 text-gray-700" />
                  </button>
                  
                  <input
                    type="number"
                    min="0"
                    value={quantity || ""}
                    onChange={(e) =>
                      updateQuantity(product.id, parseInt(e.target.value) || 0)
                    }
                    disabled={isDisabled}
                    className="flex-1 min-w-0 px-2 py-2 border-2 border-gray-300 rounded-lg text-center text-sm font-semibold disabled:bg-gray-100 focus:border-amber-500 focus:outline-none"
                    placeholder="0"
                  />
                  
                  <button
                    onClick={() => updateQuantity(product.id, quantity + 1)}
                    disabled={isDisabled}
                    className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Increase quantity"
                  >
                    <PlusCircle className="w-5 h-5 text-white" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky Bottom Action Bar - Mobile Optimized */}
      <div className="fixed lg:static bottom-0 left-0 right-0 bg-white border-t lg:border-t-0 lg:rounded-lg shadow-lg lg:shadow p-4 z-30">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 max-w-full">
          <div className="w-full sm:w-auto">
            <p className="text-xs sm:text-sm text-gray-600">Total Comandă</p>
            <p className="text-2xl sm:text-3xl font-bold text-amber-600">
              {calculateTotal().toFixed(2)} RON
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {currentOrder.items.length} produse în comandă
            </p>
          </div>
          <button
            onClick={handleSaveOrder}
            disabled={isDisabled || currentOrder.items.length === 0}
            className={`w-full sm:w-auto px-6 py-3.5 rounded-lg flex items-center justify-center gap-2 font-semibold text-base min-h-[52px] transition-all ${
              isDisabled || currentOrder.items.length === 0
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-800"
            }`}
          >
            <Save className="w-5 h-5" />
            <span>Salvează Comandă</span>
          </button>
        </div>
      </div>
      
      {/* Spacer for mobile sticky button */}
      <div className="h-24 lg:hidden"></div>
    </div>
  );
};

export default OrdersAgentScreen;
