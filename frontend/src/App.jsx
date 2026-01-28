import React, { useState, useEffect } from "react";

// Imported components
import Header from "./components/Header";
import Navigation from "./components/Navigation";
import Dashboard from "./pages/Dashboard";
import OrdersAgentScreen from "./pages/OrdersAgentScreen";
import OrdersMatrixScreen from "./pages/OrdersMatrixScreen";
import ReportsScreen from "./pages/ReportsScreen";
import ExportScreen from "./pages/ExportScreen";
import ClientsScreen from "./pages/ClientsScreen";
import ProductsScreen from "./pages/ProductsScreen";
import ConfigScreen from "./pages/ConfigScreen";
import ContractsScreen from "./pages/ContractsScreen";
import AgentManager from "./pages/AgentManager";
import UserManager from "./pages/UserManager";

const App = () => {
  // API Configuration
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  
  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Data states
  const [company, setCompany] = useState(null);
  const [gestiuni, setGestiuni] = useState([]);
  const [agents, setAgents] = useState([]);
  const [users, setUsers] = useState([]);
  const [priceZones, setPriceZones] = useState([]);
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [dayStatus, setDayStatus] = useState({});

  // ✅ ADAUGĂ AICI - după toți useState-urile:
  useEffect(() => {
    const loadAllData = async () => {
      // ... cod existent...
    };
    loadAllData();
  }, []);

  // ✅ ADAUGĂ ȘI ASTA - după useEffect-ul de loadAllData:
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "dayStatus") {
        const updated = e.newValue ? JSON.parse(e.newValue) : {};
        setDayStatus(updated);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // UI states
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  // ✅ API-aware Storage - uses API for clients/products, localStorage for others
  const loadData = async (key) => {
    try {
      // Use API for clients and products
      if (key === 'clients') {
        const response = await fetch(`${API_URL}/api/clients`);
        if (response.ok) {
          return await response.json();
        }
        console.warn('API not available for clients, using localStorage fallback');
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } else if (key === 'products') {
        const response = await fetch(`${API_URL}/api/products`);
        if (response.ok) {
          return await response.json();
        }
        console.warn('API not available for products, using localStorage fallback');
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } else if (key === 'agents') {
        const response = await fetch(`${API_URL}/api/agents`);
        if (response.ok) {
          const result = await response.json();
          return result.success ? result.data : [];
        }
        console.warn('API not available for agents, using localStorage fallback');
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } else if (key === 'users') {
        const response = await fetch(`${API_URL}/api/users`);
        if (response.ok) {
          const result = await response.json();
          return result.success ? result.data : [];
        }
        console.warn('API not available for users, using localStorage fallback');
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } else {
        // Use localStorage for other data
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      }
    } catch (error) {
      console.error(`Error loading ${key}:`, error);
      // Fallback to localStorage on error
      try {
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } catch {
        return null;
      }
    }
  };

  const saveData = async (key, data) => {
    try {
      // Use API for clients and products
      if (key === 'clients') {
        // For clients, we need to handle both create and update operations
        // Since we're replacing the entire array, we need to sync all clients
        // This is not efficient but maintains compatibility with existing code
        localStorage.setItem(key, JSON.stringify(data)); // Keep localStorage as fallback
        return true;
      } else if (key === 'products') {
        // Same approach for products
        localStorage.setItem(key, JSON.stringify(data)); // Keep localStorage as fallback
        return true;
      } else {
        // Use localStorage for other data
        localStorage.setItem(key, JSON.stringify(data));
        return true;
      }
    } catch (error) {
      console.error(`Error saving ${key}:`, error);
      return false;
    }
  };

  // API helper functions for clients
  const createClient = async (client) => {
    try {
      const response = await fetch(`${API_URL}/api/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(client)
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error('Failed to create client');
    } catch (error) {
      console.error('Error creating client:', error);
      throw error;
    }
  };

  const updateClient = async (id, client) => {
    try {
      const response = await fetch(`${API_URL}/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(client)
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error('Failed to update client');
    } catch (error) {
      console.error('Error updating client:', error);
      throw error;
    }
  };

  const deleteClient = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/clients/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error('Failed to delete client');
    } catch (error) {
      console.error('Error deleting client:', error);
      throw error;
    }
  };

  // API helper functions for products
  const createProduct = async (product) => {
    try {
      const response = await fetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error('Failed to create product');
    } catch (error) {
      console.error('Error creating product:', error);
      throw error;
    }
  };

  const updateProduct = async (id, product) => {
    try {
      const response = await fetch(`${API_URL}/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error('Failed to update product');
    } catch (error) {
      console.error('Error updating product:', error);
      throw error;
    }
  };

  const deleteProduct = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/products/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error('Failed to delete product');
    } catch (error) {
      console.error('Error deleting product:', error);
      throw error;
    }
  };

  // Bulk sync function for import/export
  const syncClientsToAPI = async (clientsList) => {
    try {
      // Get current clients from API
      const response = await fetch(`${API_URL}/api/clients`);
      if (!response.ok) {
        console.warn('API not available, skipping sync');
        return;
      }
      const existingClients = await response.json();
      const existingIds = new Set(existingClients.map(c => c.id));

      // Sync each client
      for (const client of clientsList) {
        try {
          if (existingIds.has(client.id)) {
            await updateClient(client.id, client);
          } else {
            await createClient(client);
          }
        } catch (error) {
          console.error(`Failed to sync client ${client.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error syncing clients:', error);
    }
  };

  const syncProductsToAPI = async (productsList) => {
    try {
      // Get current products from API
      const response = await fetch(`${API_URL}/api/products`);
      if (!response.ok) {
        console.warn('API not available, skipping sync');
        return;
      }
      const existingProducts = await response.json();
      const existingIds = new Set(existingProducts.map(p => p.id));

      // Sync each product
      for (const product of productsList) {
        try {
          if (existingIds.has(product.id)) {
            await updateProduct(product.id, product);
          } else {
            await createProduct(product);
          }
        } catch (error) {
          console.error(`Failed to sync product ${product.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error syncing products:', error);
    }
  };

  // Load data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      const [
        companyData,
        gestiuniData,
        agentsData,
        usersData,
        zonesData,
        productsData,
        clientsData,
        contractsData,
        ordersData,
        dayStatusData,
      ] = await Promise.all([
        loadData("company"),
        loadData("gestiuni"),
        loadData("agents"),
        loadData("users"),
        loadData("priceZones"),
        loadData("products"),
        loadData("clients"),
        loadData("contracts"),
        loadData("orders"),
        loadData("dayStatus"),
      ]);

      setCompany(companyData || getDefaultCompany());
      setGestiuni(gestiuniData || getDefaultGestiuni());
      setAgents(agentsData || getDefaultAgents());
      setUsers(usersData || []);
      setPriceZones(zonesData || getDefaultPriceZones());
      setProducts(productsData || getDefaultProducts());
      setClients(clientsData || getDefaultClients());
      setContracts(contractsData || []);
      setOrders(ordersData || []);
      setDayStatus(dayStatusData || {});
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  // Default data
  const getDefaultCompany = () => ({
    furnizorNume: "SC PANIFICATIE SRL",
    furnizorCIF: "RO4402892",
    furnizorNrRegCom: "J14/603/1993",
    furnizorCapital: "20000.00",
    furnizorAdresa: "",
    furnizorJudet: "Covasna",
    furnizorLocalitate: "Sfântu Gheorghe",
    furnizorStrada: "Str. Fabricii nr. 10",
    furnizorBanca: "BCR",
    furnizorIBAN: "RO49RNCB0000000123456789",
    contIncasariCasa: "5311",
    contIncasariBanca: "5121",
    contImplicit: "5311",
    invoiceSeries: "FAC",
    invoiceNumber: 1,
    receiptSeries: "CN",
    receiptNumber: 1,
    deliverySeries: "AVZ",
    deliveryNumber: 1,
    lotNumberStart: 11111,
    lotNumberCurrent: 11111,
    lotDate: null,
    cotaTVA: 11,
  });

  const getDefaultGestiuni = () => [
    { id: "piese", name: "PIESE" },
    { id: "patiserie", name: "PATISERIE" },
    { id: "panificatie", name: "PANIFICATIE" },
  ];

  const getDefaultAgents = () => [
    { id: "agent1", code: "Agent1", name: "Ion Popescu" },
    { id: "agent2", code: "Agent2", name: "Maria Ionescu" },
  ];

  const getDefaultPriceZones = () => [
    { id: "zona-a", name: "Zona A", description: "Premium" },
    { id: "zona-b", name: "Zona B", description: "Standard" },
    { id: "zona-c", name: "Zona C", description: "Discount" },
  ];

  const getDefaultProducts = () => [
    {
      id: "pc",
      codArticolFurnizor: "00000001",
      codProductie: "684811825476",
      codBare: "",
      descriere: "PAINE FELIAT 1.5 KG",
      um: "BUC",
      gestiune: "piese",
      gramajKg: 1.5,
      cotaTVA: 11,
      prices: { "zona-a": 9.17, "zona-b": 8.5, "zona-c": 7.8 },
    },
    {
      id: "corn",
      codArticolFurnizor: "00000002",
      codProductie: "684811825477",
      codBare: "",
      descriere: "CORN CU CAS 90G",
      um: "BUC",
      gestiune: "piese",
      gramajKg: 0.09,
      cotaTVA: 11,
      prices: { "zona-a": 2.02, "zona-b": 1.85, "zona-c": 1.7 },
    },
    {
      id: "chifle",
      codArticolFurnizor: "00000003",
      codProductie: "684811825478",
      codBare: "",
      descriere: "CHIFLE",
      um: "BUC",
      gestiune: "piese",
      gramajKg: 0.05,
      cotaTVA: 11,
      prices: { "zona-a": 1.74, "zona-b": 1.6, "zona-c": 1.5 },
    },
  ];

  const getDefaultClients = () => [
    {
      id: "olimpos",
      nume: "OLIMPOS SRL",
      cif: "RO12345678",
      nrRegCom: "J25/123/2020",
      codContabil: "00001",
      judet: "Covasna",
      localitate: "Sfântu Gheorghe",
      strada: "Str. Principală nr. 10",
      codPostal: "520008",
      telefon: "0267-111222",
      email: "contact@olimpos.ro",
      banca: "BCR",
      iban: "RO49RNCB0000000111222333",
      agentId: "agent1",
      priceZone: "zona-a",
      afiseazaKG: true,
      productCodes: { pc: "PAIN-001" },
    },
    {
      id: "gaspar3",
      nume: "GASPAR 3 SRL",
      cif: "RO87654321",
      nrRegCom: "J25/456/2019",
      codContabil: "00002",
      judet: "Covasna",
      localitate: "Sfântu Gheorghe",
      strada: "Str. Mihai Viteazu nr. 5",
      codPostal: "520009",
      telefon: "0267-222333",
      email: "contact@gaspar3.ro",
      banca: "BCR",
      iban: "RO49RNCB0000000222333444",
      agentId: "agent1",
      priceZone: "zona-a",
      afiseazaKG: false,
      productCodes: {},
    },
  ];

  // Show message helper
  const showMessage = (text, type = "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  // ✅ FIXED: Login component
  const LoginScreen = () => {
    const [credentials, setCredentials] = useState({
      username: "",
      password: "",
    });

    const handleLogin = () => {
      const users = {
        admin: { password: "admin", role: "admin", name: "Administrator" },
        birou: { password: "birou", role: "birou", name: "Birou" },
        agent1: {
          password: "agent1",
          role: "agent",
          agentId: "agent1",
          name: "Ion Popescu",
        },
        agent2: {
          password: "agent2",
          role: "agent",
          agentId: "agent2",
          name: "Maria Ionescu",
        },
      };

      const user = users[credentials.username];
      if (user && user.password === credentials.password) {
        setCurrentUser({ username: credentials.username, ...user });
        setActiveSection("dashboard");
      } else {
        showMessage("Date de autentificare invalide! ", "error");
      }
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-amber-100 rounded-full mx-auto mb-4 flex items-center justify-center">
              <span className="text-5xl">🥖</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">
              Sistem Management Comenzi
            </h1>
            <p className="text-gray-600 mt-2">Panificație & Patiserie</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Utilizator
              </label>
              <input
                type="text"
                value={credentials.username}
                onChange={(e) =>
                  setCredentials({ ...credentials, username: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus: ring-amber-500 focus: border-transparent"
                placeholder="admin / birou / agent1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Parolă
              </label>
              <input
                type="password"
                value={credentials.password}
                onChange={(e) =>
                  setCredentials({ ...credentials, password: e.target.value })
                }
                onKeyPress={(e) => e.key === "Enter" && handleLogin()}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="••••••"
              />
            </div>

            <button
              onClick={handleLogin}
              className="w-full bg-amber-600 text-white py-2 rounded-lg hover:bg-amber-700 transition-colors font-medium"
            >
              Autentificare
            </button>
          </div>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
            <p className="font-semibold mb-2">Conturi demo:</p>
            <p>• admin / admin</p>
            <p>• birou / birou</p>
            <p>• agent1 / agent1</p>
          </div>
        </div>
      </div>
    );
  };

  // getClientProductPrice helper
  const getClientProductPrice = (client, product) => {
    // Dacă client are contract, preț din contract
    if (client.contractId) {
      const contract = contracts.find((c) => c.id === client.contractId);
      return contract?.prices[product.id] || product.prices[client.priceZone];
    }
    // Altfel, preț din zonă
    return product.prices[client.priceZone];
  };

  // Render content
  const renderContent = () => {
    switch (activeSection) {
      case "dashboard":
        return <Dashboard orders={orders} clients={clients} />;
      case "clients":
        return (
          <ClientsScreen
            clients={clients}
            setClients={setClients}
            agents={agents}
            priceZones={priceZones}
            editingClient={editingClient}
            setEditingClient={setEditingClient}
            showMessage={showMessage}
            createClient={createClient}
            updateClient={updateClient}
            deleteClient={deleteClient}
          />
        );
      case "products":
        return (
          <ProductsScreen
            products={products}
            setProducts={setProducts}
            gestiuni={gestiuni}
            priceZones={priceZones}
            editingProduct={editingProduct}
            setEditingProduct={setEditingProduct}
            showMessage={showMessage}
            createProduct={createProduct}
            updateProduct={updateProduct}
            deleteProduct={deleteProduct}
          />
        );
      case "contracts":
        return (
          <ContractsScreen
            clients={clients}
            setClients={setClients}
            products={products}
            contracts={contracts}
            setContracts={setContracts}
            showMessage={showMessage}
            saveData={saveData}
            updateClient={updateClient}
          />
        );
      case "config":
        return (
          <ConfigScreen
            company={company}
            setCompany={setCompany}
            gestiuni={gestiuni}
            agents={agents}
            priceZones={priceZones}
            products={products}
            clients={clients}
            contracts={contracts}
            orders={orders}
            dayStatus={dayStatus}
            currentUser={currentUser}
            showMessage={showMessage}
            saveData={saveData}
            loadAllData={loadAllData}
            syncClientsToAPI={syncClientsToAPI}
            syncProductsToAPI={syncProductsToAPI}
          />
        );
      case "orders-agent":
        return (
          <OrdersAgentScreen
            orders={orders}
            setOrders={setOrders}
            clients={clients}
            products={products}
            priceZones={priceZones}
            company={company}
            setCompany={setCompany}
            dayStatus={dayStatus}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            currentUser={currentUser}
            showMessage={showMessage}
            saveData={saveData}
            getClientProductPrice={getClientProductPrice}
          />
        );
      case "orders-matrix":
        return (
          <OrdersMatrixScreen
            orders={orders}
            setOrders={setOrders}
            clients={clients}
            products={products}
            agents={agents}
            priceZones={priceZones}
            contracts={contracts}
            dayStatus={dayStatus}
            setDayStatus={setDayStatus}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            currentUser={currentUser}
            showMessage={showMessage}
            saveData={saveData}
            getClientProductPrice={getClientProductPrice}
          />
        );
      case "reports":
        return <ReportsScreen />;
      case "agents":
        return (
          <AgentManager
            agents={agents}
            setAgents={setAgents}
            priceZones={priceZones}
            showMessage={showMessage}
            API_URL={API_URL}
          />
        );
      case "users":
        return (
          <UserManager
            users={users}
            setUsers={setUsers}
            showMessage={showMessage}
            API_URL={API_URL}
          />
        );
      case "export":
        return (
          <ExportScreen
            orders={orders}
            setOrders={setOrders}
            clients={clients}
            products={products}
            gestiuni={gestiuni}
            company={company}
            dayStatus={dayStatus}
            setDayStatus={setDayStatus}
            currentUser={currentUser}
            showMessage={showMessage}
            saveData={saveData}
          />
        );
      default:
        return <Dashboard orders={orders} clients={clients} />;
    }
  };

  if (!currentUser) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />
      <div className="flex">
        <Navigation 
          currentUser={currentUser}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
        />
        <div className="flex-1 p-4 sm:p-6 pb-20 lg:pb-6">
          {message && (
            <div
              className={`mb-4 p-4 rounded-lg ${
                message.type === "success"
                  ? "bg-green-100 text-green-800"
                  : message.type === "error"
                    ? "bg-red-100 text-red-800"
                    : "bg-blue-100 text-blue-800"
              }`}
            >
              {message.text}
            </div>
          )}
          {renderContent()}
        </div>
      </div>
    </div>
  );
};


export default App;
