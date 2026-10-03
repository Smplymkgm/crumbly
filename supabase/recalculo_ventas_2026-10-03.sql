-- Recalcula el costo de 3 ventas viejas que quedaron infladas por insumos
-- cargados en kg con precio por gramo (ya corregidos). Costos calculados con
-- CrumblyCore.getCostoProductoDesglosado sobre los precios actuales.
-- Correr una vez en Supabase → SQL Editor.

-- 12/9 · Malteada paris ($20.000): costo $187.596 → $8.958
update ventas set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,
  '{items,0,costo}', '8958'), '{items,0,costoAlimento}', '8958'), '{items,0,costoEmpaque}', '0'),
  '{ganancia}', '11042')
where id = 'mtyslkha3543' and data->'items'->0->>'productoId' = 'mtys4kloznj6';

-- 12/9 · Crumbly bites + Malteada paris ($40.000): costo $287.067 → $22.330
update ventas set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,
  '{items,0,costo}', '13372.33'), '{items,0,costoAlimento}', '11007.77'), '{items,0,costoEmpaque}', '2364.56'),
  '{items,1,costo}', '8958'), '{items,1,costoAlimento}', '8958'), '{items,1,costoEmpaque}', '0'),
  '{ganancia}', '17669.67')
where id = 'mtysme7v6mol' and data->'items'->0->>'productoId' = 'mtysdntr3wlx' and data->'items'->1->>'productoId' = 'mtys4kloznj6';

-- 16/9 · Malteada frutos amarillos + Belga Brasil ($36.000): costo $392.515 → $16.184
update ventas set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,
  '{items,1,costo}', '10658.49'), '{items,1,costoAlimento}', '8882.49'), '{items,1,costoEmpaque}', '1776'),
  '{ganancia}', '19816.46')
where id = 'mu5kngyooooe' and data->'items'->1->>'productoId' = 'mtni4rqihg6k';
