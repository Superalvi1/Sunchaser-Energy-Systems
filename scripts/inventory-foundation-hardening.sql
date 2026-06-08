-- Inventory foundation hardening (run after inventory-foundation-schema.sql)
-- Adds unique SKU constraint and transactional RPC helpers for stock mutations.

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_sku_unique
  ON public.inventory_items (lower(trim(sku)))
  WHERE trim(sku) <> '';

CREATE OR REPLACE FUNCTION public.inv_foundation_new_movement_id()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'im-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' ||
         substr(md5(random()::text), 1, 5);
$$;

CREATE OR REPLACE FUNCTION public.inv_foundation_stock_in(
  p_item_id text,
  p_qty numeric,
  p_reference_type text DEFAULT 'manual',
  p_reference_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_movement public.inventory_movements%ROWTYPE;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be greater than 0';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  UPDATE public.inventory_items
  SET stock_qty = stock_qty + p_qty, updated_at = timezone('utc', now())
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.inventory_movements (
    id, inventory_item_id, movement_type, qty, reference_type, reference_id, notes, created_by
  ) VALUES (
    public.inv_foundation_new_movement_id(),
    p_item_id,
    'stock_in',
    p_qty,
    p_reference_type,
    p_reference_id,
    p_notes,
    p_created_by
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object('item', to_jsonb(v_item), 'movement', to_jsonb(v_movement));
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_foundation_stock_out(
  p_item_id text,
  p_qty numeric,
  p_reference_type text DEFAULT 'manual',
  p_reference_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_movement public.inventory_movements%ROWTYPE;
  v_available numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be greater than 0';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  v_available := v_item.stock_qty - v_item.reserved_qty;
  IF v_available < p_qty THEN
    RAISE EXCEPTION 'Cannot stock out % units. Only % available.', p_qty, v_available;
  END IF;

  UPDATE public.inventory_items
  SET stock_qty = stock_qty - p_qty, updated_at = timezone('utc', now())
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.inventory_movements (
    id, inventory_item_id, movement_type, qty, reference_type, reference_id, notes, created_by
  ) VALUES (
    public.inv_foundation_new_movement_id(),
    p_item_id,
    'stock_out',
    p_qty,
    p_reference_type,
    p_reference_id,
    p_notes,
    p_created_by
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object('item', to_jsonb(v_item), 'movement', to_jsonb(v_movement));
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_foundation_adjust(
  p_item_id text,
  p_qty_delta numeric,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_movement public.inventory_movements%ROWTYPE;
  v_next numeric;
BEGIN
  IF p_qty_delta IS NULL OR p_qty_delta = 0 THEN
    RAISE EXCEPTION 'qtyDelta cannot be 0';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  v_next := v_item.stock_qty + p_qty_delta;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'Adjustment would make stock negative';
  END IF;
  IF v_next < v_item.reserved_qty THEN
    RAISE EXCEPTION 'Adjustment would leave stock below reserved quantity (%)', v_item.reserved_qty;
  END IF;

  UPDATE public.inventory_items
  SET stock_qty = v_next, updated_at = timezone('utc', now())
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.inventory_movements (
    id, inventory_item_id, movement_type, qty, reference_type, reference_id, notes, created_by
  ) VALUES (
    public.inv_foundation_new_movement_id(),
    p_item_id,
    'adjustment',
    abs(p_qty_delta),
    'adjustment',
    NULL,
    COALESCE(p_notes, CASE WHEN p_qty_delta > 0 THEN '+' || p_qty_delta::text ELSE p_qty_delta::text END),
    p_created_by
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object('item', to_jsonb(v_item), 'movement', to_jsonb(v_movement));
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_foundation_reserve(
  p_item_id text,
  p_project_id text,
  p_qty numeric,
  p_delivery_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_movement public.inventory_movements%ROWTYPE;
  v_reservation public.project_inventory_reservations%ROWTYPE;
  v_available numeric;
  v_res_id text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be greater than 0';
  END IF;
  IF trim(COALESCE(p_project_id, '')) = '' THEN
    RAISE EXCEPTION 'projectId is required';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  v_available := v_item.stock_qty - v_item.reserved_qty;
  IF v_available < p_qty THEN
    RAISE EXCEPTION 'Cannot reserve % units. Only % available.', p_qty, v_available;
  END IF;

  UPDATE public.inventory_items
  SET reserved_qty = reserved_qty + p_qty, updated_at = timezone('utc', now())
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  v_res_id := 'pir-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' ||
              substr(md5(random()::text), 1, 5);

  INSERT INTO public.project_inventory_reservations (
    id, project_id, delivery_id, inventory_item_id, qty_reserved, status, created_by
  ) VALUES (
    v_res_id, trim(p_project_id), p_delivery_id, p_item_id, p_qty, 'reserved', p_created_by
  )
  RETURNING * INTO v_reservation;

  INSERT INTO public.inventory_movements (
    id, inventory_item_id, movement_type, qty, reference_type, reference_id, notes, created_by
  ) VALUES (
    public.inv_foundation_new_movement_id(),
    p_item_id,
    'reserve',
    p_qty,
    'project',
    trim(p_project_id),
    p_notes,
    p_created_by
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'movement', to_jsonb(v_movement),
    'reservation', to_jsonb(v_reservation)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_foundation_release(
  p_reservation_id text,
  p_notes text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation public.project_inventory_reservations%ROWTYPE;
  v_item public.inventory_items%ROWTYPE;
  v_movement public.inventory_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_reservation
  FROM public.project_inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;
  IF v_reservation.status <> 'reserved' THEN
    RAISE EXCEPTION 'Reservation is already %', v_reservation.status;
  END IF;

  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = v_reservation.inventory_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  UPDATE public.inventory_items
  SET reserved_qty = GREATEST(0, reserved_qty - v_reservation.qty_reserved),
      updated_at = timezone('utc', now())
  WHERE id = v_reservation.inventory_item_id
  RETURNING * INTO v_item;

  UPDATE public.project_inventory_reservations
  SET status = 'released'
  WHERE id = p_reservation_id
  RETURNING * INTO v_reservation;

  INSERT INTO public.inventory_movements (
    id, inventory_item_id, movement_type, qty, reference_type, reference_id, notes, created_by
  ) VALUES (
    public.inv_foundation_new_movement_id(),
    v_reservation.inventory_item_id,
    'release',
    v_reservation.qty_reserved,
    'project',
    v_reservation.project_id,
    COALESCE(p_notes, 'Release reservation ' || p_reservation_id),
    p_created_by
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'movement', to_jsonb(v_movement),
    'reservation', to_jsonb(v_reservation)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
