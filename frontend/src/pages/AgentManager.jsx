import React, { useState } from "react";
import { Plus, Search, Edit2, Trash2, Save, X } from "lucide-react";

const AgentManager = ({
  agents,
  setAgents,
  zones,
  users,
  showMessage,
  API_URL,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingAgent, setEditingAgent] = useState(null);

  // Filter users to only those with role='agent'
  const agentUsers = users.filter(u => u.role === 'agent');

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddAgent = () => {
    const newAgent = {
      id: `agent-${Date.now()}`,
      code: `Agent${agents.length + 1}`,
      name: "",
      user_id: "",
      status: "active",
      zones: [],
    };
    setEditingAgent(newAgent);
  };

  const handleSaveAgent = async () => {
    if (!editingAgent.code || !editingAgent.name) {
      showMessage("Completați codul și numele agentului!", "error");
      return;
    }

    try {
      const existingIndex = agents.findIndex((a) => a.id === editingAgent.id);

      if (existingIndex >= 0) {
        // Update existing agent
        const response = await fetch(`${API_URL}/api/agents/${editingAgent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingAgent)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update agent');
        }

        const updatedAgents = [...agents];
        updatedAgents[existingIndex] = editingAgent;
        setAgents(updatedAgents);
        showMessage("Agent actualizat cu succes!");
      } else {
        // Create new agent
        const response = await fetch(`${API_URL}/api/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingAgent)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create agent');
        }

        setAgents([...agents, editingAgent]);
        showMessage("Agent creat cu succes!");
      }

      setEditingAgent(null);
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };

  const handleDeleteAgent = async (agentId) => {
    if (!confirm("Sigur doriți să ștergeți acest agent?")) return;

    try {
      const response = await fetch(`${API_URL}/api/agents/${agentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete agent');
      }

      const updatedAgents = agents.filter((a) => a.id !== agentId);
      setAgents(updatedAgents);
      showMessage("Agent șters cu succes!");
    } catch (error) {
      showMessage(`Eroare: ${error.message}`, "error");
      console.error(error);
    }
  };

  const toggleZone = (zoneId) => {
    const zones = editingAgent.zones || [];
    const newZones = zones.includes(zoneId)
      ? zones.filter((z) => z !== zoneId)
      : [...zones, zoneId];
    setEditingAgent({ ...editingAgent, zones: newZones });
  };

  if (editingAgent) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
            {agents.some((a) => a.id === editingAgent.id)
              ? "Editare Agent"
              : "Agent Nou"}
          </h2>
          <button
            onClick={() => setEditingAgent(null)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cod Agent *
              </label>
              <input
                type="text"
                value={editingAgent.code}
                onChange={(e) =>
                  setEditingAgent({ ...editingAgent, code: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="Agent1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nume Complet *
              </label>
              <input
                type="text"
                value={editingAgent.name}
                onChange={(e) =>
                  setEditingAgent({ ...editingAgent, name: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="Ion Popescu"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Utilizator Asociat
              </label>
              <select
                value={editingAgent.user_id || ""}
                onChange={(e) =>
                  setEditingAgent({ ...editingAgent, user_id: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="">-- Selectează utilizator --</option>
                {agentUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.username})
                  </option>
                ))}
              </select>
              {editingAgent.user_id && (
                <p className="text-xs text-gray-500 mt-1">
                  Utilizator: {agentUsers.find(u => u.id === editingAgent.user_id)?.name || 'N/A'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={editingAgent.status}
                onChange={(e) =>
                  setEditingAgent({ ...editingAgent, status: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="active">Activ</option>
                <option value="inactive">Inactiv</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Zone de Preț Alocate
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {zones.map((zone) => (
                <label
                  key={zone.id}
                  className="flex items-center space-x-2 p-3 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={(editingAgent.zones || []).includes(zone.id)}
                    onChange={() => toggleZone(zone.id)}
                    className="w-4 h-4 text-amber-600"
                  />
                  <span className="text-sm">{zone.name}</span>
                </label>
              ))}
            </div>
            {zones.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">
                Nu există zone. Adaugă zone în secțiunea Configurare.
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              onClick={() => setEditingAgent(null)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Anulează
            </button>
            <button
              onClick={handleSaveAgent}
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
          Gestionare Agenți
        </h2>
        <button
          onClick={handleAddAgent}
          className="flex items-center justify-center space-x-2 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Agent Nou</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center space-x-2 mb-4">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Caută agent după nume sau cod..."
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
                  Cod
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Nume
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Utilizator
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Zone Alocate
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
              {filteredAgents.map((agent) => {
                const agentUser = agentUsers.find(u => u.id === agent.user_id);
                return (
                  <tr key={agent.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">{agent.code}</td>
                    <td className="py-3 px-4 font-medium">{agent.name}</td>
                    <td className="py-3 px-4">
                      {agentUser ? (
                        <span className="text-sm text-gray-600">
                          {agentUser.name}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(agent.zones || []).map((zoneId) => {
                          const zone = zones.find((z) => z.id === zoneId);
                          return zone ? (
                            <span
                              key={zoneId}
                              className="px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded"
                            >
                              {zone.name}
                            </span>
                          ) : null;
                        })}
                        {(!agent.zones || agent.zones.length === 0) && (
                          <span className="text-gray-400 text-sm">Nicio zonă</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          agent.status === "active"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {agent.status === "active" ? "Activ" : "Inactiv"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => setEditingAgent(agent)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent.id)}
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

          {filteredAgents.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {searchTerm
                ? "Nu s-au găsit agenți care să corespundă căutării."
                : "Nu există agenți în sistem. Adaugă primul agent!"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentManager;
