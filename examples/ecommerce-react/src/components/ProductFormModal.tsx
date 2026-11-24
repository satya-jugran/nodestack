import React, { useState, useEffect } from 'react';
import { Product, Category } from '../lib/types';
import { client, getProductImageUrl } from '../lib/nodestack';
import {
  X,
  Package,
  DollarSign,
  Layers,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Trash2,
  Sparkles,
  Upload,
} from 'lucide-react';

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null; // null = Create, object = Edit
  categories: Category[];
  onSuccess: (product: Product, isNew: boolean) => void;
  onDelete?: (productId: string) => void;
}

const PRESET_ICONS = [
  { name: 'Headphones', icon: '🎧', color: '#6366f1', keywords: ['headphone', 'audio', 'sound', 'anc', 'earbud'] },
  { name: 'Backpack', icon: '🎒', color: '#0ea5e9', keywords: ['backpack', 'bag', 'travel', 'pack', 'tote', 'duffel'] },
  { name: 'Footwear', icon: '👟', color: '#10b981', keywords: ['shoe', 'footwear', 'trail', 'sneaker', 'runner', 'running', 'boot'] },
  { name: 'Timepiece', icon: '⌚', color: '#f59e0b', keywords: ['watch', 'timepiece', 'chrono', 'solar', 'clock'] },
  { name: 'Keyboard', icon: '⌨️', color: '#8b5cf6', keywords: ['keyboard', 'keycap', 'switch', 'mechanical'] },
  { name: 'Camera', icon: '📷', color: '#ec4899', keywords: ['camera', 'cinema', 'lens', 'photo', 'vlog', 'sensor'] },
  { name: 'Coffee', icon: '☕', color: '#78350f', keywords: ['coffee', 'dripper', 'brew', 'espresso', 'mug', 'cup', 'pour-over'] },
  { name: 'Wellness', icon: '🌿', color: '#14b8a6', keywords: ['wellness', 'serum', 'oil', 'botanical', 'candle', 'plant', 'perfume', 'facial', 'skin', 'amber'] },
];

export function findMatchingPreset(product: Product): (typeof PRESET_ICONS)[number] {
  const target = `${product.name || ''} ${product.slug || ''} ${product.image || ''} ${product.description || ''}`.toLowerCase();
  for (const preset of PRESET_ICONS) {
    if (preset.keywords.some((kw) => target.includes(kw))) {
      return preset;
    }
  }
  return PRESET_ICONS[0];
}

function generatePresetSvgXml(icon: string, label: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="40" fill="url(#bg)"/>
  <circle cx="200" cy="180" r="110" fill="${color}" fill-opacity="0.12"/>
  <text x="200" y="210" font-size="80" text-anchor="middle" dominant-baseline="middle">${icon}</text>
  <text x="200" y="320" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#334155" text-anchor="middle">${label}</text>
</svg>`;
}

function generatePresetSvgFile(icon: string, label: string, color: string, filename: string): File {
  const xml = generatePresetSvgXml(icon, label, color);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  return new File([blob], filename, { type: 'image/svg+xml' });
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  isOpen,
  onClose,
  product,
  categories,
  onSuccess,
  onDelete,
}) => {
  const isEdit = Boolean(product);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('49.99');
  const [stock, setStock] = useState('25');
  const [description, setDescription] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [status, setStatus] = useState<'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order'>('in_stock');

  // Image handling via Multipart FormData: 'keep' (preserve existing stored file on edit), 'preset', or 'file'
  const [imageMode, setImageMode] = useState<'keep' | 'preset' | 'file'>('preset');
  const [selectedPreset, setSelectedPreset] = useState(PRESET_ICONS[0]);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customFilePreview, setCustomFilePreview] = useState<string | null>(null);
  const [hasChangedImage, setHasChangedImage] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form when product changes
  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setSlug(product.slug || '');
      setCategory(product.category || (categories[0]?.id || ''));
      setPrice(product.price ? product.price.toString() : '0');
      setStock(product.stock !== undefined ? product.stock.toString() : '0');
      setDescription(product.description || '');
      setIsFeatured(Boolean(product.isFeatured));
      setStatus(product.status || 'in_stock');
      const matched = findMatchingPreset(product);
      setSelectedPreset(matched);
      setImageMode('keep');
      setCustomFile(null);
      setCustomFilePreview(null);
      setHasChangedImage(false); // Retain existing image by default on edit
    } else {
      // Defaults for create
      setName('');
      setSlug('');
      setCategory(categories[0]?.id || '');
      setPrice('49.99');
      setStock('35');
      setDescription('');
      setIsFeatured(false);
      setStatus('in_stock');
      setImageMode('preset');
      setSelectedPreset(PRESET_ICONS[0]);
      setCustomFile(null);
      setCustomFilePreview(null);
      setHasChangedImage(true); // New product requires an image file
    }
    setError(null);
  }, [product, categories, isOpen]);

  if (!isOpen) return null;

  // Auto-generate slug when name changes (for new products)
  const handleNameChange = (val: string) => {
    setName(val);
    if (!isEdit) {
      const generatedSlug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      setSlug(generatedSlug);
    }
  };

  // Auto-sync status when stock changes
  const handleStockChange = (val: string) => {
    setStock(val);
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      if (num <= 0) setStatus('out_of_stock');
      else if (num <= 5) setStatus('low_stock');
      else setStatus('in_stock');
    }
  };

  const handleCustomFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setCustomFile(file);
      setCustomFilePreview(URL.createObjectURL(file));
      setHasChangedImage(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError('Price must be a valid positive number.');
      return;
    }

    const stockNum = parseInt(stock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      setError('Stock must be a non-negative integer.');
      return;
    }

    const computedSlug = slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const finalCategory = category || categories[0]?.id || 'cat_electronics';

    // Build Multipart FormData payload to satisfy NodeStack's file upload contract
    const formData = new FormData();
    formData.append('name', name.trim());
    formData.append('slug', computedSlug);
    formData.append('category', finalCategory);
    formData.append('price', String(priceNum));
    formData.append('stock', String(stockNum));
    formData.append('description', description.trim());
    formData.append('status', status);
    formData.append('isFeatured', isFeatured ? 'true' : 'false');

    // Attach File object when creating a new product or when user explicitly changes image
    if (!isEdit || (imageMode !== 'keep' && hasChangedImage)) {
      let fileToUpload: File | null = null;

      if (imageMode === 'file' && customFile) {
        fileToUpload = customFile;
      } else if (imageMode === 'preset') {
        // Generate SVG File from chosen vector preset
        const filename = `${computedSlug}_hero.svg`;
        fileToUpload = generatePresetSvgFile(
          selectedPreset.icon,
          name || selectedPreset.name,
          selectedPreset.color,
          filename
        );
      }

      if (fileToUpload) {
        formData.append('image', fileToUpload);
      }
    }

    setIsLoading(true);
    try {
      if (isEdit && product) {
        const res = await client.collection('products').update(product.id, formData);
        onSuccess(res as unknown as Product, false);
      } else {
        const res = await client.collection('products').create(formData);
        onSuccess(res as unknown as Product, true);
      }
      onClose();
    } catch (err: any) {
      console.error('Failed to save product:', err);
      setError(err?.message || 'Failed to save product. Ensure you are signed in as Store Manager.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!product || !onDelete) return;
    if (!window.confirm(`Are you sure you want to permanently delete "${product.name}"?`)) return;

    setIsLoading(true);
    try {
      await client.collection('products').delete(product.id);
      onDelete(product.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete product.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full my-8 overflow-hidden relative">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                {isEdit ? `Edit Product: ${product?.name}` : 'Create New Product'}
              </h3>
              <p className="text-xs text-slate-400">
                {isEdit ? 'Update product information and stock level' : 'Add a new item to the live store catalog'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="m-6 mb-0 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          {/* Row 1: Name & Slug */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Product Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Minimalist Mechanical Keyboard"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                URL Slug / SKU <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. minimalist-mechanical-keyboard"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 font-mono outline-none transition-all"
              />
            </div>
          </div>

          {/* Row 2: Category & Price & Stock */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Category <span className="text-rose-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none font-medium text-slate-800"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Price ($ USD) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 font-bold outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Initial Stock <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                required
                value={stock}
                onChange={(e) => handleStockChange(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 font-bold outline-none"
              />
            </div>
          </div>

          {/* Row 3: Status & Featured */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Stock Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none font-medium text-slate-800"
              >
                <option value="in_stock">In Stock (&gt; 5)</option>
                <option value="low_stock">Low Stock (1 - 5)</option>
                <option value="out_of_stock">Out of Stock (0)</option>
                <option value="pre_order">Pre-Order</option>
              </select>
            </div>

            <div className="pt-5 flex items-center">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                />
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Mark as Featured Product
                </span>
              </label>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Description
            </label>
            <textarea
              rows={3}
              placeholder="Detailed product highlights, specifications, and design notes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all resize-none"
            />
          </div>

          {/* Image Selection - NodeStack File Field Upload */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-brand-600" />
                Product Image File Upload <span className="text-rose-500">*</span>
              </span>
              <div className="flex items-center bg-slate-200/60 p-0.5 rounded-lg text-[11px] font-semibold">
                {isEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageMode('keep');
                      setHasChangedImage(false);
                    }}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      imageMode === 'keep' ? 'bg-white text-slate-800 shadow-xs font-bold' : 'text-slate-500'
                    }`}
                  >
                    Keep Artwork
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setImageMode('preset');
                    if (isEdit) setHasChangedImage(true);
                  }}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    imageMode === 'preset' ? 'bg-white text-slate-800 shadow-xs font-bold' : 'text-slate-500'
                  }`}
                >
                  Vector SVG Presets
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImageMode('file');
                    if (isEdit) setHasChangedImage(true);
                  }}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    imageMode === 'file' ? 'bg-white text-slate-800 shadow-xs font-bold' : 'text-slate-500'
                  }`}
                >
                  Upload Local File
                </button>
              </div>
            </div>

            {/* Current product image info on Edit */}
            {isEdit && product && imageMode === 'keep' && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-emerald-200 bg-emerald-50/20 text-xs">
                <img
                  src={getProductImageUrl(product)}
                  alt={product.name}
                  className="w-12 h-12 object-contain rounded-lg bg-white p-1 border border-slate-200 shadow-xs"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-800 truncate">Stored File: {product.image || 'None'}</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      ✓ Preserving Original Artwork
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Original seeded image file will be retained. Click "Vector SVG Presets" or "Upload Local File" above to replace it.
                  </p>
                </div>
              </div>
            )}

            {imageMode === 'preset' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 pt-1">
                  {PRESET_ICONS.map((p) => {
                    const isSelected = selectedPreset.name === p.name;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => {
                          setSelectedPreset(p);
                          setHasChangedImage(true);
                        }}
                        className={`p-2 rounded-xl flex flex-col items-center justify-center gap-1 border transition-all ${
                          isSelected
                            ? 'border-brand-600 bg-brand-50 text-brand-700 shadow-xs scale-105'
                            : 'border-slate-200 bg-white hover:bg-slate-100/80 text-slate-600'
                        }`}
                      >
                        <span className="text-xl">{p.icon}</span>
                        <span className="text-[10px] font-bold truncate max-w-full">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500">
                  Generates a clean vector <code className="text-brand-700 bg-brand-50 px-1 py-0.5 rounded">.svg</code> File uploaded as multipart to NodeStack.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="border-2 border-dashed border-slate-200 hover:border-brand-500 rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white transition-colors">
                  <Upload className="w-5 h-5 text-brand-600" />
                  <span className="text-xs font-bold text-slate-700">
                    {customFile ? customFile.name : 'Choose an image file (PNG, JPG, SVG, WebP)'}
                  </span>
                  <span className="text-[11px] text-slate-400">Click to browse or replace file</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleCustomFileChange}
                    className="hidden"
                  />
                </label>
                {customFilePreview && (
                  <div className="flex items-center gap-2 pt-1">
                    <img
                      src={customFilePreview}
                      alt="Preview"
                      className="w-12 h-12 object-contain rounded-lg border border-slate-200 p-1 bg-white"
                    />
                    <span className="text-xs text-slate-600 font-medium truncate">
                      Ready to upload: {customFile?.name} ({((customFile?.size || 0) / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions Bar */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            {isEdit && onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isLoading}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 shadow-md shadow-brand-500/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{isEdit ? 'Save Changes' : 'Create Product'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
