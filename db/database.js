const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Database path from environment or default
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bedrock.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Database initialization with automatic fallback for Docker volume mounts on Windows
let db;
try {
  db = new Database(dbPath);
} catch (openErr) {
  if (openErr.code === 'SQLITE_IOERR_SHMOPEN' || (openErr.message && openErr.message.includes('disk I/O error'))) {
    console.warn('[DB] SQLite WAL shared memory mapping failed (likely Windows Docker bind mount). Cleaning up stale shm/wal files...');
    try {
      if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
      if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    } catch (cleanupErr) {
      console.warn('[DB] Could not clean up shm/wal files:', cleanupErr.message);
    }
    db = new Database(dbPath);
  } else {
    throw openErr;
  }
}

// Journal mode: Use DELETE mode by default for reliable operation across Docker, Windows mounts, and Azure Files
const targetJournalMode = process.env.SQLITE_JOURNAL_MODE || 'DELETE';
try {
  db.pragma(`journal_mode = ${targetJournalMode}`);
} catch (err) {
  console.warn(`[DB] journal_mode = ${targetJournalMode} failed (${err.message}). Falling back to DELETE mode.`);
  try {
    db.pragma('journal_mode = DELETE');
  } catch (fallbackErr) {
    console.error('[DB] Fallback to DELETE journal mode failed:', fallbackErr.message);
  }
}
db.pragma('foreign_keys = ON');

function ensureColumn(table, columnDef) {
  try {
    const colName = columnDef.trim().split(/\s+/)[0];
    const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = tableInfo.some(col => col.name.toLowerCase() === colName.toLowerCase());
    if (!exists) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`).run();
    }
  } catch (err) {
    console.warn(`Migration notice for ${table}.${columnDef}: ${err.message}`);
  }
}

function initDatabase() {
  // 1. Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
      full_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Products Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('wine', 'oil')),
      name TEXT NOT NULL,
      fullName TEXT,
      variety TEXT,
      region TEXT,
      denomination TEXT,
      type TEXT,
      volume TEXT,
      container TEXT,
      special TEXT,
      description TEXT,
      tags TEXT, -- JSON array of strings
      price REAL DEFAULT 0,
      icon TEXT,
      color TEXT,
      image TEXT,
      in_stock INTEGER DEFAULT 1,
      stock_quantity INTEGER DEFAULT 50,
      reorder_level INTEGER DEFAULT 15,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Contact & Lead Inquiries Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      company TEXT,
      inquiry_type TEXT DEFAULT 'General Inquiry',
      message TEXT NOT NULL,
      status TEXT DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'qualified', 'closed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Orders Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      email TEXT,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      barangay TEXT,
      city TEXT,
      province TEXT,
      zip TEXT,
      delivery_method TEXT NOT NULL,
      delivery_fee REAL DEFAULT 0,
      payment_method TEXT NOT NULL,
      items TEXT NOT NULL, -- JSON array of cart items
      total_items INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // Schema Migrations for existing databases
  ensureColumn('products', 'stock_quantity INTEGER DEFAULT 50');
  ensureColumn('products', 'reorder_level INTEGER DEFAULT 15');
  ensureColumn('users', 'phone TEXT');
  ensureColumn('users', 'company TEXT');
  ensureColumn('users', 'address TEXT');
  ensureColumn('users', 'barangay TEXT');
  ensureColumn('users', 'city TEXT');
  ensureColumn('users', 'province TEXT');
  ensureColumn('users', 'postal_code TEXT');
  ensureColumn('users', 'customer_tier TEXT DEFAULT "Standard"');
  ensureColumn('users', 'customer_type TEXT DEFAULT "Retail"');
  ensureColumn('users', 'preferred_category TEXT DEFAULT "Wine & Olive Oil"');
  ensureColumn('users', 'tax_id TEXT');
  ensureColumn('users', 'notes TEXT');
  ensureColumn('users', 'status TEXT DEFAULT "active"');

  seedDefaultData();
}

function seedDefaultData() {
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
  const viewerPassword = process.env.VIEWER_PASSWORD || 'ViewerPassword123!';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@bedrocktrading.ph';
  const viewerEmail = process.env.VIEWER_EMAIL || 'viewer@bedrocktrading.ph';

  // Check if users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    console.log('Seeding initial admin and viewer users...');

    const insertUser = db.prepare(`
      INSERT INTO users (
        username, email, password_hash, role, full_name,
        phone, company, address, barangay, city, province, postal_code,
        customer_tier, customer_type, preferred_category, tax_id, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      'admin',
      adminEmail,
      bcrypt.hashSync(adminPassword, 10),
      'admin',
      'Bedrock Master Administrator',
      '+63 917 500 1100',
      'Bedrock Consumer Goods Trading Inc.',
      '#65 De Acosta St., San Antonio Village',
      'Paciano Rizal',
      'Calamba',
      'Laguna',
      '4027',
      'Executive Admin',
      'Corporate Management',
      'Wine & Olive Oil',
      'TIN-109-847-210-000',
      'System Root Administrator with full access to financial & inventory reports.',
      'active'
    );

    insertUser.run(
      'viewer',
      viewerEmail,
      bcrypt.hashSync(viewerPassword, 10),
      'viewer',
      'Isabella Rodriguez - Connoisseur',
      '+63 917 842 1904',
      'Hacienda Fine Dining & Wine Club',
      'Penthouse Suite 22A, One Serendra, 32nd St.',
      'Fort Bonifacio',
      'Taguig City',
      'Metro Manila',
      '1634',
      'Platinum VIP Connoisseur',
      'Private Cellar & Hospitality',
      'Spanish Wine & BUENSALUD EVOO',
      'TIN-482-910-332-000',
      'VIP member since 2025. Prefers vintage Ribera del Duero Crianzas and Cosecha Temprana Picual EVOO. Always request wooden crate packaging.',
      'active'
    );

    insertUser.run(
      'chef_marcos',
      'marcos@laterraza.ph',
      bcrypt.hashSync('ViewerPassword123!', 10),
      'viewer',
      'Chef Marcos Alvarez',
      '+63 920 441 8892',
      'La Terraza Tapas & Grill Manila',
      'Ground Floor, Greenbelt 5, Legazpi Village',
      'San Lorenzo',
      'Makati City',
      'Metro Manila',
      '1223',
      'Premier Wholesale Partner',
      'Restaurant & Hotel Supply',
      'Olive Oil (BUENSALUD Bulk)',
      'TIN-231-509-771-001',
      'Executive chef partner. Weekly recurring bulk olive oil purchase and house wine curation.',
      'active'
    );
  } else {
    // Enrich existing viewer profile with sophisticated customer information
    try {
      db.prepare(`
        UPDATE users SET
          full_name = 'Isabella Rodriguez - Connoisseur',
          phone = '+63 917 842 1904',
          company = 'Hacienda Fine Dining & Wine Club',
          address = 'Penthouse Suite 22A, One Serendra, 32nd St.',
          barangay = 'Fort Bonifacio',
          city = 'Taguig City',
          province = 'Metro Manila',
          postal_code = '1634',
          customer_tier = 'Platinum VIP Connoisseur',
          customer_type = 'Private Cellar & Hospitality',
          preferred_category = 'Spanish Wine & BUENSALUD EVOO',
          tax_id = 'TIN-482-910-332-000',
          notes = 'VIP client since 2025. Enjoys vintage Reservas and high-polyphenol early harvest oils. Requires temperature-controlled delivery and gift packaging on quarterly orders.',
          status = 'active'
        WHERE role = 'viewer' AND username = 'viewer'
      `).run();

      const marcosCheck = db.prepare("SELECT id FROM users WHERE username = 'chef_marcos'").get();
      if (!marcosCheck) {
        db.prepare(`
          INSERT INTO users (
            username, email, password_hash, role, full_name,
            phone, company, address, barangay, city, province, postal_code,
            customer_tier, customer_type, preferred_category, tax_id, notes, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'chef_marcos',
          'marcos@laterraza.ph',
          bcrypt.hashSync('ViewerPassword123!', 10),
          'viewer',
          'Chef Marcos Alvarez',
          '+63 920 441 8892',
          'La Terraza Tapas & Grill Manila',
          'Ground Floor, Greenbelt 5, Legazpi Village',
          'San Lorenzo',
          'Makati City',
          'Metro Manila',
          '1223',
          'Premier Wholesale Partner',
          'Restaurant & Hotel Supply',
          'Olive Oil (BUENSALUD Bulk) & Rioja',
          'TIN-231-509-771-001',
          'Executive chef partner. Weekly recurring bulk olive oil purchase and house wine curation.',
          'active'
        );
      }
    } catch (e) {
      console.warn('Customer profile migration notice:', e.message);
    }
  }

  // Seed and synchronize product catalog
  const seed = require('./seed-data');
  const upsertProduct = db.prepare(`
    INSERT INTO products (
      id, category, name, fullName, variety, region, denomination, type,
      volume, container, special, description, tags, price, icon, color, image, in_stock, stock_quantity, reorder_level
    ) VALUES (
      @id, @category, @name, @fullName, @variety, @region, @denomination, @type,
      @volume, @container, @special, @description, @tags, @price, @icon, @color, @image, @in_stock, @stock_quantity, @reorder_level
    )
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      name = excluded.name,
      fullName = excluded.fullName,
      variety = excluded.variety,
      region = excluded.region,
      denomination = excluded.denomination,
      type = excluded.type,
      volume = excluded.volume,
      container = excluded.container,
      special = excluded.special,
      description = excluded.description,
      tags = excluded.tags,
      price = excluded.price,
      icon = excluded.icon,
      color = excluded.color,
      image = excluded.image,
      in_stock = excluded.in_stock,
      stock_quantity = COALESCE(products.stock_quantity, excluded.stock_quantity),
      reorder_level = COALESCE(products.reorder_level, excluded.reorder_level)
  `);

  const syncAllProducts = db.transaction((products) => {
    for (const p of products) {
      upsertProduct.run({
        id: p.id,
        category: p.category,
        name: p.name,
        fullName: p.fullName || p.name,
        variety: p.variety || '',
        region: p.region || '',
        denomination: p.denomination || '',
        type: p.type || '',
        volume: p.volume || '',
        container: p.container || '',
        special: p.special || '',
        description: p.description || '',
        tags: JSON.stringify(p.tags || []),
        price: p.price || 0,
        icon: p.icon || (p.category === 'wine' ? '🍷' : '🫒'),
        color: p.color || (p.category === 'wine' ? '#6b1d2a' : '#4a5b1d'),
        image: p.image || '',
        in_stock: p.in_stock !== undefined ? p.in_stock : 1,
        stock_quantity: p.stock_quantity !== undefined ? p.stock_quantity : 50,
        reorder_level: p.reorder_level !== undefined ? p.reorder_level : 15
      });
    }
  });

  syncAllProducts(seed.initialProducts);
  console.log(`[DB] Synchronized ${seed.initialProducts.length} catalog products into database.`);

  // Seed initial realistic orders if orders table has fewer than 3 orders
  const ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  if (ordersCount < 3) {
    console.log('Seeding initial sales orders for reports...');
    const viewerUser = db.prepare("SELECT id, email, full_name, phone, address, city, province, postal_code FROM users WHERE role = 'viewer' LIMIT 1").get();
    const userId = viewerUser ? viewerUser.id : null;

    const seedOrders = [
      {
        order_number: 'BR-20261010-0982',
        user_id: userId,
        customer_name: 'Isabella Rodriguez',
        email: viewerUser ? viewerUser.email : 'viewer@bedrocktrading.ph',
        phone: '+63 917 842 1904',
        address: 'Penthouse Suite 22A, One Serendra, 32nd St.',
        barangay: 'Fort Bonifacio',
        city: 'Taguig City',
        province: 'Metro Manila',
        zip: '1634',
        delivery_method: 'Metro Manila Express',
        delivery_fee: 250,
        payment_method: 'gcash',
        items: [
          { id: 'w1', name: 'Altos de Tamaron Crianza', category: 'wine', type: 'Red', price: 870, qty: 3 },
          { id: 'o1', name: 'BUENSALUD Picual 750ml Glass', category: 'oil', type: 'Picual', price: 1100, qty: 2 }
        ],
        total_items: 5,
        total_amount: 5060,
        notes: 'VIP customer. Packed in gift box with tasting cards.',
        status: 'delivered',
        created_at: '2026-10-10 11:20:00'
      },
      {
        order_number: 'BR-20261014-4412',
        user_id: userId,
        customer_name: 'Chef Marcos Alvarez',
        email: 'marcos@laterraza.ph',
        phone: '+63 920 441 8892',
        address: 'Ground Floor, Greenbelt 5, Legazpi Village',
        barangay: 'San Lorenzo',
        city: 'Makati City',
        province: 'Metro Manila',
        zip: '1223',
        delivery_method: 'Laguna / Warehouse Pickup',
        delivery_fee: 0,
        payment_method: 'bank_transfer',
        items: [
          { id: 'o11', name: 'BUENSALUD Coupage 500ml Glass', category: 'oil', type: 'Coupage', price: 870, qty: 12 },
          { id: 'w3', name: 'Marqués de Cáceres Reserva 2019', category: 'wine', type: 'Red', price: 2450, qty: 4 }
        ],
        total_items: 16,
        total_amount: 20240,
        notes: 'Restaurant wholesale order. Official invoice issued.',
        status: 'delivered',
        created_at: '2026-10-14 15:45:00'
      },
      {
        order_number: 'BR-20261018-8721',
        user_id: null,
        customer_name: 'Elena Cruz',
        email: 'elena.cruz@ayala-alabang.ph',
        phone: '+63 918 320 9182',
        address: '14 Cuenca St., Ayala Alabang Village',
        barangay: 'Ayala Alabang',
        city: 'Muntinlupa City',
        province: 'Metro Manila',
        zip: '1780',
        delivery_method: 'Metro Manila Express',
        delivery_fee: 250,
        payment_method: 'credit_card',
        items: [
          { id: 'w6', name: 'Hoya de Cadenas D.O. Cava', category: 'wine', type: 'Sparkling', price: 1650, qty: 2 },
          { id: 'w7', name: 'Hoya de Cadenas Cava Brut Rosado', category: 'wine', type: 'Rose', price: 1750, qty: 2 },
          { id: 'o7', name: 'BUENSALUD Arbequina 500ml Glass', category: 'oil', type: 'Arbequina', price: 880, qty: 2 }
        ],
        total_items: 6,
        total_amount: 8810,
        notes: 'Corporate gift basket delivery.',
        status: 'shipped',
        created_at: '2026-10-18 09:15:00'
      },
      {
        order_number: 'BR-20261021-1904',
        user_id: userId,
        customer_name: 'Isabella Rodriguez',
        email: viewerUser ? viewerUser.email : 'viewer@bedrocktrading.ph',
        phone: '+63 917 842 1904',
        address: 'Penthouse Suite 22A, One Serendra, 32nd St.',
        barangay: 'Fort Bonifacio',
        city: 'Taguig City',
        province: 'Metro Manila',
        zip: '1634',
        delivery_method: 'Metro Manila Express',
        delivery_fee: 250,
        payment_method: 'gcash',
        items: [
          { id: 'w8', name: 'Manzanos Reserva Rioja', category: 'wine', type: 'Red', price: 2200, qty: 3 },
          { id: 'o5', name: 'BUENSALUD Picual Nueva Cosecha 500ml', category: 'oil', type: 'Picual', price: 1050, qty: 2 }
        ],
        total_items: 5,
        total_amount: 8950,
        notes: 'Monthly personal reserve restocking.',
        status: 'confirmed',
        created_at: '2026-10-21 16:30:00'
      },
      {
        order_number: 'BR-20261023-5591',
        user_id: null,
        customer_name: 'Gabriel Morales',
        email: 'gabriel.morales@manilaclub.ph',
        phone: '+63 927 619 4022',
        address: '38 San Miguel Ave., Ortigas Center',
        barangay: 'San Antonio',
        city: 'Pasig City',
        province: 'Metro Manila',
        zip: '1605',
        delivery_method: 'Standard Provincial Delivery',
        delivery_fee: 350,
        payment_method: 'gcash',
        items: [
          { id: 'w2', name: 'CASTILLO DE LIRIA White Wine', category: 'wine', type: 'White', price: 495, qty: 4 },
          { id: 'w9', name: 'FREIXENET Cava Brut', category: 'wine', type: 'Sparkling', price: 1005, qty: 2 }
        ],
        total_items: 6,
        total_amount: 4340,
        notes: 'Call before delivery.',
        status: 'pending',
        created_at: '2026-10-23 18:10:00'
      }
    ];

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_number, user_id, customer_name, email, phone,
        address, barangay, city, province, zip,
        delivery_method, delivery_fee, payment_method,
        items, total_items, total_amount, notes, status, created_at
      ) VALUES (
        @order_number, @user_id, @customer_name, @email, @phone,
        @address, @barangay, @city, @province, @zip,
        @delivery_method, @delivery_fee, @payment_method,
        @items, @total_items, @total_amount, @notes, @status, @created_at
      )
    `);

    for (const ord of seedOrders) {
      insertOrder.run({
        ...ord,
        items: JSON.stringify(ord.items)
      });
    }
    console.log(`Seeded ${seedOrders.length} orders for reporting analytics.`);
  }
}

initDatabase();

module.exports = db;
