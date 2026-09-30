-- updated_at lo pone el SERVIDOR en cada insert/update, no el reloj del
-- celular que escribe. El pull incremental (pullCambios) pide "lo cambiado
-- desde X": si cada dispositivo pusiera su propia hora, uno con el reloj
-- atrasado escribiría filas que los demás nunca verían al ponerse al día.
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'productos', 'materia', 'empaques', 'toppings', 'preparaciones', 'clientes',
    'ventas', 'gastos', 'mermas', 'snapshots', 'ajustes', 'lotes', 'config'
  ]
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before insert or update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
