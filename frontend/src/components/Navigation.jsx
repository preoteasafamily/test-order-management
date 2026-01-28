import React from 'react';
import { 
  Package, 
  FileText, 
  DollarSign, 
  Users, 
  Settings, 
  Download,
  X,
  Home,
  Menu,
  UserCog
} from 'lucide-react';

const Navigation = ({ currentUser, activeSection, setActiveSection, mobileMenuOpen, setMobileMenuOpen }) => {
  const menuItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: Package,
      roles: ["admin", "birou", "agent"],
    },
    {
      id: "orders-agent",
      label: "Comenzi Agenți",
      icon: FileText,
      roles: ["agent"],
    },
    {
      id: "orders-matrix",
      label: "Matrice Comenzi",
      icon: FileText,
      roles: ["admin", "birou"],
    },
    {
      id: "reports",
      label: "Rapoarte",
      icon: DollarSign,
      roles: ["admin", "birou"],
    },
    {
      id: "clients",
      label: "Clienți",
      icon: Users,
      roles: ["admin", "birou"],
    },
    {
      id: "products",
      label: "Produse",
      icon: Package,
      roles: ["admin", "birou"],
    },
    {
      id: "contracts",
      label: "Contracte",
      icon: FileText,
      roles: ["admin", "birou"],
    },
    {
      id: "agents",
      label: "Agenți",
      icon: UserCog,
      roles: ["admin"],
    },
    {
      id: "users",
      label: "Utilizatori",
      icon: Users,
      roles: ["admin"],
    },
    { id: "config", label: "Configurare", icon: Settings, roles: ["admin"] },
    {
      id: "export",
      label: "Export Documente",
      icon: Download,
      roles: ["admin", "birou"],
    },
  ];

  const handleNavClick = (itemId) => {
    setActiveSection(itemId);
    setMobileMenuOpen(false); // Close mobile menu on navigation
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden lg:block bg-gray-800 text-white w-64 min-h-screen p-4">
        <nav className="space-y-2">
          {menuItems
            .filter((item) => item.roles.includes(currentUser.role))
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === item.id
                      ? "bg-amber-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black bg-opacity-50" onClick={() => setMobileMenuOpen(false)}>
          <div 
            className="bg-gray-800 text-white w-64 min-h-screen p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Menu</h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="space-y-2">
              {menuItems
                .filter((item) => item.roles.includes(currentUser.role))
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                        activeSection === item.id
                          ? "bg-amber-600 text-white"
                          : "text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
            </nav>
          </div>
        </div>
      )}

      {/* Mobile Bottom Tab Navigation for Agents */}
      {currentUser.role === "agent" && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40">
          <div className="flex justify-around items-center h-16">
            <button
              onClick={() => handleNavClick("dashboard")}
              className={`flex flex-col items-center justify-center flex-1 h-full ${
                activeSection === "dashboard"
                  ? "text-amber-600"
                  : "text-gray-600"
              }`}
            >
              <Home className="w-6 h-6" />
              <span className="text-xs mt-1">Dashboard</span>
            </button>
            <button
              onClick={() => handleNavClick("orders-agent")}
              className={`flex flex-col items-center justify-center flex-1 h-full ${
                activeSection === "orders-agent"
                  ? "text-amber-600"
                  : "text-gray-600"
              }`}
            >
              <FileText className="w-6 h-6" />
              <span className="text-xs mt-1">Comenzi</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex flex-col items-center justify-center flex-1 h-full text-gray-600"
            >
              <Menu className="w-6 h-6" />
              <span className="text-xs mt-1">Meniu</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Navigation;
