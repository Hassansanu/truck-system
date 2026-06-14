import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const execute = process.argv.includes("--execute");

function loadEnv(filename) {
  const values = {};
  const contents = fs.readFileSync(filename, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function parseCsv(filename) {
  const contents = fs.readFileSync(filename, "utf8");
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    const nextCharacter = contents[index + 1];

    if (quoted && character === '"' && nextCharacter === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || record.length) {
    record.push(field);
    records.push(record);
  }

  const [headers, ...rows] = records;
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function assertEqual(actual, expected, label) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

async function countRows(supabase, table) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function insertBatches(supabase, table, rows, batchSize = 100) {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      throw new Error(`${table} batch ${start + 1}: ${error.message}`);
    }
  }
}

async function fetchAll(supabase, table, columns) {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .range(0, 1999);
  if (error) throw error;
  return data;
}

const env = loadEnv(path.join(projectDir, ".env"));
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
}

const migrationDir = path.join(projectDir, "migration");
const source = {
  cash_book: parseCsv(path.join(migrationDir, "cash_book_import.csv")),
  cash_collections: parseCsv(
    path.join(migrationDir, "cash_collections_import.csv"),
  ),
  trucks: parseCsv(path.join(migrationDir, "trucks_import.csv")),
  truck_products: parseCsv(
    path.join(migrationDir, "truck_products_import.csv"),
  ),
};

const cashBookRows = source.cash_book.map((row) => ({
  transaction_date: row.transaction_date,
  transaction_type: row.transaction_type,
  amount: row.amount,
  description: row.description,
}));
const collectionRows = source.cash_collections.map((row) => ({
  collection_date: row.collection_date,
  amount: row.amount,
  description: row.description,
}));
const productsByTruck = new Map(
  source.truck_products.map((product) => [product.truck_legacy_key, product]),
);

const expected = {
  cashBookCount: cashBookRows.length,
  cashBookIn: sum(
    cashBookRows.filter((row) => row.transaction_type === "in"),
    "amount",
  ),
  cashBookOut: sum(
    cashBookRows.filter((row) => row.transaction_type === "out"),
    "amount",
  ),
  collectionsCount: collectionRows.length,
  collectionsTotal: sum(collectionRows, "amount"),
  trucksCount: source.trucks.length,
  truckPurchase: sum(source.trucks, "reported_purchase"),
  truckSale: sum(source.trucks, "reported_sale"),
  truckProfit: sum(source.trucks, "reported_profit"),
};

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tableNames = [
  "cash_book",
  "cash_collections",
  "truck_products",
  "trucks",
];
const initialCounts = Object.fromEntries(
  await Promise.all(
    tableNames.map(async (table) => [table, await countRows(supabase, table)]),
  ),
);

console.log("Live table counts:", initialCounts);
console.log("Prepared import:", expected);

if (Object.values(initialCounts).some((count) => count !== 0)) {
  throw new Error(
    "Import stopped because at least one live table is not empty. No rows were inserted.",
  );
}

if (!execute) {
  console.log("Dry run passed. Use --execute to import the prepared records.");
  process.exit(0);
}

await insertBatches(supabase, "cash_book", cashBookRows);
await insertBatches(supabase, "cash_collections", collectionRows);

for (const truck of source.trucks) {
  const product = productsByTruck.get(truck.legacy_key);
  if (!product) throw new Error(`Missing product for ${truck.legacy_key}`);

  const { data: insertedTruck, error: truckError } = await supabase
    .from("trucks")
    .insert({
      truck_number: truck.truck_number,
      entry_date: truck.entry_date,
      supplier_name: null,
      notes: `Imported from ${truck.source_file}, source row ${truck.source_row}`,
      total_purchase: truck.reported_purchase,
      total_sale: truck.reported_sale,
      profit: truck.reported_profit,
    })
    .select("id")
    .single();
  if (truckError) throw new Error(`${truck.legacy_key}: ${truckError.message}`);

  const purchaseAmount = Number(product.quantity) * Number(product.purchase_rate);
  const saleAmount = Number(product.quantity) * Number(product.sale_rate);
  const { error: productError } = await supabase.from("truck_products").insert({
    truck_id: insertedTruck.id,
    product_name: product.product_name,
    quantity: product.quantity,
    purchase_rate: product.purchase_rate,
    sale_rate: product.sale_rate,
    purchase_amount: purchaseAmount,
    sale_amount: saleAmount,
  });
  if (productError) {
    throw new Error(`${truck.legacy_key} product: ${productError.message}`);
  }
}

const [cashBook, collections, trucks, truckProducts] = await Promise.all([
  fetchAll(supabase, "cash_book", "transaction_type,amount"),
  fetchAll(supabase, "cash_collections", "amount"),
  fetchAll(supabase, "trucks", "total_purchase,total_sale,profit"),
  fetchAll(supabase, "truck_products", "id"),
]);

assertEqual(cashBook.length, expected.cashBookCount, "cash book row count");
assertEqual(
  sum(cashBook.filter((row) => row.transaction_type === "in"), "amount"),
  expected.cashBookIn,
  "cash in total",
);
assertEqual(
  sum(cashBook.filter((row) => row.transaction_type === "out"), "amount"),
  expected.cashBookOut,
  "cash out total",
);
assertEqual(
  collections.length,
  expected.collectionsCount,
  "collection row count",
);
assertEqual(
  sum(collections, "amount"),
  expected.collectionsTotal,
  "collection total",
);
assertEqual(trucks.length, expected.trucksCount, "truck row count");
assertEqual(truckProducts.length, expected.trucksCount, "truck product row count");
assertEqual(
  sum(trucks, "total_purchase"),
  expected.truckPurchase,
  "truck purchase total",
);
assertEqual(sum(trucks, "total_sale"), expected.truckSale, "truck sale total");
assertEqual(sum(trucks, "profit"), expected.truckProfit, "truck profit total");

console.log("Import and verification completed successfully.");
