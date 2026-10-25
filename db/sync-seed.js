const fs = require('fs');
const path = require('path');
const db = require('./database');

const SEED_DATA_PATH = path.join(__dirname, 'seed-data.js');

function escapeJsString(str) {
  return "'" + String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t') + "'";
}

function cleanProduct(p) {
  const obj = {
    id: p.id,
    category: p.category,
    name: p.name,
    fullName: p.fullName || p.name
  };

  if (p.variety) obj.variety = p.variety;

  if (p.category === 'oil') {
    if (p.volume) obj.volume = p.volume;
    if (p.container) obj.container = p.container;
    if (p.special !== undefined && p.special !== null) obj.special = p.special;
    if (p.type) obj.type = p.type;
    if (p.region) obj.region = p.region;
    if (p.denomination) obj.denomination = p.denomination;
  } else {
    if (p.region) obj.region = p.region;
    if (p.denomination) obj.denomination = p.denomination;
    if (p.type) obj.type = p.type;
    if (p.volume) obj.volume = p.volume;
    if (p.container) obj.container = p.container;
    if (p.special) obj.special = p.special;
  }

  obj.description = p.description || '';

  if (typeof p.tags === 'string') {
    try {
      obj.tags = JSON.parse(p.tags || '[]');
    } catch {
      obj.tags = [];
    }
  } else if (Array.isArray(p.tags)) {
    obj.tags = p.tags;
  } else {
    obj.tags = [];
  }

  obj.price = typeof p.price === 'number' ? p.price : (parseFloat(p.price) || 0);

  if (p.icon) obj.icon = p.icon;
  if (p.color) obj.color = p.color;
  if (p.image !== undefined && p.image !== null) obj.image = p.image;
  obj.in_stock = p.in_stock ? 1 : 0;
  if (p.stock_quantity !== undefined && p.stock_quantity !== null) {
    obj.stock_quantity = parseInt(p.stock_quantity, 10) || 0;
  }
  if (p.reorder_level !== undefined && p.reorder_level !== null) {
    obj.reorder_level = parseInt(p.reorder_level, 10) || 15;
  }

  return obj;
}

function formatProduct(p) {
  const lines = ['  {'];
  const entries = Object.entries(p);
  entries.forEach(([k, v], idx) => {
    const comma = idx < entries.length - 1 ? ',' : '';
    let valStr;
    if (k === 'tags' && Array.isArray(v)) {
      valStr = '[' + v.map(t => escapeJsString(t)).join(', ') + ']';
    } else if (typeof v === 'string') {
      valStr = escapeJsString(v);
    } else {
      valStr = JSON.stringify(v);
    }
    lines.push('    ' + k + ': ' + valStr + comma);
  });
  lines.push('  }');
  return lines.join('\n');
}

function generateSeedDataContent(products) {
  const cleaned = products.map(cleanProduct);
  const wines = cleaned.filter(p => p.category === 'wine');
  const oils = cleaned.filter(p => p.category === 'oil');
  const others = cleaned.filter(p => p.category !== 'wine' && p.category !== 'oil');

  const sections = [];
  if (wines.length > 0) {
    sections.push('  // ==================== WINES ====================\n' + wines.map(formatProduct).join(',\n'));
  }
  if (oils.length > 0) {
    sections.push('  // ==================== OLIVE OILS (BUENSALUD) ====================\n' + oils.map(formatProduct).join(',\n'));
  }
  if (others.length > 0) {
    sections.push('  // ==================== OTHER PRODUCTS ====================\n' + others.map(formatProduct).join(',\n'));
  }

  return `const initialProducts = [\n${sections.join(',\n')}\n];\n\nmodule.exports = { initialProducts };\n`;
}

function syncSeedDataFile() {
  const products = db.prepare(`
    SELECT * FROM products
    ORDER BY
      CASE WHEN category = 'wine' THEN 1 ELSE 2 END,
      rowid ASC
  `).all();

  const content = generateSeedDataContent(products);
  fs.writeFileSync(SEED_DATA_PATH, content, 'utf8');

  // Clear require cache if seed-data was loaded previously
  try {
    delete require.cache[require.resolve('./seed-data')];
  } catch (e) {
    // ignore
  }

  console.log(`[seed-sync] Successfully synchronized seed-data.js with ${products.length} products from database.`);
  return { success: true, count: products.length, path: SEED_DATA_PATH };
}

module.exports = {
  syncSeedDataFile,
  generateSeedDataContent,
  cleanProduct
};
