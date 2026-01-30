import React, { useState } from 'react';
import { Upload, Download, FileText, Users, Package, DollarSign, AlertCircle, CheckCircle, X } from 'lucide-react';
import Papa from 'papaparse';

const DataManagementScreen = ({ API_URL, showMessage, zones }) => {
  // State for clients import
  const [clientsFile, setClientsFile] = useState(null);
  const [clientsPreview, setClientsPreview] = useState(null);
  const [clientsLoading, setClientsLoading] = useState(false);

  // State for products import
  const [productsFile, setProductsFile] = useState(null);
  const [productsPreview, setProductsPreview] = useState(null);
  const [productsLoading, setProductsLoading] = useState(false);

  // State for prices update
  const [pricesFile, setPricesFile] = useState(null);
  const [pricesPreview, setPricesPreview] = useState(null);
  const [pricesLoading, setPricesLoading] = useState(false);

  // Get auth token from localStorage
  const getAuthToken = () => {
    const user = localStorage.getItem('currentUser');
    if (user) {
      const userData = JSON.parse(user);
      return userData.token;
    }
    return null;
  };

  // Handle clients CSV file selection
  const handleClientsFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setClientsFile(file);
      previewClientsCSV(file);
    }
  };

  // Preview clients CSV
  const previewClientsCSV = (file) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.data.length > 0) {
          // Send to backend for validation
          validateClientsImport(results.data);
        }
      },
      error: (error) => {
        showMessage(`Error parsing CSV: ${error.message}`, 'error');
      }
    });
  };

  // Validate clients import
  const validateClientsImport = async (data) => {
    setClientsLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      // Convert data to CSV string
      const csv = Papa.unparse(data);

      const response = await fetch(`${API_URL}/api/csv/import-clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ csvData: csv, preview: true })
      });

      const result = await response.json();

      if (response.ok) {
        setClientsPreview(result);
      } else {
        showMessage(result.error || 'Failed to validate clients', 'error');
        setClientsPreview(null);
      }
    } catch (error) {
      showMessage(`Error validating clients: ${error.message}`, 'error');
      setClientsPreview(null);
    } finally {
      setClientsLoading(false);
    }
  };

  // Import clients
  const importClients = async () => {
    if (!clientsFile) return;

    setClientsLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      Papa.parse(clientsFile, {
        header: true,
        complete: async (results) => {
          const csv = Papa.unparse(results.data);

          const response = await fetch(`${API_URL}/api/csv/import-clients`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ csvData: csv, preview: false })
          });

          const result = await response.json();

          if (response.ok) {
            showMessage(result.message, 'success');
            setClientsFile(null);
            setClientsPreview(null);
            // Refresh page to reload clients
            window.location.reload();
          } else {
            showMessage(result.error || 'Failed to import clients', 'error');
          }
          setClientsLoading(false);
        },
        error: (error) => {
          showMessage(`Error parsing CSV: ${error.message}`, 'error');
          setClientsLoading(false);
        }
      });
    } catch (error) {
      showMessage(`Error importing clients: ${error.message}`, 'error');
      setClientsLoading(false);
    }
  };

  // Handle products CSV file selection
  const handleProductsFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProductsFile(file);
      previewProductsCSV(file);
    }
  };

  // Preview products CSV
  const previewProductsCSV = (file) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.data.length > 0) {
          validateProductsImport(results.data);
        }
      },
      error: (error) => {
        showMessage(`Error parsing CSV: ${error.message}`, 'error');
      }
    });
  };

  // Validate products import
  const validateProductsImport = async (data) => {
    setProductsLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      const csv = Papa.unparse(data);

      const response = await fetch(`${API_URL}/api/csv/import-products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ csvData: csv, preview: true })
      });

      const result = await response.json();

      if (response.ok) {
        setProductsPreview(result);
      } else {
        showMessage(result.error || 'Failed to validate products', 'error');
        setProductsPreview(null);
      }
    } catch (error) {
      showMessage(`Error validating products: ${error.message}`, 'error');
      setProductsPreview(null);
    } finally {
      setProductsLoading(false);
    }
  };

  // Import products
  const importProducts = async () => {
    if (!productsFile) return;

    setProductsLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      Papa.parse(productsFile, {
        header: true,
        complete: async (results) => {
          const csv = Papa.unparse(results.data);

          const response = await fetch(`${API_URL}/api/csv/import-products`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ csvData: csv, preview: false })
          });

          const result = await response.json();

          if (response.ok) {
            showMessage(result.message, 'success');
            setProductsFile(null);
            setProductsPreview(null);
            window.location.reload();
          } else {
            showMessage(result.error || 'Failed to import products', 'error');
          }
          setProductsLoading(false);
        },
        error: (error) => {
          showMessage(`Error parsing CSV: ${error.message}`, 'error');
          setProductsLoading(false);
        }
      });
    } catch (error) {
      showMessage(`Error importing products: ${error.message}`, 'error');
      setProductsLoading(false);
    }
  };

  // Export products
  const exportProducts = async () => {
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      const response = await fetch(`${API_URL}/api/csv/export-products`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `products_export_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showMessage('Products exported successfully', 'success');
      } else {
        const result = await response.json();
        showMessage(result.error || 'Failed to export products', 'error');
      }
    } catch (error) {
      showMessage(`Error exporting products: ${error.message}`, 'error');
    }
  };

  // Handle prices CSV file selection
  const handlePricesFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPricesFile(file);
      previewPricesCSV(file);
    }
  };

  // Preview prices CSV
  const previewPricesCSV = (file) => {
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        if (results.data.length > 0) {
          validatePricesUpdate(results.data);
        }
      },
      error: (error) => {
        showMessage(`Error parsing CSV: ${error.message}`, 'error');
      }
    });
  };

  // Validate prices update
  const validatePricesUpdate = async (data) => {
    setPricesLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      const csv = Papa.unparse(data);

      const response = await fetch(`${API_URL}/api/csv/update-prices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ csvData: csv, preview: true })
      });

      const result = await response.json();

      if (response.ok) {
        setPricesPreview(result);
      } else {
        showMessage(result.error || 'Failed to validate prices', 'error');
        setPricesPreview(null);
      }
    } catch (error) {
      showMessage(`Error validating prices: ${error.message}`, 'error');
      setPricesPreview(null);
    } finally {
      setPricesLoading(false);
    }
  };

  // Update prices
  const updatePrices = async () => {
    if (!pricesFile) return;

    setPricesLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        showMessage('Please log in to use this feature', 'error');
        return;
      }

      Papa.parse(pricesFile, {
        header: true,
        complete: async (results) => {
          const csv = Papa.unparse(results.data);

          const response = await fetch(`${API_URL}/api/csv/update-prices`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ csvData: csv, preview: false })
          });

          const result = await response.json();

          if (response.ok) {
            showMessage(result.message, 'success');
            setPricesFile(null);
            setPricesPreview(null);
            window.location.reload();
          } else {
            showMessage(result.error || 'Failed to update prices', 'error');
          }
          setPricesLoading(false);
        },
        error: (error) => {
          showMessage(`Error parsing CSV: ${error.message}`, 'error');
          setPricesLoading(false);
        }
      });
    } catch (error) {
      showMessage(`Error updating prices: ${error.message}`, 'error');
      setPricesLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Gestiune Date în Masă</h1>
        <p className="text-gray-600 mb-6">
          Import/export date din fișiere CSV pentru clienți, produse și prețuri
        </p>

        {/* Import Clients Section */}
        <div className="mb-8 pb-8 border-b border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-800">Import Clienți</h2>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700 mb-2">
              <strong>Format CSV necesar:</strong> nume, cif, nrRegCom, codContabil, judet, localitate, strada, codPostal, telefon, email, banca, iban, agentId, priceZone, afiseazaKG
            </p>
            <p className="text-sm text-gray-600">
              <strong>Câmpuri obligatorii:</strong> nume, nrRegCom
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selectează fișier CSV
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleClientsFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>

            {clientsPreview && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800">Previzualizare Import</h3>
                  <button
                    onClick={() => {
                      setClientsFile(null);
                      setClientsPreview(null);
                    }}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-white p-3 rounded border border-gray-200">
                    <div className="text-sm text-gray-600">Total înregistrări</div>
                    <div className="text-2xl font-bold text-gray-800">{clientsPreview.total}</div>
                  </div>
                  <div className="bg-green-50 p-3 rounded border border-green-200">
                    <div className="text-sm text-green-600">Valide</div>
                    <div className="text-2xl font-bold text-green-700">{clientsPreview.valid}</div>
                  </div>
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                    <div className="text-sm text-yellow-600">Omise</div>
                    <div className="text-2xl font-bold text-yellow-700">{clientsPreview.skipped}</div>
                  </div>
                </div>

                {clientsPreview.errorMessages && clientsPreview.errorMessages.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                      <span className="font-semibold text-red-800">Erori de validare:</span>
                    </div>
                    <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                      {clientsPreview.errorMessages.slice(0, 10).map((error, idx) => (
                        <li key={idx}>{error}</li>
                      ))}
                      {clientsPreview.errorMessages.length > 10 && (
                        <li className="text-red-600">... și încă {clientsPreview.errorMessages.length - 10} erori</li>
                      )}
                    </ul>
                  </div>
                )}

                {clientsPreview.skippedRecords && clientsPreview.skippedRecords.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-yellow-600" />
                      <span className="font-semibold text-yellow-800">Înregistrări omise (duplicate):</span>
                    </div>
                    <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1">
                      {clientsPreview.skippedRecords.slice(0, 5).map((record, idx) => (
                        <li key={idx}>Rând {record.row}: {record.reason}</li>
                      ))}
                      {clientsPreview.skippedRecords.length > 5 && (
                        <li className="text-yellow-600">... și încă {clientsPreview.skippedRecords.length - 5}</li>
                      )}
                    </ul>
                  </div>
                )}

                {clientsPreview.valid > 0 && clientsPreview.errors === 0 && (
                  <button
                    onClick={importClients}
                    disabled={clientsLoading}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {clientsLoading ? (
                      'Se importă...'
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5" />
                        Confirmă importul ({clientsPreview.valid} clienți)
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Import Products Section */}
        <div className="mb-8 pb-8 border-b border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold text-gray-800">Import Produse</h2>
          </div>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700 mb-2">
              <strong>Format CSV necesar:</strong> codArticolFurnizor, codProductie, codBare, descriere, um, gestiune, gramajKg, cotaTVA, zone_1, zone_2, zone_3, ...
            </p>
            <p className="text-sm text-gray-600 mb-1">
              <strong>Câmpuri obligatorii:</strong> codArticolFurnizor, descriere
            </p>
            <p className="text-sm text-gray-600">
              <strong>Note:</strong> Coloanele de preț pentru zone trebuie să aibă formatul "zone_X" unde X este ID-ul zonei
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selectează fișier CSV
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleProductsFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
              />
            </div>

            {productsPreview && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800">Previzualizare Import</h3>
                  <button
                    onClick={() => {
                      setProductsFile(null);
                      setProductsPreview(null);
                    }}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-white p-3 rounded border border-gray-200">
                    <div className="text-sm text-gray-600">Total înregistrări</div>
                    <div className="text-2xl font-bold text-gray-800">{productsPreview.total}</div>
                  </div>
                  <div className="bg-green-50 p-3 rounded border border-green-200">
                    <div className="text-sm text-green-600">Valide</div>
                    <div className="text-2xl font-bold text-green-700">{productsPreview.valid}</div>
                  </div>
                  <div className="bg-red-50 p-3 rounded border border-red-200">
                    <div className="text-sm text-red-600">Erori</div>
                    <div className="text-2xl font-bold text-red-700">{productsPreview.errors}</div>
                  </div>
                </div>

                {productsPreview.errorMessages && productsPreview.errorMessages.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                      <span className="font-semibold text-red-800">Erori de validare:</span>
                    </div>
                    <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                      {productsPreview.errorMessages.slice(0, 10).map((error, idx) => (
                        <li key={idx}>{error}</li>
                      ))}
                      {productsPreview.errorMessages.length > 10 && (
                        <li className="text-red-600">... și încă {productsPreview.errorMessages.length - 10} erori</li>
                      )}
                    </ul>
                  </div>
                )}

                {productsPreview.valid > 0 && productsPreview.errors === 0 && (
                  <button
                    onClick={importProducts}
                    disabled={productsLoading}
                    className="w-full bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {productsLoading ? (
                      'Se importă...'
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5" />
                        Confirmă importul ({productsPreview.valid} produse)
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Export Products Section */}
        <div className="mb-8 pb-8 border-b border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Download className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-800">Export Produse</h2>
          </div>
          
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700">
              Exportă toate produsele cu prețurile pe zone în format CSV. Poți edita prețurile local și apoi le poți reîncărca folosind funcția de actualizare prețuri.
            </p>
          </div>

          <button
            onClick={exportProducts}
            className="bg-purple-600 text-white py-2 px-6 rounded hover:bg-purple-700 flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            Descarcă CSV cu produse și prețuri
          </button>
        </div>

        {/* Update Prices Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-6 h-6 text-orange-600" />
            <h2 className="text-xl font-semibold text-gray-800">Actualizare Prețuri</h2>
          </div>
          
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700 mb-2">
              Încarcă un fișier CSV exportat anterior cu prețurile actualizate. Se vor actualiza doar prețurile, celelalte informații despre produse rămân neschimbate.
            </p>
            <p className="text-sm text-gray-600">
              <strong>Format așteptat:</strong> Același format ca la export (codArticolFurnizor + coloane zone_X cu prețuri)
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selectează fișier CSV
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handlePricesFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
              />
            </div>

            {pricesPreview && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800">Previzualizare Actualizare</h3>
                  <button
                    onClick={() => {
                      setPricesFile(null);
                      setPricesPreview(null);
                    }}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-white p-3 rounded border border-gray-200">
                    <div className="text-sm text-gray-600">Total înregistrări</div>
                    <div className="text-2xl font-bold text-gray-800">{pricesPreview.total}</div>
                  </div>
                  <div className="bg-green-50 p-3 rounded border border-green-200">
                    <div className="text-sm text-green-600">Se vor actualiza</div>
                    <div className="text-2xl font-bold text-green-700">{pricesPreview.valid}</div>
                  </div>
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                    <div className="text-sm text-yellow-600">Negăsite</div>
                    <div className="text-2xl font-bold text-yellow-700">{pricesPreview.notFound}</div>
                  </div>
                </div>

                {pricesPreview.errorMessages && pricesPreview.errorMessages.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                      <span className="font-semibold text-red-800">Erori de validare:</span>
                    </div>
                    <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                      {pricesPreview.errorMessages.slice(0, 10).map((error, idx) => (
                        <li key={idx}>{error}</li>
                      ))}
                      {pricesPreview.errorMessages.length > 10 && (
                        <li className="text-red-600">... și încă {pricesPreview.errorMessages.length - 10} erori</li>
                      )}
                    </ul>
                  </div>
                )}

                {pricesPreview.notFoundRecords && pricesPreview.notFoundRecords.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-yellow-600" />
                      <span className="font-semibold text-yellow-800">Produse negăsite:</span>
                    </div>
                    <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1">
                      {pricesPreview.notFoundRecords.slice(0, 5).map((record, idx) => (
                        <li key={idx}>Rând {record.row}: {record.codArticolFurnizor}</li>
                      ))}
                      {pricesPreview.notFoundRecords.length > 5 && (
                        <li className="text-yellow-600">... și încă {pricesPreview.notFoundRecords.length - 5}</li>
                      )}
                    </ul>
                  </div>
                )}

                {pricesPreview.valid > 0 && pricesPreview.errors === 0 && (
                  <button
                    onClick={updatePrices}
                    disabled={pricesLoading}
                    className="w-full bg-orange-600 text-white py-2 px-4 rounded hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {pricesLoading ? (
                      'Se actualizează...'
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5" />
                        Confirmă actualizarea ({pricesPreview.valid} produse)
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataManagementScreen;
