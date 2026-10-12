/**
 * MediDesk POS Live API Bridge Server
 * Exposes live SQLite POS database to the Flutter Web storefront
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Try requiring sql.js or sqlite3
let initSqlJs;
try {
  initSqlJs = require('sql.js');
} catch (e) {
  console.log('sql.js not directly found, running lightweight native reader...');
}

const DB_PATH = path.join(process.env.USERPROFILE || 'C:\\Users\\Talha', 'Documents', 'MediDeskPOS', 'medidesk_pos.db');
const PORT = 5000;

console.log(`[POS API] Initializing POS bridge server for database: ${DB_PATH}`);

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'online', pos: 'MediDesk POS', dbExists: fs.existsSync(DB_PATH) }));
    return;
  }

  if (req.url === '/api/products' || req.url === '/api/store') {
    try {
      if (!fs.existsSync(DB_PATH)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'POS Database file not found' }));
        return;
      }

      if (!initSqlJs) {
        initSqlJs = require(path.join(__dirname, 'node_modules', 'sql.js'));
      }

      const SQL = await initSqlJs();
      const fileBuffer = fs.readFileSync(DB_PATH);
      const db = new SQL.Database(fileBuffer);

      if (req.url === '/api/store') {
        const result = db.exec("SELECT * FROM settings WHERE id = 1");
        const storeData = result[0] ? result[0].values[0] : null;
        db.close();
        res.writeHead(200);
        res.end(JSON.stringify({ store: storeData }));
        return;
      }

      if (req.url === '/api/products') {
        const query = `
          SELECT p.id, p.barcode, p.title, p.generic_name, p.category_id, c.name as category_name,
                 p.pack_size, p.expiry_date, p.quantity_packs, p.quantity_singles,
                 p.cost_price_cents, p.sale_price_cents, p.single_price_cents,
                 p.is_prescription_required, p.min_stock_level
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          ORDER BY p.title ASC
        `;
        const result = db.exec(query);
        const rows = result[0] ? result[0].values : [];
        const columns = result[0] ? result[0].columns : [];

        const products = rows.map(r => {
          const obj = {};
          columns.forEach((col, idx) => { obj[col] = r[idx]; });
          return {
            id: `pos_${obj.id}`,
            barcode: obj.barcode,
            name: obj.title,
            genericName: obj.generic_name || 'Healthcare Formula',
            category: obj.category_name || 'General Medicine',
            price: Math.round((obj.sale_price_cents || 0) / 100.0),
            singlePrice: Math.round((obj.single_price_cents || 0) / 100.0),
            stockPacks: obj.quantity_packs || 0,
            stockSingles: obj.quantity_singles || 0,
            isPrescriptionRequired: Boolean(obj.is_prescription_required),
            imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop'
          };
        });

        db.close();
        res.writeHead(200);
        res.end(JSON.stringify({ count: products.length, products }));
        return;
      }
    } catch (err) {
      console.error('[POS API Error]', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, () => {
  console.log(`[POS API Bridge] Listening live on http://localhost:${PORT}`);
});
