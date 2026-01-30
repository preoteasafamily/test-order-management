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
import DataManagementScreen from "./pages/DataManagementScreen";

const App = () => {
  // API Configuration
  const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.136:5000';
  
  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Data states
  const [company, setCompany] = useState(null);
  const [gestiuni, setGestiuni] = useState([]);
  const [agents, setAgents] = useState([]);
  const [users, setUsers] = useState([]);
  const [zones, setZones] = useState([]);
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
      // Use API for clients, products, agents, users, and zones
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
          return await response.json();
        }
        console.warn('API not available for users, using localStorage fallback');
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } else if (key === 'zones') {
        const response = await fetch(`${API_URL}/api/zones`);
        if (response.ok) {
          return await response.json();
        }
        console.warn('API not available for zones, using localStorage fallback');
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      } else {
        // For other data, use localStorage
        const result = localStorage.getItem(key);
        return result ? JSON.parse(result) : null;
      }
    } catch (error) {
      console.error(`Error loading ${key}:`, error);
      const result = localStorage.getItem(key);
      return result ? JSON.parse(result) : null;
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

  const syncUsersToAPI = async (usersList) => {
    try {
      // Get current users from API
      const response = await fetch(`${API_URL}/api/users`);
      if (!response.ok) {
        console.warn('API not available, skipping sync');
        return;
      }
      const existingUsers = await response.json();
      const existingIds = new Set(existingUsers.map(u => u.id));

      // Sync each user
      for (const user of usersList) {
        try {
          // Create a copy of user without password for updates
          // Only include password for new users
          const userToSync = existingIds.has(user.id) 
            ? { ...user, password: undefined } // Exclude password for updates
            : user; // Include password for new users

          if (existingIds.has(user.id)) {
            // Update existing user (without password to avoid overwriting hashed passwords)
            const response = await fetch(`${API_URL}/api/users/${user.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(userToSync)
            });
            if (!response.ok) {
              throw new Error('Failed to update user');
            }
          } else {
            // Create new user (with password)
            const response = await fetch(`${API_URL}/api/users`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(userToSync)
            });
            if (!response.ok) {
              throw new Error('Failed to create user');
            }
          }
        } catch (error) {
          console.error(`Failed to sync user ${user.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error syncing users:', error);
    }
  };

  const syncAgentsToAPI = async (agentsList) => {
    try {
      // Get current agents from API
      const response = await fetch(`${API_URL}/api/agents`);
      if (!response.ok) {
        console.warn('API not available, skipping sync');
        return;
      }
      const data = await response.json();
      // Handle wrapped response format from agents API
      const existingAgents = (data.success && Array.isArray(data.data)) ? data.data : [];
      const existingIds = new Set(existingAgents.map(a => a.id));

      // Sync each agent
      for (const agent of agentsList) {
        try {
          if (existingIds.has(agent.id)) {
            // Update existing agent
            const response = await fetch(`${API_URL}/api/agents/${agent.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(agent)
            });
            if (!response.ok) {
              throw new Error('Failed to update agent');
            }
          } else {
            // Create new agent
            const response = await fetch(`${API_URL}/api/agents`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(agent)
            });
            if (!response.ok) {
              throw new Error('Failed to create agent');
            }
          }
        } catch (error) {
          console.error(`Failed to sync agent ${agent.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error syncing agents:', error);
    }
  };

  const syncOrdersToAPI = async (ordersList) => {
    try {
      // Get current orders from API
      const response = await fetch(`${API_URL}/api/orders`);
      if (!response.ok) {
        console.warn('API not available, skipping sync');
        return;
      }
      const existingOrders = await response.json();
      const existingIds = new Set(existingOrders.map(o => o.id));

      // Sync each order
      for (const order of ordersList) {
        try {
          if (existingIds.has(order.id)) {
            // Update existing order
            const response = await fetch(`${API_URL}/api/orders/${order.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(order)
            });
            if (!response.ok) {
              throw new Error('Failed to update order');
            }
          } else {
            // Create new order
            const response = await fetch(`${API_URL}/api/orders`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(order)
            });
            if (!response.ok) {
              throw new Error('Failed to create order');
            }
          }
        } catch (error) {
          console.error(`Failed to sync order ${order.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error syncing orders:', error);
    }
  };

  const syncZonesToAPI = async (zonesList) => {
    try {
      // Get current zones from API
      const response = await fetch(`${API_URL}/api/zones`);
      if (!response.ok) {
        console.warn('API not available, skipping sync');
        return;
      }
      const existingZones = await response.json();
      const existingIds = new Set(existingZones.map(z => z.id));

      // Sync each zone
      for (const zone of zonesList) {
        try {
          if (existingIds.has(zone.id)) {
            // Update existing zone
            const response = await fetch(`${API_URL}/api/zones/${zone.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(zone)
            });
            if (!response.ok) {
              throw new Error('Failed to update zone');
            }
          } else {
            // Create new zone
            const response = await fetch(`${API_URL}/api/zones`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(zone)
            });
            if (!response.ok) {
              throw new Error('Failed to create zone');
            }
          }
        } catch (error) {
          console.error(`Failed to sync zone ${zone.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error syncing zones:', error);
    }
  };

  // Load data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      console.log('🔄 Loading all data...');
      const [
        companyData,
        gestiuniData,
        agentsData,
        usersData,
        zonesData,
        priceZonesData,
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
        loadData("zones"),
        loadData("priceZones"),
        loadData("products"),
        loadData("clients"),
        loadData("contracts"),
        loadData("orders"),
        loadData("dayStatus"),
      ]);

      console.log('✅ Data loaded:', {
        agents: agentsData?.length || 0,
        zones: zonesData?.length || 0,
        priceZones: priceZonesData?.length || 0,
        clients: clientsData?.length || 0,
        products: productsData?.length || 0
      });

      setCompany(companyData || getDefaultCompany());
      setGestiuni(gestiuniData || getDefaultGestiuni());
      setAgents(agentsData || getDefaultAgents());
      setUsers(usersData || []);
      setZones(zonesData || []);
      // Use zones as priceZones if priceZones is not available
      setPriceZones(priceZonesData || zonesData || []);
      setProducts(productsData || getDefaultProducts());
      setClients(clientsData || getDefaultClients());
      setContracts(contractsData || []);
      setOrders(ordersData || []);
      setDayStatus(dayStatusData || {});
      
      console.log('✅ State updated successfully');
    } catch (error) {
      console.error("❌ Error loading data:", error);
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

  const getDefaultProducts = () => [];

  const getDefaultClients = () => [];

  // Show message helper
  const showMessage = (text, type = "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  // Helper function to check if client is active on a given date
  const isClientActive = (client, dateString) => {
    if (!client || !client.status) {
      return true; // Default to active if status is not set
    }
    
    // Active clients are always active
    if (client.status === 'active') {
      return true;
    }
    
    // Inactive clients are never active
    if (client.status === 'inactive') {
      return false;
    }
    
    // Periodic clients - check date range
    if (client.status === 'periodic') {
      if (!client.activeFrom || !client.activeTo) {
        return false; // No date range set, treat as inactive
      }
      
      // Use current date if dateString is not provided
      const checkDate = dateString || new Date().toISOString().split('T')[0];
      
      // Check if checkDate is within the range (inclusive)
      return checkDate >= client.activeFrom && checkDate <= client.activeTo;
    }
    
    // Unknown status, default to active
    return true;
  };

  // ✅ FIXED: Login component
  const LoginScreen = () => {
    const [credentials, setCredentials] = useState({
      username: "",
      password: "",
    });

    const handleLogin = async () => {
  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password
      })
    });

    const data = await response.json();

    if (response.ok && data.user) {
      setCurrentUser(data.user);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setActiveSection("dashboard");
    } else {
      console.error('Login error:', data.error);
      alert(data.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed: ' + error.message);
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
                placeholder="Username"
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
            <div className="text-center">
              <p className="font-semibold mb-2 animate-pulse">© @preoteasa</p>
            </div>
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
            products={products}
            editingClient={editingClient}
            setEditingClient={setEditingClient}
            showMessage={showMessage}
            createClient={createClient}
            updateClient={updateClient}
            deleteClient={deleteClient}
            API_URL={API_URL}
          />
        );
      case "products":
        return (
          <ProductsScreen
            products={products}
            setProducts={setProducts}
            gestiuni={gestiuni}
            zones={zones}
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
            zones={zones}
            setZones={setZones}
            priceZones={priceZones}
            setPriceZones={setPriceZones}
            products={products}
            clients={clients}
            contracts={contracts}
            orders={orders}
            dayStatus={dayStatus}
            currentUser={currentUser}
            users={users}
            showMessage={showMessage}
            saveData={saveData}
            loadAllData={loadAllData}
            syncClientsToAPI={syncClientsToAPI}
            syncProductsToAPI={syncProductsToAPI}
            syncUsersToAPI={syncUsersToAPI}
            syncAgentsToAPI={syncAgentsToAPI}
            syncOrdersToAPI={syncOrdersToAPI}
            syncZonesToAPI={syncZonesToAPI}
            API_URL={API_URL}
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
            isClientActive={isClientActive}
            API_URL={API_URL}
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
            isClientActive={isClientActive}
          />
        );
      case "reports":
        return <ReportsScreen />;
      case "agents":
        return (
          <AgentManager
            agents={agents}
            setAgents={setAgents}
            zones={zones}
            users={users}
            showMessage={showMessage}
            API_URL={API_URL}
          />
        );
      case "users":
        return (
          <UserManager
            users={users}
            setUsers={setUsers}
            agents={agents}
            showMessage={showMessage}
            API_URL={API_URL}
          />
        );
      case "data-management":
        return (
          <DataManagementScreen
            API_URL={API_URL}
            showMessage={showMessage}
            zones={zones}
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
