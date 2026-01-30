const express = require('express');
const router = express.Router();
const db = require('../database');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { requireAdmin } = require('../middleware/auth');
const { initializeClientProducts } = require('./client-products');

// Apply admin middleware to all routes
router.use(requireAdmin);

/**
 * POST /api/csv/import-clients
 * Import clients from CSV file
 * Body: { csvData: string, preview: boolean }
 */
router.post('/import-clients', async (req, res) => {
    try {
        const { csvData, preview = false } = req.body;

        if (!csvData) {
            return res.status(400).json({ error: 'No CSV data provided' });
        }

        // Parse CSV
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        if (records.length === 0) {
            return res.status(400).json({ error: 'CSV file is empty' });
        }

        // Validate required fields and collect errors
        const errors = [];
        const validRecords = [];
        const skippedRecords = [];

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const rowNum = i + 2; // +2 for header row and 0-indexing

            // Check required fields
            if (!record.nume) {
                errors.push(`Row ${rowNum}: 'nume' is required`);
                continue;
            }
            if (!record.nrRegCom) {
                errors.push(`Row ${rowNum}: 'nrRegCom' is required`);
                continue;
            }

            // Check for duplicates in database
            const existing = db.prepare(
                'SELECT id FROM clients WHERE cif = ? OR nrRegCom = ?'
            ).get(record.cif || '', record.nrRegCom);

            if (existing) {
                skippedRecords.push({
                    row: rowNum,
                    reason: 'Duplicate CIF or nrRegCom',
                    data: record
                });
                continue;
            }

            validRecords.push({
                ...record,
                rowNum
            });
        }

        // If preview mode, return validation results
        if (preview) {
            return res.json({
                success: true,
                preview: true,
                total: records.length,
                valid: validRecords.length,
                skipped: skippedRecords.length,
                errors: errors.length,
                validRecords,
                skippedRecords,
                errorMessages: errors
            });
        }

        // If there are validation errors, don't proceed with import
        if (errors.length > 0) {
            return res.status(400).json({
                error: 'Validation errors found',
                errors,
                skipped: skippedRecords
            });
        }

        // Import valid records
        const insertStmt = db.prepare(`
            INSERT INTO clients (
                id, nume, cif, nrRegCom, codContabil, judet, localitate, 
                strada, codPostal, telefon, email, banca, iban, agentId, 
                priceZone, afiseazaKG, productCodes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const importClients = db.transaction((records) => {
            const imported = [];
            for (const record of records) {
                const id = `client-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                insertStmt.run(
                    id,
                    record.nume,
                    record.cif || null,
                    record.nrRegCom,
                    record.codContabil || null,
                    record.judet || null,
                    record.localitate || null,
                    record.strada || null,
                    record.codPostal || null,
                    record.telefon || null,
                    record.email || null,
                    record.banca || null,
                    record.iban || null,
                    record.agentId || null,
                    record.priceZone || null,
                    record.afiseazaKG === 'true' || record.afiseazaKG === '1' ? 1 : 0,
                    '{}'
                );

                // Initialize client products
                initializeClientProducts(id);

                imported.push({ id, ...record });
            }
            return imported;
        });

        const imported = importClients(validRecords);

        res.json({
            success: true,
            imported: imported.length,
            skipped: skippedRecords.length,
            skippedRecords,
            message: `Successfully imported ${imported.length} clients${skippedRecords.length > 0 ? `, skipped ${skippedRecords.length} duplicates` : ''}`
        });

    } catch (err) {
        console.error('Error importing clients:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/csv/import-products
 * Import products with zone-based pricing from CSV
 * Body: { csvData: string, preview: boolean }
 */
router.post('/import-products', async (req, res) => {
    try {
        const { csvData, preview = false } = req.body;

        if (!csvData) {
            return res.status(400).json({ error: 'No CSV data provided' });
        }

        // Parse CSV
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        if (records.length === 0) {
            return res.status(400).json({ error: 'CSV file is empty' });
        }

        // Get all zones from database and create code-to-id mapping
        const zones = db.prepare('SELECT id, code FROM zones').all();
        const zoneIds = zones.map(z => z.id);
        const zoneCodeToId = {};
        for (const zone of zones) {
            zoneCodeToId[zone.code] = zone.id;
        }

        // Validate records and build products with prices
        const errors = [];
        const validRecords = [];

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const rowNum = i + 2; // +2 for header row and 0-indexing

            // Check required fields
            if (!record.codArticolFurnizor) {
                errors.push(`Row ${rowNum}: 'codArticolFurnizor' is required`);
                continue;
            }
            if (!record.descriere) {
                errors.push(`Row ${rowNum}: 'descriere' is required`);
                continue;
            }

            // Extract zone prices from dynamic columns
            // Support both zone codes (Z1, Z2, Z3) and zone IDs (zone_1, zone_2, etc.)
            const prices = {};
            let hasInvalidPrice = false;
            
            for (const key of Object.keys(record)) {
                let zoneId = null;
                
                // Check if it's a zone ID (starts with zone_)
                if (key.startsWith('zone_')) {
                    zoneId = key;
                }
                // Check if it's a zone code (Z1, Z2, Z3, etc.)
                else if (zoneCodeToId[key]) {
                    zoneId = zoneCodeToId[key];
                }
                
                if (zoneId) {
                    const priceValue = record[key];
                    
                    if (priceValue && priceValue.trim() !== '') {
                        const price = parseFloat(priceValue);
                        if (isNaN(price)) {
                            errors.push(`Row ${rowNum}: Invalid price for ${key}: '${priceValue}'`);
                            hasInvalidPrice = true;
                        } else {
                            prices[zoneId] = price;
                        }
                    }
                } else if (key !== 'codArticolFurnizor' && key !== 'codProductie' && key !== 'codBare' && 
                          key !== 'descriere' && key !== 'um' && key !== 'gestiune' && 
                          key !== 'gramajKg' && key !== 'cotaTVA') {
                    // Check if this looks like it could be a zone column but wasn't found
                    if (key.match(/^Z\d+$/) || key.startsWith('zone')) {
                        errors.push(`Row ${rowNum}: Zone code or ID '${key}' not found in database`);
                        hasInvalidPrice = true;
                    }
                }
            }

            if (hasInvalidPrice) {
                continue;
            }

            // Parse cotaTVA if present
            let cotaTVA = null;
            if (record.cotaTVA) {
                cotaTVA = parseInt(record.cotaTVA);
                if (isNaN(cotaTVA)) {
                    errors.push(`Row ${rowNum}: Invalid cotaTVA: '${record.cotaTVA}'`);
                    continue;
                }
            }

            // Parse gramajKg if present
            let gramajKg = null;
            if (record.gramajKg) {
                gramajKg = parseFloat(record.gramajKg);
                if (isNaN(gramajKg)) {
                    errors.push(`Row ${rowNum}: Invalid gramajKg: '${record.gramajKg}'`);
                    continue;
                }
            }

            validRecords.push({
                codArticolFurnizor: record.codArticolFurnizor,
                codProductie: record.codProductie || null,
                codBare: record.codBare || null,
                descriere: record.descriere,
                um: record.um || null,
                gestiune: record.gestiune || null,
                gramajKg,
                cotaTVA,
                prices,
                rowNum
            });
        }

        // If preview mode, return validation results
        if (preview) {
            return res.json({
                success: true,
                preview: true,
                total: records.length,
                valid: validRecords.length,
                errors: errors.length,
                validRecords,
                errorMessages: errors
            });
        }

        // If there are validation errors, don't proceed
        if (errors.length > 0) {
            return res.status(400).json({
                error: 'Validation errors found',
                errors
            });
        }

        // Import/update products
        const upsertStmt = db.prepare(`
            INSERT INTO products (
                id, codArticolFurnizor, codProductie, codBare, descriere,
                um, gestiune, gramajKg, cotaTVA, prices
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                codProductie = excluded.codProductie,
                codBare = excluded.codBare,
                descriere = excluded.descriere,
                um = excluded.um,
                gestiune = excluded.gestiune,
                gramajKg = excluded.gramajKg,
                cotaTVA = excluded.cotaTVA,
                prices = excluded.prices,
                updatedAt = CURRENT_TIMESTAMP
        `);

        const checkExistingStmt = db.prepare(
            'SELECT id FROM products WHERE codArticolFurnizor = ?'
        );

        const importProducts = db.transaction((records) => {
            let inserted = 0;
            let updated = 0;

            for (const record of records) {
                const existing = checkExistingStmt.get(record.codArticolFurnizor);
                const id = existing ? existing.id : `product-${Date.now()}-${Math.random().toString(36).substring(7)}`;

                upsertStmt.run(
                    id,
                    record.codArticolFurnizor,
                    record.codProductie,
                    record.codBare,
                    record.descriere,
                    record.um,
                    record.gestiune,
                    record.gramajKg,
                    record.cotaTVA,
                    JSON.stringify(record.prices)
                );

                if (existing) {
                    updated++;
                } else {
                    inserted++;
                }
            }

            return { inserted, updated };
        });

        const result = importProducts(validRecords);

        res.json({
            success: true,
            inserted: result.inserted,
            updated: result.updated,
            total: result.inserted + result.updated,
            message: `Successfully processed ${result.inserted + result.updated} products (${result.inserted} new, ${result.updated} updated)`
        });

    } catch (err) {
        console.error('Error importing products:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/csv/export-products
 * Export all products with zone-based pricing to CSV
 */
router.get('/export-products', async (req, res) => {
    try {
        // Get all products
        const products = db.prepare('SELECT * FROM products ORDER BY descriere').all();

        if (products.length === 0) {
            return res.status(404).json({ error: 'No products found' });
        }

        // Get all zones to determine columns (fetch both id and code)
        const zones = db.prepare('SELECT id, code FROM zones ORDER BY code').all();
        
        // Build CSV data
        const csvRecords = products.map(product => {
            const record = {
                codArticolFurnizor: product.codArticolFurnizor || '',
                codProductie: product.codProductie || '',
                codBare: product.codBare || '',
                descriere: product.descriere || '',
                um: product.um || '',
                gestiune: product.gestiune || '',
                gramajKg: product.gramajKg || '',
                cotaTVA: product.cotaTVA || ''
            };

            // Parse prices JSON and add zone columns
            const prices = product.prices ? JSON.parse(product.prices) : {};
            
            // Add all zone columns with prices - use zone.code as column name
            for (const zone of zones) {
                record[zone.code] = prices[zone.id] || '';
            }

            return record;
        });

        // Convert to CSV
        const csv = stringify(csvRecords, {
            header: true,
            quoted: true
        });

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=products_export.csv');
        res.send(csv);

    } catch (err) {
        console.error('Error exporting products:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/csv/update-prices
 * Update product prices from CSV file
 * Body: { csvData: string, preview: boolean }
 */
router.post('/update-prices', async (req, res) => {
    try {
        const { csvData, preview = false } = req.body;

        if (!csvData) {
            return res.status(400).json({ error: 'No CSV data provided' });
        }

        // Parse CSV
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        if (records.length === 0) {
            return res.status(400).json({ error: 'CSV file is empty' });
        }

        // Get all zones from database and create code-to-id mapping
        const zones = db.prepare('SELECT id, code FROM zones').all();
        const zoneCodeToId = {};
        for (const zone of zones) {
            zoneCodeToId[zone.code] = zone.id;
        }

        // Validate records and extract price updates
        const errors = [];
        const validRecords = [];
        const notFoundRecords = [];

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const rowNum = i + 2;

            if (!record.codArticolFurnizor) {
                errors.push(`Row ${rowNum}: 'codArticolFurnizor' is required`);
                continue;
            }

            // Check if product exists
            const product = db.prepare(
                'SELECT id, prices FROM products WHERE codArticolFurnizor = ?'
            ).get(record.codArticolFurnizor);

            if (!product) {
                notFoundRecords.push({
                    row: rowNum,
                    codArticolFurnizor: record.codArticolFurnizor
                });
                continue;
            }

            // Extract zone prices - support both zone codes and zone IDs
            const prices = {};
            let hasInvalidPrice = false;

            for (const key of Object.keys(record)) {
                let zoneId = null;
                
                // Check if it's a zone ID (starts with zone_)
                if (key.startsWith('zone_')) {
                    zoneId = key;
                }
                // Check if it's a zone code (Z1, Z2, Z3, etc.)
                else if (zoneCodeToId[key]) {
                    zoneId = zoneCodeToId[key];
                }
                
                if (zoneId) {
                    const priceValue = record[key];
                    
                    if (priceValue && priceValue.trim() !== '') {
                        const price = parseFloat(priceValue);
                        if (isNaN(price)) {
                            errors.push(`Row ${rowNum}: Invalid price for ${key}: '${priceValue}'`);
                            hasInvalidPrice = true;
                        } else {
                            prices[zoneId] = price;
                        }
                    }
                } else if (key !== 'codArticolFurnizor' && key !== 'codProductie' && key !== 'codBare' && 
                          key !== 'descriere' && key !== 'um' && key !== 'gestiune' && 
                          key !== 'gramajKg' && key !== 'cotaTVA') {
                    // Check if this looks like it could be a zone column but wasn't found
                    if (key.match(/^Z\d+$/) || key.startsWith('zone')) {
                        errors.push(`Row ${rowNum}: Zone code or ID '${key}' not found in database`);
                        hasInvalidPrice = true;
                    }
                }
            }

            if (hasInvalidPrice) {
                continue;
            }

            // Merge with existing prices
            const existingPrices = product.prices ? JSON.parse(product.prices) : {};
            const mergedPrices = { ...existingPrices, ...prices };

            validRecords.push({
                productId: product.id,
                codArticolFurnizor: record.codArticolFurnizor,
                prices: mergedPrices,
                rowNum
            });
        }

        // If preview mode, return validation results
        if (preview) {
            return res.json({
                success: true,
                preview: true,
                total: records.length,
                valid: validRecords.length,
                notFound: notFoundRecords.length,
                errors: errors.length,
                validRecords,
                notFoundRecords,
                errorMessages: errors
            });
        }

        // If there are validation errors, don't proceed
        if (errors.length > 0) {
            return res.status(400).json({
                error: 'Validation errors found',
                errors,
                notFound: notFoundRecords
            });
        }

        // Update prices
        const updateStmt = db.prepare(
            'UPDATE products SET prices = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?'
        );

        const updatePrices = db.transaction((records) => {
            for (const record of records) {
                updateStmt.run(JSON.stringify(record.prices), record.productId);
            }
            return records.length;
        });

        const updated = updatePrices(validRecords);

        res.json({
            success: true,
            updated,
            notFound: notFoundRecords.length,
            notFoundRecords,
            message: `Successfully updated prices for ${updated} products${notFoundRecords.length > 0 ? `, ${notFoundRecords.length} products not found` : ''}`
        });

    } catch (err) {
        console.error('Error updating prices:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
