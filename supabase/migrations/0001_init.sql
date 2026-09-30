-- Crumbly — esquema inicial de Supabase (migración desde Google Sheets/Apps Script)
--
-- Por qué esta forma: js/core.js/js/rowsync.js ya conocen 12 colecciones con
-- la misma forma (id + el resto de los campos), más `config`/`schemaVersion`
-- como singleton. En vez de normalizar a un modelo relacional (proyecto
-- aparte, no lo pide esta migración), cada colección es una tabla con
-- `data jsonb` guardando el registro TAL CUAL lo arma index.html hoy —
-- cero cambios de forma, cero migración de campos.
--
-- `deleted_at` reemplaza el mecanismo de "fila de lápida" que
-- js/rowsync.js implementaba a mano (V0/U1: isTombstone/makeTombstone/
-- pickExplicitTombstones) porque Sheets no tiene soft-delete real — acá sí
-- lo hay, así que no hace falta la fila sintética.
--
-- `updated_at` (con índice) deja la puerta abierta a sincronización
-- incremental (X2, cinco rondas abierta en el audit trail) casi gratis más
-- adelante — no se construye en esta migración, pero el campo ya está.

create table if not exists usuarios (
  email text primary key,
  nombre text,
  rol text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create table if not exists config (
  id text primary key default 'singleton',
  data jsonb not null default '{}'::jsonb,
  schema_version int not null default 1,
  updated_at timestamptz not null default now()
);

-- Colecciones de catálogo (con id) — crecen con el MENÚ, no con la operación.
-- Colecciones transaccionales (antes "append-only" en Sheets) — crecen con
-- cada venta/gasto/merma/etc. Misma forma de tabla para las dos: Postgres no
-- tiene el problema de tamaño de celda que motivó separarlas en Sheets.
do $$
declare
  t text;
begin
  foreach t in array array[
    'productos', 'materia', 'empaques', 'toppings', 'preparaciones', 'clientes',
    'ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes'
  ]
  loop
    execute format($f$
      create table if not exists %I (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      )
    $f$, t);
    execute format('create index if not exists %I on %I (updated_at)', t || '_updated_at_idx', t);
    execute format('create index if not exists %I on %I (deleted_at) where deleted_at is null', t || '_live_idx', t);
  end loop;
end $$;

-- RLS: mismo criterio de autorización que isValidSession_/usuarios.activo en
-- Code.gs hoy — cualquier fila solo es visible/editable por un usuario
-- autenticado (Supabase Auth, Google) cuyo email esté en `usuarios` y activo.
-- El login en sí NUNCA crea usuarios (igual que hoy) — `usuarios` se puebla a
-- mano.
alter table usuarios enable row level security;
alter table config enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'productos', 'materia', 'empaques', 'toppings', 'preparaciones', 'clientes',
    'ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes', 'config'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format($f$
      create policy %I on %I for all
      using (exists (select 1 from usuarios u where u.email = auth.jwt() ->> 'email' and u.activo))
      with check (exists (select 1 from usuarios u where u.email = auth.jwt() ->> 'email' and u.activo))
    $f$, t || '_usuarios_activos', t);
  end loop;
end $$;

-- `usuarios` en sí: cualquier usuario autenticado puede LEER la tabla (para
-- que el propio login pueda chequear "¿estoy activo?"), pero nadie la edita
-- desde el cliente — se administra a mano (mismo criterio que hoy: editar la
-- hoja `usuarios` del Sheet a mano, sin UI para eso en la app).
create policy usuarios_lectura on usuarios for select
  using (auth.jwt() ->> 'email' is not null);
