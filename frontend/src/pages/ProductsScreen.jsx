import React, { useState, useEffect } from "react";
import { Plus, Search, Edit2, Trash2, Save, X } from "lucide-react";

const ProductsScreen = ({
  products,
  setProducts,
  gestiuni,
  zones,
  priceZones,
  editingProduct,
  setEditingProduct,
  showMessage,
  createProduct,
  updateProduct,
  deleteProduct,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [localEditingProduct, setLocalEditingProduct] = useState(null);

  // Use zones if available, fallback to priceZones
  const displayZones = zones && zones.length > 0 ? zones : priceZones;

  // ✅ SYNC cu editingProduct
  useEffect(() => {
    setLocalEditingProduct(editingProduct);
  }, [editingProduct]);

  const filteredProducts = products.filter(
    (p) =>
      p.descriere.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.codArticolFurnizor.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleAddProduct = () => {
    const newProduct = {
      id: `product-${Date.now()}`,
      codArticolFurnizor: `${(products.length + 1).toString().padStart(8, "0")}`,
      codProductie: "",
      codBare: "",
      descriere: "",
      um: "BUC",
      gestiune: gestiuni[0]?.id || "",
      gramajKg: 0,
      cotaTVA: 11,
      prices: displayZones.reduce(
        (acc, zone) => ({ ...acc, [zone.id]: 0 }),
        {},
      ),
    };
    setEditingProduct(newProduct);
    setLocalEditingProduct(newProduct);
  };

  const handleSaveProduct = async () => {
    if (
      !localEditingProduct.descriere ||
      !localEditingProduct.codArticolFurnizor
    ) {
      showMessage("Completați denumirea și codul furnizor!", "error");
      return;
    }

    try {
      const existingIndex = products.findIndex(
        (p) => p.id === localEditingProduct.id,
      );

      if (existingIndex >= 0) {
        // Update existing product
        await updateProduct(localEditingProduct.id, localEditingProduct);
        const updatedProducts = [...products];
        updatedProducts[existingIndex] = localEditingProduct;
        setProducts(updatedProducts);
      } else {
        // Create new product
        await createProduct(localEditingProduct);
        setProducts([...products, localEditingProduct]);
      }

      setEditingProduct(null);
      setLocalEditingProduct(null);
      showMessage("Produs salvat cu succes!");
    } catch (error) {
      showMessage("Eroare la salvarea produsului!", "error");
      console.error(error);
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (confirm("Sigur doriți să ștergeți acest produs?")) {
      try {
        await deleteProduct(productId);
        const updatedProducts = products.filter((p) => p.id !== productId);
        setProducts(updatedProducts);
        showMessage("Produs șters cu succes!");
      } catch (error) {
        showMessage("Eroare la ștergerea produsului!", "error");
        console.error(error);
      }
    }
  };

  if (localEditingProduct) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-800">
            {products.find((p) => p.id === localEditingProduct.id)
              ? "Editare Produs"
              : "Produs Nou"}
          </h2>
          <button
            onClick={() => {
              setEditingProduct(null);
              setLocalEditingProduct(null);
            }}
            className="text-gray-600 hover:text-gray-800"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="bg-white p-6 rounded-lg shadow space-y-6">
          {/* CODURI */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Coduri</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cod Furnizor *
                </label>
                <input
                  type="text"
                  value={localEditingProduct.codArticolFurnizor}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      codArticolFurnizor: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="00000001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cod Producție
                </label>
                <input
                  type="text"
                  value={localEditingProduct.codProductie}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      codProductie: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="684811825476"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cod Bare
                </label>
                <input
                  type="text"
                  value={localEditingProduct.codBare}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      codBare: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder=""
                />
              </div>
            </div>
          </div>

          {/* DESCRIERE */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Descriere</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Denumire *
                </label>
                <input
                  type="text"
                  value={localEditingProduct.descriere}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      descriere: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="PAINE FELIAT 1. 5 KG"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  UM
                </label>
                <select
                  value={localEditingProduct.um}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      um: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus: ring-blue-500 focus: border-transparent"
                >
                  <option value="BUC">BUC</option>
                  <option value="KG">KG</option>
                  <option value="L">L</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gestiune
                </label>
                <select
                  value={localEditingProduct.gestiune}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      gestiune: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {gestiuni.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* CARACTERISTICI */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Caracteristici</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gramaj (kg/bucată)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={localEditingProduct.gramajKg}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      gramajKg: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus: ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="1.500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cotă TVA (%)
                </label>
                <select
                  value={localEditingProduct.cotaTVA}
                  onChange={(e) =>
                    setLocalEditingProduct({
                      ...localEditingProduct,
                      cotaTVA: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={11}>11% - Cota redusă</option>
                  <option value={21}>21% - Cota standard</option>
                  <option value={5}>5% - Cărți, ziare</option>
                  <option value={0}>0% - Scutit TVA</option>
                </select>
              </div>
            </div>
          </div>

          {/* PREȚURI PE ZONE */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">
              Prețuri pe Zone (fără TVA)
            </h3>
            <div className="grid grid-cols-1 sm: grid-cols-3 gap-4">
              {displayZones.map((zone) => (
                <div key={zone.id}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {zone.name}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={localEditingProduct.prices[zone.id] || 0}
                    onChange={(e) =>
                      setLocalEditingProduct({
                        ...localEditingProduct,
                        prices: {
                          ...localEditingProduct.prices,
                          [zone.id]: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="9.17"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* BUTOANE */}
          <div className="border-t pt-6 flex gap-3">
            <button
              onClick={handleSaveProduct}
              className="bg-amber-600 text-white px-8 py-2 rounded-lg hover:bg-amber-700 transition flex items-center gap-2 font-medium"
            >
              <Save className="w-5 h-5" />
              Salvează Produs
            </button>
            <button
              onClick={() => {
                setEditingProduct(null);
                setLocalEditingProduct(null);
              }}
              className="bg-gray-300 text-gray-700 px-8 py-2 rounded-lg hover:bg-gray-400 transition font-medium"
            >
              Anulează
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-800">
          Administrare Produse
        </h2>
        <button
          onClick={handleAddProduct}
          className="bg-amber-600 text-white px-6 py-2 rounded-lg hover:bg-amber-700 transition flex items-center gap-2 font-medium"
        >
          <Plus className="w-5 h-5" />
          Adaugă Produs
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Caută produs..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Cod
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Denumire
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  UM
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Gestiune
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Gramaj
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  TVA
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Preț A
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const gest = gestiuni.find((g) => g.id === product.gestiune);
                return (
                  <tr
                    key={product.id}
                    className="border-t border-gray-200 hover:bg-gray-50 transition"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-orange-600">
                      {product.codArticolFurnizor}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {product.descriere}
                    </td>
                    <td className="px-4 py-3 text-sm">{product.um}</td>
                    <td className="px-4 py-3 text-sm">{gest?.name}</td>
                    <td className="px-4 py-3 text-sm">
                      {product.gramajKg} kg
                    </td>
                    <td className="px-4 py-3 text-sm">{product.cotaTVA}%</td>
                    <td className="px-4 py-3 text-sm">
                      {product.prices["zona-a"]?.toFixed(2)} RON
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingProduct(product);
                            setLocalEditingProduct(product);
                          }}
                          className="text-blue-600 hover:text-blue-800 transition"
                          title="Editare"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="text-red-600 hover:text-red-800 transition"
                          title="Ștergere"
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
          {filteredProducts.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Nu au fost găsiți produse
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductsScreen;
