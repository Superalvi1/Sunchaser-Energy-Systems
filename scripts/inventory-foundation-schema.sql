-- Sprint C: Inventory foundation (new tables; products catalog unchanged)
-- Run in Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS inventory_items (
  id text PRIMARY KEY,
  product_id text,
  category text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  stock_qty numeric NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty numeric NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  available_qty numeric GENERATED ALWAYS AS (stock_qty - reserved_qty) STORED,
  cost_price numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  supplier text NOT NULL DEFAULT '',
  warehouse_location text NOT NULL DEFAULT '',
  serial_required boolean NOT NULL DEFAULT false,
  low_stock_threshold numeric NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_reserved_lte_stock CHECK (reserved_qty <= stock_qty)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items (sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_product_id ON inventory_items (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id text PRIMARY KEY,
  inventory_item_id text NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (
    movement_type IN ('stock_in', 'stock_out', 'adjustment', 'reserve', 'release')
  ),
  qty numeric NOT NULL CHECK (qty > 0),
  reference_type text,
  reference_id text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements (inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements (movement_type);

CREATE TABLE IF NOT EXISTS project_inventory_reservations (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  delivery_id text,
  inventory_item_id text NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty_reserved numeric NOT NULL CHECK (qty_reserved > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'released', 'consumed')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_inventory_reservations_project ON project_inventory_reservations (project_id);
CREATE INDEX IF NOT EXISTS idx_project_inventory_reservations_item ON project_inventory_reservations (inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_project_inventory_reservations_status ON project_inventory_reservations (status);
