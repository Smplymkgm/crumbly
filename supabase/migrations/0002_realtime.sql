-- Realtime: los cambios de otro dispositivo (pedidos nuevos, estados,
-- stock) llegan al instante. RLS sigue aplicando: cada dispositivo solo
-- recibe filas que su sesión puede leer.
alter publication supabase_realtime add table
  productos, materia, empaques, toppings, preparaciones, clientes,
  ventas, gastos, mermas, snapshots, ajustes, lotes;
