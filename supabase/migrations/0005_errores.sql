-- 0005: registro de errores de la app (monitoreo mínimo).
--
-- La página guarda acá los errores de JavaScript que pasan en los
-- celulares (window.onerror / promesas sin manejar), así se pueden revisar
-- sin pedir capturas. Solo los usuarios activos de `usuarios` pueden
-- insertar y leer (misma regla que el resto). Campos acotados en tamaño.
--
-- Idempotente: se puede correr más de una vez.

create table if not exists errores (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  email text default (auth.jwt() ->> 'email'),
  mensaje text not null check (char_length(mensaje) <= 1000),
  origen text check (char_length(origen) <= 500),
  version text check (char_length(version) <= 40),
  agente text check (char_length(agente) <= 300)
);
create index if not exists errores_creado_idx on errores (creado desc);

alter table errores enable row level security;

drop policy if exists errores_insertar on errores;
create policy errores_insertar on errores for insert
  with check (exists (select 1 from usuarios u where u.email = (select auth.jwt() ->> 'email') and u.activo));

drop policy if exists errores_leer on errores;
create policy errores_leer on errores for select
  using (exists (select 1 from usuarios u where u.email = (select auth.jwt() ->> 'email') and u.activo));
