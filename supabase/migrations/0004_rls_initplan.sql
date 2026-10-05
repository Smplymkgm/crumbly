-- 0004: RLS más eficiente y `usuarios` visible solo para uno mismo.
--
-- 1) Asesor de rendimiento de Supabase (auth_rls_initplan): `auth.jwt()`
--    dentro de la política se evaluaba fila por fila. Envuelto en
--    `(select auth.jwt())` se evalúa una vez por consulta. Misma regla de
--    acceso que 0001: solo usuarios activos en `usuarios`.
-- 2) `usuarios_lectura`: antes cualquier cuenta de Google que entrara con
--    Supabase Auth podía leer la lista completa de usuarios (emails). El
--    login y la Edge Function solo consultan la fila propia
--    (`.eq('email', <el propio>)`), así que alcanza con ver la propia.
--
-- Idempotente: se puede correr más de una vez.

do $$
declare
  t text;
begin
  foreach t in array array[
    'productos', 'materia', 'empaques', 'toppings', 'preparaciones', 'clientes',
    'ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes', 'config'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_usuarios_activos', t);
    execute format($f$
      create policy %I on %I for all
      using (exists (select 1 from usuarios u where u.email = (select auth.jwt() ->> 'email') and u.activo))
      with check (exists (select 1 from usuarios u where u.email = (select auth.jwt() ->> 'email') and u.activo))
    $f$, t || '_usuarios_activos', t);
  end loop;
end $$;

drop policy if exists usuarios_lectura on usuarios;
create policy usuarios_lectura on usuarios for select
  using (email = (select auth.jwt() ->> 'email'));
