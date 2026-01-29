import React, { useState } from "react";
import { Plus, Search, Edit2, Trash2, Save, X } from "lucide-react";

const UserManager = ({
  users,
  setUsers,
  agents,
  showMessage,
  API_URL,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingUser, setEditingUser] = useState(null);

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddUser = () => {
    const newUser = {
      id: `user-${Date.now()}`,
      username: "",
      password: "",
      role: "birou",
      name: "",
      agent_id: "",
      status: "active",
    };
    setEditingUser(newUser);
  };

  const handleSaveUser = async () => {
    if (!editingUser.username || !editingUser.name || !editingUser.role) {
      showMessage("Completați username, numele și rolul!", "error");
      return;
    }

    const existingIndex = users.findIndex((u) => u.id === editingUser.id);
    
    // If creating a new user, password is required
    if (existingIndex < 0 && !editingUser.password) {
      showMessage("Parola este obligatorie pentru utilizatori noi!", "error");
      return;
    }

    try {
      if (existingIndex >= 0) {
        // Update existing user
        const response = await fetch(`${API_URL}/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingUser)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update user');
        }

        const updatedUsers = [...users];
        updatedUsers[existingIndex] = { ...editingUser };
        // Remove password from local state for security
        delete updatedUsers[existingIndex].password;
        setUsers(updatedUsers);
        showMessage("Utilizator actualizat cu succes!");
      } else {
        // Create new user
        const response = await fetch(`${API_URL}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingUser)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create user');
        }

        const newUserData = { ...editingUser };
        delete newUserData.password; // Don't store password in state
        setUsers([...users, newUserData]);
        showMessage("Utilizator creat cu succes!");
      }

      setEditingUser(null);
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm("Sigur doriți să ștergeți acest utilizator?")) return;

    try {
      const response = await fetch(`${API_URL}/api/users/${userId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete user');
      }

      const updatedUsers = users.filter((u) => u.id !== userId);
      setUsers(updatedUsers);
      showMessage("Utilizator șters cu succes!");
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };

  if (editingUser) {
    const isNewUser = !users.some((u) => u.id === editingUser.id);
    
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
            {isNewUser ? "Utilizator Nou" : "Editare Utilizator"}
          </h2>
          <button
            onClick={() => setEditingUser(null)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username *
              </label>
              <input
                type="text"
                value={editingUser.username}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, username: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nume Complet *
              </label>
              <input
                type="text"
                value={editingUser.name}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, name: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="Ion Popescu"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Parolă {isNewUser ? "*" : "(opțional - lasă gol pentru a păstra cea curentă)"}
              </label>
              <input
                type="password"
                value={editingUser.password || ""}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, password: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder={isNewUser ? "Parolă" : "Lasă gol pentru a păstra"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rol *
              </label>
              <select
                value={editingUser.role}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, role: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="admin">Administrator</option>
                <option value="birou">Birou</option>
                <option value="agent">Agent</option>
              </select>
            </div>

            {editingUser.role === 'agent' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Agent Asociat
                </label>
                <select
                  value={editingUser.agent_id || ""}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, agent_id: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">-- Selectează agent --</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.code})
                    </option>
                  ))}
                </select>
                {editingUser.agent_id && (
                  <p className="text-xs text-gray-500 mt-1">
                    Agent: {agents.find(a => a.id === editingUser.agent_id)?.name || 'N/A'}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={editingUser.status}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, status: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="active">Activ</option>
                <option value="inactive">Inactiv</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              onClick={() => setEditingUser(null)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Anulează
            </button>
            <button
              onClick={handleSaveUser}
              className="flex items-center space-x-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              <Save className="w-4 h-4" />
              <span>Salvează</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
          Gestionare Utilizatori
        </h2>
        <button
          onClick={handleAddUser}
          className="flex items-center justify-center space-x-2 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Utilizator Nou</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center space-x-2 mb-4">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Caută utilizator după nume sau username..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 border-0 focus:ring-0 text-gray-700"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Username
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Nume
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Rol
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Agent
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Status
                </th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const userAgent = agents.find(a => a.id === user.agent_id);
                return (
                  <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium">{user.username}</td>
                    <td className="py-3 px-4">{user.name}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          user.role === "admin"
                            ? "bg-purple-100 text-purple-800"
                            : user.role === "birou"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {user.role === "admin"
                          ? "Administrator"
                          : user.role === "birou"
                          ? "Birou"
                          : "Agent"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {user.role === 'agent' && userAgent ? (
                        <span className="text-sm text-gray-600">
                          {userAgent.name}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          user.status === "active"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {user.status === "active" ? "Activ" : "Inactiv"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => setEditingUser({ ...user, password: "" })}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
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

          {filteredUsers.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {searchTerm
                ? "Nu s-au găsit utilizatori care să corespundă căutării."
                : "Nu există utilizatori în sistem. Adaugă primul utilizator!"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserManager;
