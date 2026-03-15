const express = require("express");
const router = express.Router();
const db = require("../database");

// ✅ MIGRATION - Adaugă agentName coloane dacă nu există
try {
  const tableInfo = db.prepare("PRAGMA table_info(agent_locations)").all();
  const hasAgentName = tableInfo.some((col) => col.name === "agentName");

  if (!hasAgentName) {
    console.log("📌 Migration: Adding agentName column to agent_locations...");
    db.exec("ALTER TABLE agent_locations ADD COLUMN agentName TEXT");
    console.log("✅ agentName column added");
  }
} catch (e) {
  console.log("⚠️ Migration skipped:", e.message);
}

// ✅ MIGRATION - Adaugă câmpuri CI și mijloc transport la agents
try {
  const agentTableInfo = db.prepare("PRAGMA table_info(agents)").all();
  const colNames = agentTableInfo.map((col) => col.name);

  if (!colNames.includes("ci_serie")) {
    db.exec("ALTER TABLE agents ADD COLUMN ci_serie TEXT");
    console.log("✅ agents.ci_serie column added");
  }
  if (!colNames.includes("ci_numar")) {
    db.exec("ALTER TABLE agents ADD COLUMN ci_numar TEXT");
    console.log("✅ agents.ci_numar column added");
  }
  if (!colNames.includes("ci_eliberat_de")) {
    db.exec("ALTER TABLE agents ADD COLUMN ci_eliberat_de TEXT");
    console.log("✅ agents.ci_eliberat_de column added");
  }
  if (!colNames.includes("mijloc_transport")) {
    db.exec("ALTER TABLE agents ADD COLUMN mijloc_transport TEXT");
    console.log("✅ agents.mijloc_transport column added");
  }
} catch (e) {
  console.log("⚠️ Agent fields migration skipped:", e.message);
}

// ============ AGENT LOCATIONS ENDPOINTS ============

// Preiau locațiile tuturor agenților (GET /api/agents/locations)
router.get("/locations", (req, res) => {
  try {
    console.log("🔍 Fetching agent locations...");

    const locations = db
      .prepare(
        `
      SELECT id, agentId, agentName, latitude, longitude, accuracy, timestamp
      FROM agent_locations
      WHERE timestamp > datetime('now', '-24 hours')
      ORDER BY timestamp DESC
    `,
      )
      .all();

    console.log("✅ Locations found:", locations.length);
    res.json(locations || []);
  } catch (error) {
    console.error("❌ Error fetching locations:", error.message);

    // Try to create table if missing
    if (error.message.includes("no such table")) {
      console.log("📌 Creating agent_locations table...");
      try {
        db.prepare(
          `
          CREATE TABLE IF NOT EXISTS agent_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agentId TEXT NOT NULL,
            agentName TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `,
        ).run();
        console.log("✅ agent_locations table created");
        res.json([]);
      } catch (createErr) {
        console.error("❌ Error creating table:", createErr.message);
        res.status(500).json({ error: createErr.message });
      }
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Salvează locația agentului (POST /api/agents/:agentId/location)
router.post("/:agentId/location", (req, res) => {
  const { agentId } = req.params;
  const { latitude, longitude, accuracy, agentName } = req.body;

  // Validare input
  if (!agentId || !latitude || !longitude) {
    return res.status(400).json({
      success: false,
      error: "agentId, latitude, and longitude are required",
    });
  }

  try {
    console.log(
      `📍 Location received for agent ${agentId} (${agentName}):`,
      latitude,
      longitude,
    );

    // ✅ CALCULEAZĂ CORECT - Romania time (UTC+2)
    const now = new Date();
    const roTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const timestamp = roTime.toISOString().replace("T", " ").slice(0, 19);

    // Try to insert with agentName
    db.prepare(
      `
      INSERT INTO agent_locations (agentId, agentName, latitude, longitude, accuracy, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      agentId,
      agentName || "Unknown",
      latitude,
      longitude,
      accuracy || null,
      timestamp
    );

    console.log(`✅ Location saved for agent ${agentId}`);
    res.json({ success: true, message: "Location saved" });
  } catch (error) {
    console.error("❌ Error saving location:", error.message);

    // If table doesn't exist, create it and retry
    if (error.message.includes("no such table")) {
      try {
        console.log("📌 Creating agent_locations table...");
        db.prepare(
          `
          CREATE TABLE IF NOT EXISTS agent_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agentId TEXT NOT NULL,
            agentName TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `,
        ).run();

        console.log("✅ Table created, retrying insert...");

        // ✅ CALCULEAZĂ CORECT - Romania time (UTC+2)
        const now = new Date();
        const roTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const timestamp = roTime.toISOString().replace("T", " ").slice(0, 19);

        db.prepare(
          `
          INSERT INTO agent_locations (agentId, agentName, latitude, longitude, accuracy, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        ).run(
          agentId,
          agentName || "Unknown",
          latitude,
          longitude,
          accuracy || null,
          timestamp
        );

        console.log(`✅ Location saved for agent ${agentId}`);
        res.json({
          success: true,
          message: "Table created and location saved",
        });
      } catch (createErr) {
        console.error("❌ Error creating table:", createErr.message);
        res.status(500).json({ error: createErr.message });
      }
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// ============ REGULAR AGENT ROUTES ============

// Get all agents (GET /api/agents)
router.get("/", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM agents ORDER BY name").all();
    const agents = (rows || []).map((row) => ({
      ...row,
      zones: row.zones ? JSON.parse(row.zones) : [],
    }));
    res.json({ success: true, data: agents });
  } catch (err) {
    console.error("❌ Error fetching agents:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single agent (GET /api/agents/:id)
router.get("/:id", (req, res) => {
  try {
    const row = db
      .prepare("SELECT * FROM agents WHERE id = ?")
      .get(req.params.id);
    if (!row) {
      res.status(404).json({ success: false, error: "Agent not found" });
    } else {
      const agent = {
        ...row,
        zones: row.zones ? JSON.parse(row.zones) : [],
      };
      res.json({ success: true, data: agent });
    }
  } catch (err) {
    console.error("❌ Error fetching agent:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create agent (POST /api/agents)
router.post("/", (req, res) => {
  const agent = req.body;

  if (!agent.id || !agent.code || !agent.name) {
    return res.status(400).json({
      success: false,
      error: "ID, code, and name are required",
    });
  }

  try {
    console.log(`💾 Creating agent: ${agent.id} (${agent.name})`);
    const stmt = db.prepare(
      `INSERT INTO agents (id, code, name, user_id, status, zones, ci_serie, ci_numar, ci_eliberat_de, mijloc_transport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      agent.id,
      agent.code,
      agent.name,
      agent.user_id || null,
      agent.status || "active",
      JSON.stringify(agent.zones || []),
      agent.ci_serie || null,
      agent.ci_numar || null,
      agent.ci_eliberat_de || null,
      agent.mijloc_transport || null,
    );
    console.log(`✅ Agent created: ${agent.id}`);
    res.json({
      success: true,
      data: {
        ...agent,
        createdAt: new Date().toISOString(),
      },
      message: "Agent created successfully",
    });
  } catch (err) {
    console.error("❌ Error creating agent:", err.message);
    if (err.message.includes("UNIQUE constraint failed")) {
      res.status(400).json({
        success: false,
        error: "Agent code already exists",
      });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Update agent (PUT /api/agents/:id)
router.put("/:id", (req, res) => {
  const agent = req.body;

  if (!agent.code || !agent.name) {
    return res.status(400).json({
      success: false,
      error: "Code and name are required",
    });
  }

  try {
    console.log(`💾 Updating agent: ${req.params.id}`);
    const stmt = db.prepare(
      `UPDATE agents SET 
                code = ?, name = ?, user_id = ?, status = ?, zones = ?,
                ci_serie = ?, ci_numar = ?, ci_eliberat_de = ?, mijloc_transport = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`,
    );
    const result = stmt.run(
      agent.code,
      agent.name,
      agent.user_id || null,
      agent.status || "active",
      JSON.stringify(agent.zones || []),
      agent.ci_serie || null,
      agent.ci_numar || null,
      agent.ci_eliberat_de || null,
      agent.mijloc_transport || null,
      req.params.id,
    );
    if (result.changes === 0) {
      res.status(404).json({ success: false, error: "Agent not found" });
    } else {
      console.log(`✅ Agent updated: ${req.params.id}`);
      res.json({ success: true, message: "Agent updated successfully" });
    }
  } catch (err) {
    console.error("❌ Error updating agent:", err.message);
    if (err.message.includes("UNIQUE constraint failed")) {
      res.status(400).json({
        success: false,
        error: "Agent code already exists",
      });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Delete agent (DELETE /api/agents/:id)
router.delete("/:id", (req, res) => {
  try {
    console.log(`🗑️ Deleting agent: ${req.params.id}`);
    const stmt = db.prepare("DELETE FROM agents WHERE id = ?");
    const result = stmt.run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ success: false, error: "Agent not found" });
    } else {
      console.log(`✅ Agent deleted: ${req.params.id}`);
      res.json({ success: true, message: "Agent deleted successfully" });
    }
  } catch (err) {
    console.error("❌ Error deleting agent:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;