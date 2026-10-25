const fs = require('fs');
const path = require('path');

const SEED_FILE_PATH = path.join(__dirname, 'seed-data.js');

/**
 * Natural sort comparator so w2 comes before w10
 */
function naturalSort(a, b) {
  return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Convert string to single-quoted JS literal
 */
function toJsString(str) {
  if (str === null || str === undefined) return "''";
  const escaped = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${escaped}'`;
}

/**
 * Format a database product row into clean JavaScript object code
 */
function formatProduct(p) {
  const isWine = p.category === 'wine';
  const lines = [];
  lines.push('  {');
  lines.push(`    id: ${toJsString(p.id)},`);
  lines.push(`    category: ${toJsString(p.category)},`);
  lines.push(`    name: ${toJsString(p.name)},`);
  lines.push(`    fullName: ${toJsString(p.fullName || p.name)},`);
  if (p.variety) lines.push(`    variety: ${toJsString(p.variety)},`);
  if (p.region) lines.push(`    region: ${toJsString(p.region)},`);
  if (p.denomination) lines.push(`    denomination: ${toJsString(p.denomination)},`);
  if (p.volume) lines.push(`    volume: ${toJsString(p.volume)},`);
  if (p.container) lines.push(`    container: ${toJsString(p.container)},`);
  if (p.special !== undefined && p.special !== null && (!isWine || p.special)) {
    lines.push(`    special: ${toJsString(p.special)},`);
  }
  if (p.type) lines.push(`    type: ${toJsString(p.type)},`);
  lines.push(`    description: ${toJsString(p.description || '')},`);

  let tags = p.tags;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch (e) { tags = []; }
  }
  if (!Array.isArray(tags)) tags = [];
  const tagsFormatted = `[${tags.map(t => toJsString(t)).join(', ')}]`;
  lines.push(`    tags: ${tagsFormatted},`);
  lines.push(`    price: ${typeof p.price === 'number' ? p.price : (parseFloat(p.price) || 0)},`);

  if (p.icon) {
    lines.push(`    icon: ${toJsString(p.icon)},`);
  }
  if (p.color) {
    lines.push(`    color: ${toJsString(p.color)},`);
  }
  lines.push(`    image: ${toJsString(p.image || '')},`);
  lines.push(`    in_stock: ${p.in_stock ? 1 : 0}`);
  lines.push('  }');
  return lines.join('\n');
}

/**
 * Synchronize the current database catalog to db/seed-data.js
 */
function syncSeedDataFile(databaseInstance) {
  const db = databaseInstance || require('./database');
  try {
    const wines = db.prepare("SELECT * FROM products WHERE category = 'wine'").all().sort(naturalSort);
    const oils = db.prepare("SELECT * FROM products WHERE category = 'oil'").all().sort(naturalSort);
    const others = db.prepare("SELECT * FROM products WHERE category NOT IN ('wine', 'oil')").all().sort(naturalSort);

    const wineSection = wines.length > 0
      ? `  // ==================== WINES ====================\n${wines.map(formatProduct).join(',\n')}`
      : '';

    const oilSection = oils.length > 0
      ? `  // ==================== OLIVE OILS ====================\n${oils.map(formatProduct).join(',\n')}`
      : '';

    const otherSection = others.length > 0
      ? `  // ==================== OTHER PRODUCTS ====================\n${others.map(formatProduct).join(',\n')}`
      : '';

    const sections = [wineSection, oilSection, otherSection].filter(Boolean).join(',\n\n');

    const fileContent = `const initialProducts = [\n${sections}\n];\n\nmodule.exports = { initialProducts };\n`;

    fs.writeFileSync(SEED_FILE_PATH, fileContent, 'utf-8');
    const totalCount = wines.length + oils.length + others.length;
    console.log(`[SeedSync] ✓ Successfully synchronized ${totalCount} products to ${SEED_FILE_PATH}`);

    return {
      success: true,
      count: totalCount,
      winesCount: wines.length,
      oilsCount: oils.length,
      othersCount: others.length,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error('[SeedSync] ✗ Failed to synchronize seed-data.js:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

// Allow running standalone: node db/syncSeed.js
if (require.main === module) {
  const result = syncSeedDataFile();
  if (result.success) {
    console.log(`Synchronization complete: ${result.count} products synced.`);
    process.exit(0);
  } else {
    console.error('Synchronization failed:', result.error);
    process.exit(1);
  }
}

module.exports = { syncSeedDataFile, SEED_FILE_PATH };
